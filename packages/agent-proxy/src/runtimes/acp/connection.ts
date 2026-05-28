import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentAvailableCommand,
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentConversation,
  AgentConversationPromptResult,
  AgentRunRequest,
  AgentRunResult,
  AgentAuthenticationMethod,
  AgentAuthenticationStatus,
  AgentTerminalEvent,
  ResolvedAgentServer,
} from "../../types";

/**
 * Snapshot of an agent's advertised capabilities, captured the first time a
 * session is established. Plumbed up to the session pool so it can persist
 * the snapshot via `AgentServerStore.setCapabilities`.
 */
export interface AcpProbedCapabilities {
  agentCapabilities: acp.AgentCapabilities;
  modes: acp.SessionModeState | null;
  configOptions: acp.SessionConfigOption[] | null;
  availableCommands: AgentAvailableCommand[];
}

export type AcpCapabilityWriter = (probe: AcpProbedCapabilities) => void | Promise<void>;
import { supportedRegistryAgentProfile } from "../../supported-agents";
import { AcpClientHandlers } from "./client-handlers";

export interface AcpAgentClientOptions {
  resolved: ResolvedAgentServer;
  cwd: string;
  additionalDirectories?: string[];
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
  request: Pick<
    AgentRunRequest,
    | "onPermissionRequest"
    | "onSessionUpdate"
    | "onElicitationRequest"
    | "onElicitationComplete"
    | "onExtMethod"
    | "onExtNotification"
  >;
  appendOutput: (text: string) => void;
}

export class AcpAgentClient {
  readonly connection: acp.ClientSideConnection;
  readonly process: ChildProcessWithoutNullStreams;
  readonly #settings: ResolvedAgentServer["settings"];
  #stderr = "";

  constructor(options: AcpAgentClientOptions) {
    this.#settings = options.resolved.settings;
    const { command } = options.resolved.command;
    const args = options.resolved.command.args;
    this.process = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.resolved.command.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    void this.#captureStderr(options.onTerminalEvent);

    const stream = acp.ndJsonStream(
      Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(this.process.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const handlers = new AcpClientHandlers({
      cwd: options.cwd,
      additionalDirectories: options.additionalDirectories,
      terminalEnabled: options.resolved.settings.terminal?.enabled ?? true,
      permissionPolicy: options.resolved.settings.permissionPolicy,
      appendOutput: options.appendOutput,
      onTerminalEvent: options.onTerminalEvent,
      onPermissionRequest: options.request.onPermissionRequest,
      onSessionUpdate: options.request.onSessionUpdate,
      onElicitationRequest: options.request.onElicitationRequest,
      onElicitationComplete: options.request.onElicitationComplete,
      onExtMethod: options.request.onExtMethod,
      onExtNotification: options.request.onExtNotification,
    });
    this.connection = new acp.ClientSideConnection(() => handlers, stream);
  }

  get stderr(): string {
    return this.#stderr;
  }

  async initialize(): Promise<acp.InitializeResponse> {
    const terminalEnabled = this.#terminalEnabled();
    const terminalAuthEnabled = terminalEnabled && (this.#terminalAuthEnabled());
    return this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: terminalEnabled,
        auth: { terminal: terminalAuthEnabled },
        elicitation: { form: {}, url: {} },
        positionEncodings: ["utf-8", "utf-16", "utf-32"],
        _meta: {
          terminal_output: terminalEnabled,
          "terminal-auth": terminalAuthEnabled,
        },
      },
      clientInfo: {
        name: "specflow",
        title: "Specflow",
        version: "0.0.0",
      },
    });
  }

  kill(): void {
    this.process.kill();
  }

  #terminalEnabled(): boolean {
    return this.#settings.terminal?.enabled ?? true;
  }

  #terminalAuthEnabled(): boolean {
    return this.#settings.terminal?.auth ?? false;
  }

  async close(): Promise<void> {
    this.process.stdin.end();
    await Promise.race([
      onceExit(this.process),
      this.connection.closed,
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);
    this.process.kill();
    await Promise.all([
      Promise.race([
        onceExit(this.process),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]),
      Promise.race([
        this.connection.closed,
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]),
    ]);
  }

  async #captureStderr(onTerminalEvent?: (event: AgentTerminalEvent) => void): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.process.stderr) {
      const text = decoder.decode(chunk, { stream: true });
      this.#stderr += text;
      onTerminalEvent?.({ stream: "stderr", chunk: text });
    }
  }
}

interface AcpSessionTurn {
  request: AgentRunRequest;
  output: string;
}

