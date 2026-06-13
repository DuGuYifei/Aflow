import { uuidv7 } from "@specflow/shared";

export type TerminalSessionStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface TerminalSessionTask {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  label?: string;
  successPatterns?: string[];
}

export type TerminalSessionStreamEvent =
  | {
      type: "output";
      sessionId: string;
      data: string;
      at: string;
    }
  | {
      type: "status";
      sessionId: string;
      status: TerminalSessionStatus;
      exitCode?: number;
      signal?: string | null;
      error?: string;
      at: string;
    };

export interface TerminalSessionRecord {
  id: string;
  task: TerminalSessionTask;
  status: TerminalSessionStatus;
  events: TerminalSessionStreamEvent[];
}

interface InternalTerminalSessionRecord extends TerminalSessionRecord {
  proc: Bun.Subprocess;
  terminal: Bun.Terminal;
  subscribers: Set<(event: TerminalSessionStreamEvent) => void>;
  output: string;
  completing: boolean;
}

export class TerminalSessionStore {
  readonly #sessions = new Map<string, InternalTerminalSessionRecord>();

  start(task: TerminalSessionTask, size: { cols?: number; rows?: number } = {}): string {
    const sessionId = uuidv7();
    const terminal = new Bun.Terminal({
      cols: size.cols ?? 80,
      rows: size.rows ?? 24,
      data: (_terminal, data) => {
        const text = new TextDecoder().decode(data);
        const record = this.#sessions.get(sessionId);
        if (record) this.#emitOutput(record, text);
      },
      exit: () => {
        // The subprocess exit promise below carries the real command status.
      },
    });
    const processHandle = Bun.spawn([task.command, ...task.args], {
      cwd: task.cwd,
      env: { ...process.env, ...task.env },
      terminal,
    });
    const record: InternalTerminalSessionRecord = {
      id: sessionId,
      task,
      proc: processHandle,
      terminal,
      status: "running",
      events: [],
      subscribers: new Set(),
      output: "",
      completing: false,
    };
    this.#sessions.set(sessionId, record);
    this.#emit(record, {
      type: "status",
      sessionId,
      status: "running",
      at: new Date().toISOString(),
    });
    void processHandle.exited.then((exitCode) => {
      if (record.status !== "running") return;
      if (exitCode === 0) {
        this.#complete(record, "succeeded", { exitCode });
      } else {
        this.#complete(record, "failed", {
          exitCode,
          error: `Terminal command exited with code ${exitCode}.`,
        });
      }
    }).catch((error) => {
      if (record.status !== "running") return;
      this.#complete(record, "failed", { error: errorMessage(error) });
    });
    return sessionId;
  }

  get(sessionId: string): TerminalSessionRecord | undefined {
    return this.#sessions.get(sessionId);
  }

  subscribe(sessionId: string, listener: (event: TerminalSessionStreamEvent) => void): () => void {
    const record = this.#require(sessionId);
    record.subscribers.add(listener);
    return () => record.subscribers.delete(listener);
  }

  input(sessionId: string, data: string): void {
    const record = this.#require(sessionId);
    if (record.status !== "running") return;
    record.terminal.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const record = this.#require(sessionId);
    if (record.status !== "running") return;
    record.terminal.resize(cols, rows);
  }

  cancel(sessionId: string): void {
    const record = this.#require(sessionId);
    if (record.status !== "running") return;
    this.#complete(record, "cancelled", { error: "Terminal command cancelled." });
  }

  #emitOutput(record: InternalTerminalSessionRecord, data: string): void {
    record.output += data;
    this.#emit(record, {
      type: "output",
      sessionId: record.id,
      data,
      at: new Date().toISOString(),
    });
    if (record.status !== "running") return;
    if ((record.task.successPatterns ?? []).some((pattern) => record.output.includes(pattern))) {
      this.#complete(record, "succeeded");
    }
  }

  #complete(
    record: InternalTerminalSessionRecord,
    status: TerminalSessionStatus,
    details: {
      exitCode?: number;
      signal?: string | null;
      error?: string;
    } = {},
  ): void {
    if (record.completing) return;
    record.completing = true;
    record.status = status;
    if (record.proc.exitCode === null) {
      record.proc.kill();
    }
    record.terminal.close();
    this.#emit(record, {
      type: "status",
      sessionId: record.id,
      status,
      ...details,
      at: new Date().toISOString(),
    });
    setTimeout(() => {
      if (record.subscribers.size === 0) this.#sessions.delete(record.id);
    }, 30_000);
  }

  #emit(record: InternalTerminalSessionRecord, event: TerminalSessionStreamEvent): void {
    record.events.push(event);
    for (const subscriber of record.subscribers) subscriber(event);
  }

  #require(sessionId: string): InternalTerminalSessionRecord {
    const record = this.#sessions.get(sessionId);
    if (!record) throw new Error(`Terminal session not found: ${sessionId}`);
    return record;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
