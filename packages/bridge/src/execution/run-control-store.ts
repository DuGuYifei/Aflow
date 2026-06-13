export interface QueuedActivationCheckpoint {
  nodeId: string;
  traversal: number;
}

export interface PendingInputCheckpoint {
  input: string[];
  edgeValues: Record<string, string>;
  origin?: {
    agentId: string;
    sessionId: string;
    output: string;
  };
}

export interface WorkflowExecutionCheckpoint {
  queue: QueuedActivationCheckpoint[];
  pendingInputs: Record<string, PendingInputCheckpoint>;
  completedNodeIds: string[];
  completedExecutionKeys: string[];
  skippedNodeIds: string[];
  inactiveEdgeIds: string[];
  branchTraversals: Record<string, number>;
  activeNodeId?: string;
  interruptedNodeId?: string;
  interruptedExecutionKey?: string;
  reason?: string;
  createdAt: string;
}

export type RunControlPauseKind = "paused" | "interrupted";

interface PendingPlayback {
  kind: RunControlPauseKind;
  checkpoint: WorkflowExecutionCheckpoint;
  resolve: () => void;
  reject: (error: Error) => void;
  removeAbort?: () => void;
}

interface ActiveInvocationControl {
  nodeId?: string;
  agentInvocationId: string;
  controller: AbortController;
}

interface RunControlRecord {
  pauseRequested?: boolean;
  pending?: PendingPlayback;
  activeInvocation?: ActiveInvocationControl;
}

export class WorkflowInterruptedError extends Error {
  constructor(readonly nodeId: string | undefined, readonly agentInvocationId: string) {
    super("Workflow run interrupted.");
    this.name = "WorkflowInterruptedError";
  }
}

export class RunControlStore {
  readonly #records = new Map<string, RunControlRecord>();

  requestPause(runId: string): boolean {
    const record = this.#record(runId);
    if (record.pending?.kind === "paused") return false;
    record.pauseRequested = true;
    return true;
  }

  isPauseRequested(runId: string): boolean {
    return this.#records.get(runId)?.pauseRequested === true;
  }

  async waitForPlay(
    runId: string,
    kind: RunControlPauseKind,
    checkpoint: WorkflowExecutionCheckpoint,
    signal?: AbortSignal,
  ): Promise<void> {
    const record = this.#record(runId);
    record.pauseRequested = false;
    if (record.pending) throw new Error(`Run "${runId}" is already waiting for play.`);
    return new Promise<void>((resolve, reject) => {
      const pending: PendingPlayback = {
        kind,
        checkpoint,
        resolve,
        reject,
      };
      const abort = () => {
        if (this.#records.get(runId)?.pending === pending) {
          this.#records.get(runId)!.pending = undefined;
        }
        reject(new Error("Workflow run stopped while waiting for play."));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      pending.removeAbort = () => signal?.removeEventListener("abort", abort);
      record.pending = pending;
    });
  }

  play(runId: string): { played: boolean; kind?: RunControlPauseKind; checkpoint?: WorkflowExecutionCheckpoint } {
    const record = this.#records.get(runId);
    const pending = record?.pending;
    if (!record || !pending) return { played: false };
    record.pending = undefined;
    pending.removeAbort?.();
    pending.resolve();
    return { played: true, kind: pending.kind, checkpoint: pending.checkpoint };
  }

  registerInvocation(input: {
    runId: string;
    nodeId?: string;
    agentInvocationId: string;
  }): { signal: AbortSignal; unregister: () => void } {
    const controller = new AbortController();
    const record = this.#record(input.runId);
    const active: ActiveInvocationControl = {
      nodeId: input.nodeId,
      agentInvocationId: input.agentInvocationId,
      controller,
    };
    record.activeInvocation = active;
    return {
      signal: controller.signal,
      unregister: () => {
        const current = this.#records.get(input.runId);
        if (current?.activeInvocation === active) {
          current.activeInvocation = undefined;
        }
      },
    };
  }

  interrupt(runId: string): { interrupted: boolean; nodeId?: string; agentInvocationId?: string } {
    const active = this.#records.get(runId)?.activeInvocation;
    if (!active) return { interrupted: false };
    active.controller.abort();
    return {
      interrupted: true,
      nodeId: active.nodeId,
      agentInvocationId: active.agentInvocationId,
    };
  }

  clear(runId: string): void {
    const record = this.#records.get(runId);
    record?.pending?.removeAbort?.();
    record?.pending?.reject(new Error("Workflow run control cleared."));
    record?.activeInvocation?.controller.abort();
    this.#records.delete(runId);
  }

  #record(runId: string): RunControlRecord {
    let record = this.#records.get(runId);
    if (!record) {
      record = {};
      this.#records.set(runId, record);
    }
    return record;
  }
}