export class AcpAgentConnection {
  readonly #resolved: ResolvedAgentServer;
  readonly #cwd: string;
  readonly #additionalDirectories: string[] | undefined;
  readonly #client: AcpAgentClient;
  readonly #sessions = new Map<string, string>();
  /** Per-ACP-session capability snapshot. Populated on session creation;
   * consulted when applying per-request overrides for `setSessionMode` and
   * `setSessionConfigOption` to validate against the agent's advertised set. */
  readonly #sessionCaps = new Map<string, SessionCapsSnapshot>();
  /** Aggregated AvailableCommand list, seeded by `available_commands_update`
   * session notifications. Forwarded to the capability writer on each refresh. */
  #availableCommands: AgentAvailableCommand[] = [];
  readonly #capabilityWriter: AcpCapabilityWriter | undefined;
  #initializeResponse: acp.InitializeResponse | undefined;
  #capabilityWritten = false;
  #currentTurn: AcpSessionTurn | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(input: {
    resolved: ResolvedAgentServer;
    cwd: string;
    additionalDirectories?: string[];
    onCapabilities?: AcpCapabilityWriter;
  }) {
    this.#resolved = input.resolved;
    this.#cwd = input.cwd;
    this.#additionalDirectories = input.additionalDirectories;
    this.#capabilityWriter = input.onCapabilities;
    this.#client = new AcpAgentClient({
      resolved: input.resolved,
      cwd: input.cwd,
      additionalDirectories: input.additionalDirectories,
      onTerminalEvent: (event) => this.#currentTurn?.request.onTerminalEvent?.(event),
      request: {
        onPermissionRequest: (request) => {
          return this.#currentTurn?.request.onPermissionRequest?.(request) ?? Promise.resolve({ outcome: "cancelled" });
        },
        onSessionUpdate: (event) => {
          this.#captureAvailableCommands(event);
          this.#currentTurn?.request.onSessionUpdate?.(event);
        },
        onElicitationRequest: (request) => {
          return this.#currentTurn?.request.onElicitationRequest?.(request) ?? Promise.resolve({ action: "cancel" });
        },
        onElicitationComplete: (notification) => this.#currentTurn?.request.onElicitationComplete?.(notification),
        onExtMethod: (method, params) => {
          const handler = this.#currentTurn?.request.onExtMethod;
          if (!handler) throw acp.RequestError.methodNotFound(method);
          return handler(method, params);
        },
        onExtNotification: (method, params) => this.#currentTurn?.request.onExtNotification?.(method, params),
      },
      appendOutput: (text) => {
        if (this.#currentTurn) this.#currentTurn.output += text;
      },
    });
  }

  #captureAvailableCommands(event: { update: { sessionUpdate?: string; availableCommands?: unknown } }): void {
    const update = event.update;
    if (update?.sessionUpdate !== "available_commands_update") return;
    const list = Array.isArray(update.availableCommands) ? update.availableCommands : [];
    const next: AgentAvailableCommand[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const raw = item as { name?: unknown; description?: unknown; input?: { hint?: unknown } };
      if (typeof raw.name !== "string" || typeof raw.description !== "string") continue;
      next.push({
        name: raw.name,
        description: raw.description,
        ...(typeof raw.input?.hint === "string" ? { inputHint: raw.input.hint } : {}),
      });
    }
    this.#availableCommands = next;
    void this.#emitCapabilities();
  }

  async #emitCapabilities(): Promise<void> {
    if (!this.#capabilityWriter || !this.#initializeResponse) return;
    // Use the most recently created session's caps as the snapshot, since
    // agents may advertise different modes/configOptions per session in
    // theory. In practice all current agents are uniform per process.
    const lastCaps = lastValue(this.#sessionCaps);
    try {
      await this.#capabilityWriter({
        agentCapabilities: this.#initializeResponse.agentCapabilities ?? {},
        modes: lastCaps?.modes ?? null,
        configOptions: lastCaps?.configOptions ?? null,
        availableCommands: this.#availableCommands,
      });
      this.#capabilityWritten = true;
    } catch {
      // Capability persistence is best-effort; never fail an agent turn for it.
    }
  }

  async start(request: AgentRunRequest): Promise<void> {
    request.onLifecycleEvent?.({
      type: "process_started",
      agentServerId: request.agentServerId,
      command: this.#resolved.command.command,
      args: this.#resolved.command.args,
      at: new Date().toISOString(),
    });
    this.#initializeResponse = await this.#client.initialize();
    request.onLifecycleEvent?.({
      type: "initialized",
      agentServerId: request.agentServerId,
      protocolVersion: this.#initializeResponse.protocolVersion,
      at: new Date().toISOString(),
    });
    if (this.#initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Unsupported ACP protocol version: ${this.#initializeResponse.protocolVersion}`);
    }
  }

  async prompt(request: AgentRunRequest): Promise<AgentRunResult> {
    const run = this.#queue.then(() => this.#prompt(request));
    this.#queue = run.catch(() => {});
    return run;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#queue.catch(() => {});
    await Promise.all([...new Set(this.#sessions.values())]
      .map((sessionId) => this.#client.connection.closeSession({ sessionId }).catch(() => {})));
    await this.#client.close();
  }

  async #prompt(request: AgentRunRequest): Promise<AgentRunResult> {
    if (this.#closed) throw new Error("ACP session is already closed.");
    const resolvedSession = await this.#resolveSession(request);
    const sessionId = resolvedSession.sessionId;
    const turn: AcpSessionTurn = { request, output: "" };
    this.#currentTurn = turn;
    const abort = () => {
      void this.#client.connection.cancel({ sessionId });
    };
    request.signal?.addEventListener("abort", abort);

    try {
      if (request.signal?.aborted) {
        await this.#client.connection.cancel({ sessionId });
        throw new Error("ACP prompt cancelled before start.");
      }

      // Per-node overrides land here, just before the actual prompt turn. We
      // run these EVERY turn (even on re-used sessions) because the user can
      // change mode/model/effort on a per-node basis. Omitting the field on a
      // node intentionally preserves whatever the session already has.
      await applyPerRequestOverrides({
        connection: this.#client.connection,
        sessionId,
        request,
        caps: this.#sessionCaps.get(sessionId),
        resolvedId: this.#resolved.id,
      });

      request.onLifecycleEvent?.({
        type: "prompt_started",
        agentServerId: request.agentServerId,
        sessionId,
        messageId: request.messageId,
        at: new Date().toISOString(),
      });
      const promptResult = await this.#client.connection.prompt({
        sessionId,
        messageId: request.messageId,
        prompt: preparePromptBlocks(request, this.#initializeResponse),
      });
      request.onLifecycleEvent?.({
        type: "prompt_stopped",
        agentServerId: request.agentServerId,
        sessionId,
        stopReason: promptResult.stopReason,
        at: new Date().toISOString(),
      });
      request.onTerminalEvent?.({
        stream: "system",
        chunk: `[acp:stop] ${promptResult.stopReason}\n`,
      });
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: turn.output,
        sessionId,
        stopReason: promptResult.stopReason,
        initializeResponse: this.#initializeResponse,
        workflowSessionId: resolvedSession.workflowSessionId,
        parentWorkflowSessionId: resolvedSession.parentWorkflowSessionId,
        sessionForked: resolvedSession.sessionForked,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.signal?.aborted) {
        request.onLifecycleEvent?.({
          type: "prompt_cancelled",
          agentServerId: request.agentServerId,
          sessionId,
          at: new Date().toISOString(),
        });
      } else {
        request.onLifecycleEvent?.({
          type: "prompt_failed",
          agentServerId: request.agentServerId,
          sessionId,
          error: message,
          at: new Date().toISOString(),
        });
      }
      request.onTerminalEvent?.({ stream: "system", chunk: `${message}\n` });
      return {
        agentServerId: request.agentServerId,
        exitCode: 1,
        output: turn.output || message,
        sessionId,
        initializeResponse: this.#initializeResponse,
        workflowSessionId: resolvedSession.workflowSessionId,
        parentWorkflowSessionId: resolvedSession.parentWorkflowSessionId,
        sessionForked: resolvedSession.sessionForked,
      };
    } finally {
      request.signal?.removeEventListener("abort", abort);
      this.#currentTurn = undefined;
    }
  }

  async #resolveSession(request: AgentRunRequest): Promise<{
    sessionId: string;
    workflowSessionId?: string;
    parentWorkflowSessionId?: string;
    sessionForked?: boolean;
  }> {
    const key = request.workflowSessionId;
    if (!key) {
      const session = await this.#createSession(request);
      return { sessionId: session };
    }
    const existing = this.#sessions.get(key);
    if (existing) return { sessionId: existing, workflowSessionId: key };

    if (request.restoreFromAcpSessionId) {
      const sessionId = await this.#restoreSession(request, request.restoreFromAcpSessionId);
      this.#sessions.set(key, sessionId);
      return { sessionId, workflowSessionId: key };
    }

    if (request.forkFromWorkflowSessionId) {
      const parentKey = request.forkFromWorkflowSessionId;
      const parentSessionId = this.#sessions.get(parentKey);
      if (!parentSessionId) {
        throw new Error(`Cannot fork missing workflow session "${parentKey}".`);
      }
      if (this.#initializeResponse?.agentCapabilities?.sessionCapabilities?.fork) {
        const forked = await this.#client.connection.unstable_forkSession({
          sessionId: parentSessionId,
          cwd: this.#cwd,
          additionalDirectories: this.#additionalDirectories,
          mcpServers: request.mcpServers ?? [],
        });
        this.#sessions.set(key, forked.sessionId);
        request.onLifecycleEvent?.({
          type: "session_forked",
          agentServerId: request.agentServerId,
          sessionId: forked.sessionId,
          parentSessionId,
          at: new Date().toISOString(),
        });
        return {
          sessionId: forked.sessionId,
          workflowSessionId: key,
          parentWorkflowSessionId: parentKey,
          sessionForked: true,
        };
      }
      return {
        sessionId: parentSessionId,
        workflowSessionId: parentKey,
        sessionForked: false,
      };
    }

    const sessionId = await this.#createSession(request);
    this.#sessions.set(key, sessionId);
    return { sessionId, workflowSessionId: key };
  }

  async #createSession(request: AgentRunRequest): Promise<string> {
    const session = await this.#client.connection.newSession({
      cwd: this.#cwd,
      additionalDirectories: this.#additionalDirectories,
      mcpServers: request.mcpServers ?? [],
    });
    request.onLifecycleEvent?.({
      type: "session_created",
      agentServerId: request.agentServerId,
      sessionId: session.sessionId,
      at: new Date().toISOString(),
    });
    this.#sessionCaps.set(session.sessionId, snapshotSession(session));
    await applySessionDefaults(this.#client.connection, session.sessionId, session, this.#resolved);
    // Push initial capabilities even before any available_commands_update
    // arrives, so the UI has something to render after the first session
    // creation completes. The update handler will rewrite once commands ship.
    if (!this.#capabilityWritten) void this.#emitCapabilities();
    return session.sessionId;
  }

  async #restoreSession(request: AgentRunRequest, acpSessionId: string): Promise<string> {
    const supportsLoad = Boolean(this.#initializeResponse?.agentCapabilities?.loadSession);
    const supportsResume = Boolean(this.#initializeResponse?.agentCapabilities?.sessionCapabilities?.resume);
    if (!supportsLoad && !supportsResume) {
      throw new Error(
        `Agent "${request.agentServerId}" does not support session load/resume; cannot continue ACP session ${acpSessionId}.`,
      );
    }
    if (supportsLoad) {
      await this.#client.connection.loadSession({
        sessionId: acpSessionId,
        cwd: this.#cwd,
        additionalDirectories: this.#additionalDirectories,
        mcpServers: request.mcpServers ?? [],
      });
    } else {
      await this.#client.connection.resumeSession({
        sessionId: acpSessionId,
        cwd: this.#cwd,
        additionalDirectories: this.#additionalDirectories,
        mcpServers: request.mcpServers ?? [],
      });
    }
    // The session is already "created" historically; emit a normal
    // session_created so downstream attribution treats it the same as a fresh
    // session belonging to this connection.
    request.onLifecycleEvent?.({
      type: "session_created",
      agentServerId: request.agentServerId,
      sessionId: acpSessionId,
      at: new Date().toISOString(),
    });
    return acpSessionId;
  }
}

export async function runAcpAgent(
  resolved: ResolvedAgentServer,
  request: AgentRunRequest,
  options?: { onCapabilities?: AcpCapabilityWriter },
): Promise<AgentRunResult> {
  let output = "";
  let sessionId: string | undefined;
  let initializeResponse: acp.InitializeResponse | undefined;
  let sessionCaps: SessionCapsSnapshot | undefined;
  const availableCommands: AgentAvailableCommand[] = [];
  const baseOnSessionUpdate = request.onSessionUpdate;
  const wrappedRequest: AgentRunRequest = {
    ...request,
    onSessionUpdate: (event) => {
      const update = event.update as { sessionUpdate?: string; availableCommands?: unknown };
      if (update?.sessionUpdate === "available_commands_update") {
        availableCommands.length = 0;
        if (Array.isArray(update.availableCommands)) {
          for (const item of update.availableCommands) {
            if (!item || typeof item !== "object") continue;
            const raw = item as { name?: unknown; description?: unknown; input?: { hint?: unknown } };
            if (typeof raw.name !== "string" || typeof raw.description !== "string") continue;
            availableCommands.push({
              name: raw.name,
              description: raw.description,
              ...(typeof raw.input?.hint === "string" ? { inputHint: raw.input.hint } : {}),
            });
          }
        }
        if (options?.onCapabilities && initializeResponse) {
          void Promise.resolve(options.onCapabilities({
            agentCapabilities: initializeResponse.agentCapabilities ?? {},
            modes: sessionCaps?.modes ?? null,
            configOptions: sessionCaps?.configOptions ?? null,
            availableCommands: [...availableCommands],
          })).catch(() => {});
        }
      }
      baseOnSessionUpdate?.(event);
    },
  };
  const client = new AcpAgentClient({
    resolved,
    cwd: request.cwd,
    additionalDirectories: request.additionalDirectories,
    onTerminalEvent: request.onTerminalEvent,
    request: wrappedRequest,
    appendOutput(text) { output += text; },
  });

  const abort = () => {
    if (sessionId) void client.connection.cancel({ sessionId });
  };
  request.signal?.addEventListener("abort", abort);

  try {
    request.onLifecycleEvent?.({
      type: "process_started",
      agentServerId: request.agentServerId,
      command: resolved.command.command,
      args: resolved.command.args,
      at: new Date().toISOString(),
    });
    initializeResponse = await client.initialize();
    request.onLifecycleEvent?.({
      type: "initialized",
      agentServerId: request.agentServerId,
      protocolVersion: initializeResponse.protocolVersion,
      at: new Date().toISOString(),
    });
    if (initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Unsupported ACP protocol version: ${initializeResponse.protocolVersion}`);
    }
    const session = await client.connection.newSession({
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      mcpServers: request.mcpServers ?? [],
    });
    sessionId = session.sessionId;
    sessionCaps = snapshotSession(session);
    request.onLifecycleEvent?.({
      type: "session_created",
      agentServerId: request.agentServerId,
      sessionId,
      at: new Date().toISOString(),
    });
    if (options?.onCapabilities) {
      try {
        await options.onCapabilities({
          agentCapabilities: initializeResponse.agentCapabilities ?? {},
          modes: sessionCaps.modes,
          configOptions: sessionCaps.configOptions,
          availableCommands: [...availableCommands],
        });
      } catch {
        // Best-effort capability persistence.
      }
    }
    await applySessionDefaults(client.connection, sessionId, session, resolved);
    await applyPerRequestOverrides({
      connection: client.connection,
      sessionId,
      request,
      caps: sessionCaps,
      resolvedId: resolved.id,
    });

    if (request.signal?.aborted) {
      await client.connection.cancel({ sessionId });
      throw new Error("ACP prompt cancelled before start.");
    }

    request.onLifecycleEvent?.({
      type: "prompt_started",
      agentServerId: request.agentServerId,
      sessionId,
      messageId: request.messageId,
      at: new Date().toISOString(),
    });
    const promptResult = await client.connection.prompt({
      sessionId,
      messageId: request.messageId,
      prompt: preparePromptBlocks(request, initializeResponse),
    });
    request.onLifecycleEvent?.({
      type: "prompt_stopped",
      agentServerId: request.agentServerId,
      sessionId,
      stopReason: promptResult.stopReason,
      at: new Date().toISOString(),
    });
    request.onTerminalEvent?.({
      stream: "system",
      chunk: `[acp:stop] ${promptResult.stopReason}\n`,
    });
    await client.connection.closeSession({ sessionId }).catch(() => {});
    request.onLifecycleEvent?.({
      type: "session_closed",
      agentServerId: request.agentServerId,
      sessionId,
      at: new Date().toISOString(),
    });
    await client.close();
    return {
      agentServerId: request.agentServerId,
      exitCode: 0,
      output,
      sessionId,
      stopReason: promptResult.stopReason,
      initializeResponse,
    };
  } catch (error) {
    if (sessionId) await client.connection.closeSession({ sessionId }).catch(() => {});
    client.kill();
    const message = error instanceof Error ? error.message : String(error);
    if (request.signal?.aborted) {
      request.onLifecycleEvent?.({
        type: "prompt_cancelled",
        agentServerId: request.agentServerId,
        sessionId,
        at: new Date().toISOString(),
      });
    } else {
      request.onLifecycleEvent?.({
        type: "prompt_failed",
        agentServerId: request.agentServerId,
        sessionId,
        error: message,
        at: new Date().toISOString(),
      });
    }
    request.onTerminalEvent?.({ stream: "system", chunk: `${message}\n` });
    return {
      agentServerId: request.agentServerId,
      exitCode: 1,
      output: output || message,
      sessionId,
      initializeResponse,
    };
  } finally {
    request.signal?.removeEventListener("abort", abort);
  }
}

export function selectAcpRestorePrimitive(
  mode: AgentRestoreMode,
  initializeResponse: acp.InitializeResponse,
): AgentRestorePrimitive {
  const supportsLoad = Boolean(initializeResponse.agentCapabilities?.loadSession);
  const supportsResume = Boolean(initializeResponse.agentCapabilities?.sessionCapabilities?.resume);

  if (supportsLoad) return "load";
  if (supportsResume) return "resume";

  throw new Error(
    `ACP agent does not support session restore. loadSession=${supportsLoad}, resume=${supportsResume}`,
  );
}

export async function restoreAcpAgentSession(
  resolved: ResolvedAgentServer,
  request: AgentRestoreRequest,
): Promise<AgentRestoreResult> {
  const client = new AcpAgentClient({
    resolved,
    cwd: request.cwd,
    additionalDirectories: request.additionalDirectories,
    onTerminalEvent: request.onTerminalEvent,
    request,
    appendOutput() {},
  });
  const abort = () => {
    client.kill();
  };
  request.signal?.addEventListener("abort", abort);

  try {
    const initializeResponse = await client.initialize();
    if (initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Unsupported ACP protocol version: ${initializeResponse.protocolVersion}`);
    }
    const selectedPrimitive = selectAcpRestorePrimitive(request.mode, initializeResponse);
    if (selectedPrimitive === "load") {
      const loadResponse = await raceWithAbort(client.connection.loadSession({
        sessionId: request.sessionId,
        cwd: request.cwd,
        additionalDirectories: request.additionalDirectories,
        mcpServers: request.mcpServers ?? [],
      }), request.signal, "ACP restore cancelled.");
      await client.connection.closeSession({ sessionId: request.sessionId }).catch(() => {});
      await client.close();
      return {
        agentServerId: request.agentServerId,
        sessionId: request.sessionId,
        selectedPrimitive,
        initializeResponse,
        loadResponse,
      };
    }

    const resumeResponse = await raceWithAbort(client.connection.resumeSession({
      sessionId: request.sessionId,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      mcpServers: request.mcpServers ?? [],
    }), request.signal, "ACP restore cancelled.");
    await client.connection.closeSession({ sessionId: request.sessionId }).catch(() => {});
    await client.close();
    return {
      agentServerId: request.agentServerId,
      sessionId: request.sessionId,
      selectedPrimitive,
      initializeResponse,
      resumeResponse,
    };
  } catch (error) {
    client.kill();
    throw error;
  } finally {
    request.signal?.removeEventListener("abort", abort);
    await client.close().catch(() => {});
  }
}

export class AcpRestoredConversation implements AgentConversation {
  readonly #request: AgentRestoreRequest;
  readonly #client: AcpAgentClient;
  #initializeResponse: acp.InitializeResponse | undefined;
  #output = "";
  #restored = false;
  #closed = false;

  constructor(resolved: ResolvedAgentServer, request: AgentRestoreRequest) {
    this.#request = request;
    this.#client = new AcpAgentClient({
      resolved,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      onTerminalEvent: request.onTerminalEvent,
      request,
      appendOutput: (text) => { this.#output += text; },
    });
  }

  async restore(): Promise<AgentRestoreResult> {
    if (this.#restored) throw new Error("ACP conversation is already restored.");
    this.#initializeResponse = await this.#client.initialize();
    assertProtocolVersion(this.#initializeResponse);
    const selectedPrimitive = selectAcpRestorePrimitive(this.#request.mode, this.#initializeResponse);
    if (selectedPrimitive === "load") {
      const loadResponse = await raceWithAbort(this.#client.connection.loadSession({
        sessionId: this.#request.sessionId,
        cwd: this.#request.cwd,
        additionalDirectories: this.#request.additionalDirectories,
        mcpServers: this.#request.mcpServers ?? [],
      }), this.#request.signal, "ACP restore cancelled.");
      this.#restored = true;
      return {
        agentServerId: this.#request.agentServerId,
        sessionId: this.#request.sessionId,
        selectedPrimitive,
        initializeResponse: this.#initializeResponse,
        loadResponse,
      };
    }
    const resumeResponse = await raceWithAbort(this.#client.connection.resumeSession({
      sessionId: this.#request.sessionId,
      cwd: this.#request.cwd,
      additionalDirectories: this.#request.additionalDirectories,
      mcpServers: this.#request.mcpServers ?? [],
    }), this.#request.signal, "ACP restore cancelled.");
    this.#restored = true;
    return {
      agentServerId: this.#request.agentServerId,
      sessionId: this.#request.sessionId,
      selectedPrimitive,
      initializeResponse: this.#initializeResponse,
      resumeResponse,
    };
  }

  async prompt(prompt: string, signal?: AbortSignal): Promise<AgentConversationPromptResult> {
    if (!this.#restored || this.#closed) throw new Error("ACP conversation is not active.");
    if (prompt.trim() === "") throw new Error("Prompt must not be empty.");
    this.#output = "";
    const response = await raceWithAbort(this.#client.connection.prompt({
      sessionId: this.#request.sessionId,
      prompt: [{ type: "text", text: prompt }],
    }), signal, "ACP conversation prompt cancelled.");
    return { output: this.#output, stopReason: response.stopReason };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#restored) {
      await this.#client.connection.closeSession({ sessionId: this.#request.sessionId }).catch(() => {});
    }
    await this.#client.close().catch(() => {});
  }
}

/**
 * One-shot capability probe: spawn the agent, initialize, create an empty
 * session, snapshot what was advertised, and tear everything down. Used by
 * the `POST /api/agent-servers/:id/capabilities/refresh` endpoint when the
 * user knows their settings changed without an installedVersion bump (env
 * vars, args, etc.) and wants the cached capability snapshot rebuilt.
 *
 * Briefly waits (`commandSettleMs`) after newSession for the agent to push
 * an `available_commands_update` notification — many agents send this
 * synchronously, but some defer it a tick. Skipping the wait would leave
 * the cached availableCommands list empty until the first real run.
 */
export async function probeAcpAgentCapabilities(input: {
  resolved: ResolvedAgentServer;
  cwd: string;
  signal?: AbortSignal;
  /** How long to wait after newSession for available_commands_update. Default 750ms. */
  commandSettleMs?: number;
}): Promise<AcpProbedCapabilities> {
  const availableCommands: AgentAvailableCommand[] = [];
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
  const client = new AcpAgentClient({
    resolved: input.resolved,
    cwd: input.cwd,
    request: {
      onSessionUpdate: (event) => {
        const update = event.update as { sessionUpdate?: string; availableCommands?: unknown };
        if (update?.sessionUpdate !== "available_commands_update") return;
        availableCommands.length = 0;
        if (Array.isArray(update.availableCommands)) {
          for (const item of update.availableCommands) {
            if (!item || typeof item !== "object") continue;
            const raw = item as { name?: unknown; description?: unknown; input?: { hint?: unknown } };
            if (typeof raw.name !== "string" || typeof raw.description !== "string") continue;
            availableCommands.push({
              name: raw.name,
              description: raw.description,
              ...(typeof raw.input?.hint === "string" ? { inputHint: raw.input.hint } : {}),
            });
          }
        }
        resolveSettled();
      },
    },
    appendOutput() {},
  });
  let sessionId: string | undefined;
  try {
    const initializeResponse = await raceWithAbort(client.initialize(), input.signal, "ACP probe cancelled.");
    assertProtocolVersion(initializeResponse);
    const session = await raceWithAbort(client.connection.newSession({
      cwd: input.cwd,
      additionalDirectories: input.resolved.settings.additionalDirectories,
      mcpServers: [],
    }), input.signal, "ACP probe cancelled.");
    sessionId = session.sessionId;
    // Best-effort wait for available_commands_update; do not block forever
    // if the agent never sends one.
    const settleMs = input.commandSettleMs ?? 750;
    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, settleMs)),
    ]);
    return {
      agentCapabilities: initializeResponse.agentCapabilities ?? {},
      modes: session.modes ?? null,
      configOptions: session.configOptions ?? null,
      availableCommands,
    };
  } finally {
    if (sessionId) await client.connection.closeSession({ sessionId }).catch(() => {});
    await client.close().catch(() => {});
  }
}

export async function inspectAcpAgentAuthentication(
  resolved: ResolvedAgentServer,
  cwd: string,
): Promise<AgentAuthenticationStatus> {
  const client = createAuthClient(resolved, cwd);
  try {
    const initializeResponse = await client.initialize();
    assertProtocolVersion(initializeResponse);
    return await inspectInitializedAuthentication(client.connection, initializeResponse, resolved, cwd);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function authenticateAcpAgent(
  resolved: ResolvedAgentServer,
  cwd: string,
  methodId: string,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): Promise<AgentAuthenticationStatus> {
  const client = createAuthClient(resolved, cwd, onTerminalEvent);
  try {
    const initializeResponse = await client.initialize();
    assertProtocolVersion(initializeResponse);
    const method = (initializeResponse.authMethods ?? []).find((candidate) => candidate.id === methodId);
    if (!method) {
      throw new Error(`ACP agent "${resolved.id}" does not advertise auth method "${methodId}".`);
    }
    if (isEnvAuthMethod(method)) {
      const missing = missingEnvVars(method, resolved);
      if (missing.length > 0) {
        throw new Error(`ACP agent "${resolved.id}" requires authentication env vars: ${missing.join(", ")}`);
      }
    }
    if (isTerminalAuthMethod(method)) {
      if (!resolved.settings.terminal?.auth) {
        throw new Error(
          `ACP agent "${resolved.id}" requires terminal authentication, but terminal auth is disabled. Set terminal.auth=true on the agent server.`,
        );
      }
      await runTerminalAuthMethod(resolved, cwd, method, onTerminalEvent);
      return await inspectInitializedAuthentication(client.connection, initializeResponse, resolved, cwd);
    }
    await client.connection.authenticate({ methodId: method.id });
    return await inspectInitializedAuthentication(client.connection, initializeResponse, resolved, cwd);
  } finally {
    await client.close().catch(() => {});
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, message: string): Promise<T> {
  if (!signal) return promise;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal?.aborted) {
      reject(new Error(message));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error(message)), { once: true });
  });
  return Promise.race([promise, abortPromise]);
}

function createAuthClient(
  resolved: ResolvedAgentServer,
  cwd: string,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): AcpAgentClient {
  return new AcpAgentClient({
    resolved,
    cwd,
    onTerminalEvent,
    request: {},
    appendOutput() {},
  });
}

function assertProtocolVersion(initializeResponse: acp.InitializeResponse): void {
  if (initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
    throw new Error(`Unsupported ACP protocol version: ${initializeResponse.protocolVersion}`);
  }
}

async function inspectInitializedAuthentication(
  connection: acp.ClientSideConnection,
  initializeResponse: acp.InitializeResponse,
  resolved: ResolvedAgentServer,
  cwd: string,
): Promise<AgentAuthenticationStatus> {
  const methods = initializeResponse.authMethods ?? [];
  let needsAuth = !(await isAgentAuthenticated(connection, resolved, cwd));

  if (needsAuth) {
    const configuredEnvMethod = methods.find((method) =>
      isEnvAuthMethod(method) && missingEnvVars(method, resolved).length === 0
    );
    if (configuredEnvMethod) {
      try {
        await connection.authenticate({ methodId: configuredEnvMethod.id });
        needsAuth = !(await isAgentAuthenticated(connection, resolved, cwd));
      } catch {
        // Keep the auth prompt available when a stored credential is rejected.
      }
    }
  }

  return {
    agentServerId: resolved.id,
    needsAuth,
    methods: authMethodInfos(methods, resolved),
  };
}

async function isAgentAuthenticated(
  connection: acp.ClientSideConnection,
  resolved: ResolvedAgentServer,
  cwd: string,
): Promise<boolean> {
  const profile = resolved.settings.type === "registry"
    ? supportedRegistryAgentProfile(resolved.settings.registryId)
    : undefined;
  const probe = profile?.authenticationProbe;
  if (!probe || probe.type === "acp_session") {
    return canCreateSessionWithoutAuth(connection, cwd);
  }
  return commandJsonReportsAuthenticated(resolved, cwd, probe.args, probe.authenticatedField);
}

async function canCreateSessionWithoutAuth(
  connection: acp.ClientSideConnection,
  cwd: string,
): Promise<boolean> {
  try {
    await connection.newSession({ cwd, mcpServers: [] });
    return true;
  } catch (error) {
    if (isAuthRequiredError(error)) return false;
    throw error;
  }
}

async function commandJsonReportsAuthenticated(
  resolved: ResolvedAgentServer,
  cwd: string,
  args: string[],
  authenticatedField: string,
): Promise<boolean> {
  const child = spawn(resolved.command.command, [...resolved.command.args, ...args], {
    cwd,
    env: { ...process.env, ...(resolved.command.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await onceExit(child);

  let status: Record<string, unknown>;
  try {
    status = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(
      `ACP authentication status command failed for "${resolved.id}": ${stderr.trim() || stdout.trim() || `exit code ${child.exitCode ?? "unknown"}`}`,
    );
  }
  const authenticated = status[authenticatedField];
  if (typeof authenticated !== "boolean") {
    throw new Error(`ACP authentication status command for "${resolved.id}" did not return boolean field "${authenticatedField}".`);
  }
  return authenticated;
}

function isAuthRequiredError(error: unknown): boolean {
  if (error instanceof acp.RequestError && error.code === -32000) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /auth(?:entication)?[_ -]?required/i.test(message);
}

function authMethodInfos(
  methods: acp.AuthMethod[],
  resolved: ResolvedAgentServer,
): AgentAuthenticationMethod[] {
  return methods.map((method) => {
    const common = {
      id: method.id,
      name: method.name,
      ...("description" in method && method.description ? { description: method.description } : {}),
    };
    if (isEnvAuthMethod(method)) {
      return {
        ...common,
        type: "env_var",
        ...("link" in method && method.link ? { link: method.link } : {}),
        vars: method.vars.map((entry) => ({
          name: entry.name,
          ...(entry.label ? { label: entry.label } : {}),
          secret: entry.secret ?? true,
          optional: entry.optional ?? false,
        })),
        missingVars: missingEnvVars(method, resolved),
      };
    }
    if (isTerminalAuthMethod(method)) {
      return {
        ...common,
        type: "terminal",
        terminalEnabled: resolved.settings.terminal?.auth ?? false,
      };
    }
    return {
      ...common,
      type: "agent",
    };
  });
}

function isEnvAuthMethod(method: acp.AuthMethod): method is Extract<acp.AuthMethod, { type: "env_var" }> {
  return "type" in method && method.type === "env_var";
}

function isTerminalAuthMethod(method: acp.AuthMethod): method is Extract<acp.AuthMethod, { type: "terminal" }> {
  return "type" in method && method.type === "terminal";
}

function missingEnvVars(method: Extract<acp.AuthMethod, { type: "env_var" }>, resolved: ResolvedAgentServer): string[] {
  const env = { ...process.env, ...(resolved.command.env ?? {}) };
  return method.vars
    .filter((entry) => !entry.optional && !env[entry.name])
    .map((entry) => entry.name);
}

async function runTerminalAuthMethod(
  resolved: ResolvedAgentServer,
  cwd: string,
  method: Extract<acp.AuthMethod, { type: "terminal" }>,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): Promise<void> {
  if (!onTerminalEvent) {
    const child = spawn(resolved.command.command, [...resolved.command.args, ...(method.args ?? [])], {
      cwd,
      env: { ...process.env, ...(resolved.command.env ?? {}), ...(method.env ?? {}) },
      stdio: "inherit",
    });
    await onceExit(child);
    if (child.exitCode !== 0) {
      throw new Error(`ACP terminal auth failed for "${resolved.id}" with exit code ${child.exitCode ?? "unknown"}.`);
    }
    return;
  }

  const child = spawn(resolved.command.command, [...resolved.command.args, ...(method.args ?? [])], {
    cwd,
    env: { ...process.env, ...(resolved.command.env ?? {}), ...(method.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => onTerminalEvent?.({ stream: "stdout", chunk: chunk.toString() }));
  child.stderr.on("data", (chunk) => onTerminalEvent?.({ stream: "stderr", chunk: chunk.toString() }));
  await onceExit(child);
  if (child.exitCode !== 0) {
    throw new Error(`ACP terminal auth failed for "${resolved.id}" with exit code ${child.exitCode ?? "unknown"}.`);
  }
}

async function applySessionDefaults(
  connection: acp.ClientSideConnection,
  sessionId: string,
  session: acp.NewSessionResponse,
  resolved: ResolvedAgentServer,
): Promise<void> {
  const mode = resolved.settings.defaultMode;
  if (mode) {
    const availableModes = session.modes?.availableModes ?? [];
    if (!availableModes.some((candidate) => candidate.id === mode)) {
      throw new Error(`Configured ACP mode "${mode}" is not advertised by ${resolved.id}.`);
    }
    await connection.setSessionMode({ sessionId, modeId: mode });
  }

  const model = resolved.settings.defaultModel;
  if (model) {
    const availableModels = session.models?.availableModels ?? [];
    if (!availableModels.some((candidate) => candidate.modelId === model)) {
      throw new Error(`Configured ACP model "${model}" is not advertised by ${resolved.id}.`);
    }
    await connection.unstable_setSessionModel({ sessionId, modelId: model });
  }

  for (const [configId, value] of Object.entries(resolved.settings.defaultConfigOptions ?? {})) {
    const option = session.configOptions?.find((candidate) => candidate.id === configId);
    if (!option) {
      throw new Error(`Configured ACP config option "${configId}" is not advertised by ${resolved.id}.`);
    }
    if (option.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`Configured ACP config option "${configId}" expects a boolean value.`);
      }
      await connection.setSessionConfigOption({ sessionId, configId, type: "boolean", value });
      continue;
    }

    const stringValue = String(value);
    if (!selectOptionValues(option).has(stringValue)) {
      throw new Error(`Configured ACP config option "${configId}" value "${stringValue}" is not advertised by ${resolved.id}.`);
    }
    await connection.setSessionConfigOption({ sessionId, configId, value: stringValue });
  }
}

/**
 * Per-prompt override of mode / configOptions / model. Runs every turn, on
 * both fresh and re-used sessions. Caller must pass the cached
 * `NewSessionResponse` slice so we can validate the requested values against
 * what the agent advertised at session creation.
 */
async function applyPerRequestOverrides(input: {
  connection: acp.ClientSideConnection;
  sessionId: string;
  request: Pick<AgentRunRequest, "modeId" | "configOptions">;
  caps: SessionCapsSnapshot | undefined;
  resolvedId: string;
}): Promise<void> {
  const { connection, sessionId, request, caps, resolvedId } = input;
  if (request.modeId) {
    const available = caps?.modes?.availableModes ?? [];
    if (available.length > 0 && !available.some((m) => m.id === request.modeId)) {
      throw new Error(`Per-node ACP mode "${request.modeId}" is not advertised by ${resolvedId}.`);
    }
    await connection.setSessionMode({ sessionId, modeId: request.modeId });
  }
  for (const [configId, value] of Object.entries(request.configOptions ?? {})) {
    if (configId === "model") {
      const modelId = String(value);
      const available = caps?.models?.availableModels ?? [];
      if (available.length > 0 && !available.some((m) => m.modelId === modelId)) {
        throw new Error(`Per-node ACP model "${modelId}" is not advertised by ${resolvedId}.`);
      }
      await connection.unstable_setSessionModel({ sessionId, modelId });
      continue;
    }
    const option = caps?.configOptions?.find((candidate) => candidate.id === configId);
    if (!option) {
      // No cached option metadata — pass through and let the agent reject if
      // invalid. We deliberately do not throw, because some agents may accept
      // options that were added after our cache snapshot was taken.
      const stringValue = typeof value === "boolean" ? value : String(value);
      await connection.setSessionConfigOption(
        typeof stringValue === "boolean"
          ? { sessionId, configId, type: "boolean", value: stringValue }
          : { sessionId, configId, value: stringValue },
      );
      continue;
    }
    if (option.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`Per-node ACP config option "${configId}" expects a boolean value.`);
      }
      await connection.setSessionConfigOption({ sessionId, configId, type: "boolean", value });
      continue;
    }
    const stringValue = String(value);
    if (!selectOptionValues(option).has(stringValue)) {
      throw new Error(`Per-node ACP config option "${configId}" value "${stringValue}" is not advertised by ${resolvedId}.`);
    }
    await connection.setSessionConfigOption({ sessionId, configId, value: stringValue });
  }
}

interface SessionCapsSnapshot {
  modes: acp.SessionModeState | null;
  configOptions: acp.SessionConfigOption[] | null;
  models: NonNullable<acp.NewSessionResponse["models"]> | null;
}

function snapshotSession(session: acp.NewSessionResponse): SessionCapsSnapshot {
  return {
    modes: session.modes ?? null,
    configOptions: session.configOptions ?? null,
    models: session.models ?? null,
  };
}

function lastValue<T>(map: Map<string, T>): T | undefined {
  let last: T | undefined;
  for (const value of map.values()) last = value;
  return last;
}

function selectOptionValues(option: Extract<acp.SessionConfigOption, { type: "select" }>): Set<string> {
  const values = new Set<string>();
  for (const entry of option.options) {
    if ("value" in entry) {
      values.add(entry.value);
      continue;
    }
    for (const child of entry.options) values.add(child.value);
  }
  return values;
}

function preparePromptBlocks(
  request: Pick<AgentRunRequest, "prompt" | "promptBlocks">,
  initializeResponse: acp.InitializeResponse | undefined,
): acp.ContentBlock[] {
  const blocks = request.promptBlocks ?? [{ type: "text", text: request.prompt } satisfies acp.ContentBlock];
  const capabilities = initializeResponse?.agentCapabilities?.promptCapabilities;

  return blocks.map((block) => {
    if (block.type === "text" || block.type === "resource_link") {
      return block;
    }

    if (block.type === "image") {
      if (capabilities?.image) return block;
      return resourceLinkFromPromptBlock(block.uri, "image", block.mimeType);
    }

    if (block.type === "audio") {
      if (capabilities?.audio) return block;
      return resourceLinkFromPromptBlock(
        metaString(block._meta, "specflowUri"),
        metaString(block._meta, "specflowName") ?? "audio",
        block.mimeType,
      );
    }

    if (block.type === "resource") {
      if (capabilities?.embeddedContext) return block;
      const resource = block.resource;
      return {
        type: "resource_link",
        uri: resource.uri,
        name: nameFromUri(resource.uri),
        mimeType: resource.mimeType ?? null,
      };
    }

    return block;
  });
}

function resourceLinkFromPromptBlock(
  uri: string | null | undefined,
  name: string,
  mimeType: string | null | undefined,
): acp.ContentBlock {
  return {
    type: "resource_link",
    uri: uri ?? `specflow:${name}`,
    name: uri ? nameFromUri(uri) : name,
    mimeType: mimeType ?? null,
  };
}

function nameFromUri(uri: string): string {
  try {
    const url = new URL(uri);
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : uri;
  } catch {
    const lastSegment = uri.split("/").filter(Boolean).at(-1);
    return lastSegment ?? uri;
  }
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" ? value : undefined;
}

async function onceExit(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}
