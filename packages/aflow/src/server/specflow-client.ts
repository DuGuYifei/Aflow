import type { AgentServerEntry } from "@specflow/agent-proxy";
import type { AgentFlowDoc, CanvasDoc, CanvasLayoutDoc, RunGraphOperation } from "@specflow/server";

export interface SpecflowHealth {
  app: string;
  ok: boolean;
  sessions: number;
  startedAt: string;
  workspaceRoot?: string;
  serverId?: string;
  apiVersion?: number;
}

export interface RunRecordSummary {
  id: string;
  runId?: string;
  workflowId: string;
  status: string;
  resumedFromRunId?: string;
  resumedByRunId?: string;
  errorMsg?: string;
}

export interface CanvasSummary {
  id: string;
  name: string;
  local?: boolean;
  runs?: number;
}

export interface RunRecordDetail extends RunRecordSummary {
  label?: string;
  activeNode?: string;
  pausedNodeId?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  nodeStates?: Record<string, string>;
  nodeOutputs?: Record<string, string>;
  control?: {
    intent?: unknown;
    pauseRequested?: boolean;
    interruptedNodeId?: string;
    reason?: string;
  };
  checkpoint?: {
    pendingCompletion?: {
      nodeId?: string;
      output?: string;
    };
    suspension?: {
      nodeId?: string;
      source?: string;
    };
    interruptedNodeId?: string;
    activeNodeId?: string;
    [key: string]: unknown;
  };
  agentflowSnapshot?: AgentFlowDoc;
  canvasSnapshot?: CanvasLayoutDoc;
  snapshotRevision?: number;
  snapshotEditedAt?: string;
  snapshotEditSummary?: string;
  initialInput?: string;
  variableValues?: Record<string, string>;
  agentInvocations?: Array<{
    id?: string;
    nodeId?: string;
    nodeRunId?: string;
    agentId?: string;
    agentServerId?: string;
    acpSessionId?: string;
    status?: string;
  }>;
  agentSessions?: unknown[];
}

export interface RunLogEvent {
  type: string;
  runId: string;
  nodeId?: string;
  nodeRunId?: string;
  edgeId?: string;
  agentInvocationId?: string;
  agentId?: string;
  agentServerId?: string;
  specflowSessionId?: string;
  sessionId?: string;
  status?: string;
  at?: string;
  chunk?: string;
  stream?: string;
  prompt?: string;
  update?: unknown;
  [key: string]: unknown;
}

export interface RunLogEventPage {
  events: RunLogEvent[];
  total: number;
  startIndex: number;
}

export type RuntimeEditClass = "current" | "future" | "history_future" | "history_only" | "inactive";

export interface RunReachability {
  nodes: Record<string, RuntimeEditClass>;
  edges?: Record<string, string>;
  [key: string]: unknown;
}

export interface RunGraphPatchResponse {
  ok: boolean;
  snapshotRevision?: number;
  snapshot?: CanvasDoc;
  reachability?: RunReachability;
  appliedOperations?: Array<{ index: number; op: string; status: "applied" | "skipped" }>;
  rejectedOperations?: Array<{ index: number; op: string; code: string; message: string; nodeId?: string; edgeId?: string }>;
  migrationPreview?: unknown;
  topologyCapabilities?: unknown;
}

export interface PausedNodeSession {
  runId: string;
  nodeId: string;
  specflowSessionId: string;
  agentServerId: string;
  pausedAt: string;
}

export interface ResumableSessionSummary {
  agentSessionId: string;
  acpSessionId?: string;
  agentServerId: string;
  nodeId?: string;
  continuationPrompt: string;
  canLoad: boolean;
  canResume: boolean;
}

export interface AgentSessionInvocationRef {
  runId: string;
  invocationId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
}

export interface AgentSessionRecord {
  id: string;
  workflowId: string;
  specflowSessionId?: string;
  parentSpecflowSessionId?: string;
  agentId: string;
  agentServerId: string;
  acpSessionId: string;
  acpSupportsLoadSession: boolean;
  acpSupportsResumeSession: boolean;
  acpSupportsForkSession: boolean;
  acpSessionForked: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  latestRunId: string;
  latestInvocationId: string;
  latestStatus: string;
  runIds: string[];
  invocationIds: string[];
  invocations: AgentSessionInvocationRef[];
  restoreAttempts: Array<{
    id: string;
    requestedMode: "inspect" | "continue";
    selectedPrimitive?: "load" | "resume";
    status: "requested" | "success" | "failure";
    startedAt: string;
    completedAt?: string;
    error?: string;
  }>;
}

export type AgentRestoreMode = "inspect" | "continue";

export interface AgentSessionRestoreStarted {
  restoreId: string;
  agentSessionId: string;
  runId: string;
  status: "running";
  requestedMode: AgentRestoreMode;
}

export interface RunInteraction {
  id: string;
  kind: "permission" | "elicitation";
  status: "pending" | "resolved" | "cancelled";
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId?: string;
  createdAt: string;
  resolvedAt?: string;
  resolution?: unknown;
  toolCall?: unknown;
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
  request?: unknown;
}

export type RestoreStreamEvent =
  | {
      type: "restore-status";
      restoreId: string;
      agentSessionId: string;
      runId: string;
      requestedMode: AgentRestoreMode;
      selectedPrimitive?: "load" | "resume";
      status: "requested" | "success" | "failure";
      error?: string;
      at: string;
    }
  | {
      type: "session-update";
      restoreId: string;
      agentSessionId: string;
      sessionId: string;
      update: unknown;
      at: string;
    }
  | {
      type: "terminal";
      restoreId: string;
      agentSessionId: string;
      stream: string;
      chunk: string;
      at: string;
    }
  | {
      type: "interaction-requested";
      restoreId: string;
      interaction: RunInteraction;
      at: string;
    }
  | {
      type: "error";
      error: string;
    };

export class SpecflowClient {
  constructor(readonly baseUrl: string) {}

  async health(): Promise<SpecflowHealth> {
    return this.request<SpecflowHealth>("/api/health");
  }

  async listAgentServers(): Promise<AgentServerEntry[]> {
    return this.request<AgentServerEntry[]>("/api/agent-servers");
  }

  async listCanvases(): Promise<CanvasSummary[]> {
    return this.request<CanvasSummary[]>("/api/canvases");
  }

  async getCanvas(id: string): Promise<CanvasDoc> {
    return this.request<CanvasDoc>(`/api/canvases/${encodeURIComponent(id)}`);
  }

  async saveCanvas(id: string, body: CanvasDoc): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/canvases/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async runCanvas(
    id: string,
    body: { initialInput?: string; variableValues?: Record<string, string>; pauseAfterFirstActivation?: boolean },
  ): Promise<RunRecordSummary> {
    const started = await this.request<RunRecordSummary | { runId: string }>(`/api/canvases/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.normalizeStartedRun(started, id);
  }

  async continueWorkflowRun(id: string): Promise<RunRecordSummary> {
    const started = await this.request<RunRecordSummary | { runId: string }>(`/api/runs/${encodeURIComponent(id)}/continue`, {
      method: "POST",
    });
    return this.normalizeStartedRun(started);
  }

  async listRuns(workflowId?: string): Promise<RunRecordDetail[]> {
    const params = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
    return this.request<RunRecordDetail[]>(`/api/runs${params}`);
  }

  async getRun(id: string): Promise<RunRecordDetail> {
    return this.request<RunRecordDetail>(`/api/runs/${encodeURIComponent(id)}`);
  }

  async pauseRun(id: string): Promise<unknown> {
    return this.request<unknown>(`/api/runs/${encodeURIComponent(id)}/pause`, { method: "POST" });
  }

  async playRun(id: string, body: { pauseAfterNextActivation?: boolean } = {}): Promise<unknown> {
    return this.request<unknown>(`/api/runs/${encodeURIComponent(id)}/play`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async interruptRun(id: string): Promise<unknown> {
    return this.request<unknown>(`/api/runs/${encodeURIComponent(id)}/interrupt`, { method: "POST" });
  }

  async getRunReachability(id: string): Promise<RunReachability> {
    return this.request<RunReachability>(`/api/runs/${encodeURIComponent(id)}/reachability`);
  }

  async patchRunGraph(
    id: string,
    body: { operations: RunGraphOperation[]; summary?: string },
  ): Promise<RunGraphPatchResponse> {
    return this.request<RunGraphPatchResponse>(`/api/runs/${encodeURIComponent(id)}/graph`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async getRunLogs(id: string, options: { tail?: number } = {}): Promise<RunLogEvent[] | RunLogEventPage> {
    const params = options.tail ? `?tail=${options.tail}` : "";
    return this.request<RunLogEvent[] | RunLogEventPage>(`/api/runs/${encodeURIComponent(id)}/logs${params}`);
  }

  async listPausedNodes(runId: string): Promise<PausedNodeSession[]> {
    return this.request<PausedNodeSession[]>(`/api/runs/${encodeURIComponent(runId)}/paused-nodes`);
  }

  async promptPausedNode(runId: string, nodeId: string, prompt: string): Promise<{ output: string }> {
    return this.request<{ output: string }>(
      `/api/runs/${encodeURIComponent(runId)}/paused-nodes/${encodeURIComponent(nodeId)}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      },
    );
  }

  async continuePausedNode(
    runId: string,
    nodeId: string,
    body: { play?: boolean; pauseAfterNextActivation?: boolean } = {},
  ): Promise<{ ok: boolean; paused: PausedNodeSession; played?: unknown }> {
    return this.request<{ ok: boolean; paused: PausedNodeSession; played?: unknown }>(
      `/api/runs/${encodeURIComponent(runId)}/paused-nodes/${encodeURIComponent(nodeId)}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  async getResumableSession(id: string): Promise<ResumableSessionSummary> {
    return this.request<ResumableSessionSummary>(`/api/runs/${encodeURIComponent(id)}/resumable-session`);
  }

  async listAgentSessions(filter: { workflowId?: string; agentServerId?: string } = {}): Promise<AgentSessionRecord[]> {
    const params = new URLSearchParams();
    if (filter.workflowId) params.set("workflowId", filter.workflowId);
    if (filter.agentServerId) params.set("agentServerId", filter.agentServerId);
    const query = params.toString();
    return this.request<AgentSessionRecord[]>(`/api/agent-sessions${query ? `?${query}` : ""}`);
  }

  async getAgentSession(id: string): Promise<AgentSessionRecord> {
    return this.request<AgentSessionRecord>(`/api/agent-sessions/${encodeURIComponent(id)}`);
  }

  async restoreAgentSession(id: string, mode: AgentRestoreMode): Promise<AgentSessionRestoreStarted> {
    return this.request<AgentSessionRestoreStarted>(`/api/agent-sessions/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  }

  async promptRestoredSession(restoreId: string, prompt: string): Promise<{ output: string }> {
    return this.request<{ output: string }>(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  }

  async closeRestoredSession(restoreId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/close`, {
      method: "POST",
    });
  }

  async cancelRestoredSession(restoreId: string): Promise<{ ok: boolean; status: string }> {
    return this.request<{ ok: boolean; status: string }>(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/cancel`, {
      method: "POST",
    });
  }

  async respondRunInteraction(
    runId: string,
    interactionId: string,
    resolution: unknown,
  ): Promise<{ ok: boolean; interaction: RunInteraction }> {
    return this.request<{ ok: boolean; interaction: RunInteraction }>(
      `/api/runs/${encodeURIComponent(runId)}/interactions/${encodeURIComponent(interactionId)}/respond`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(resolution),
      },
    );
  }

  async streamRestoreEvents(
    restoreId: string,
    onEvent: (event: RestoreStreamEvent) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const response = await fetch(new URL(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/events`, this.baseUrl), {
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = drainSseBuffer(buffer, onEvent);
      }
      buffer += decoder.decode();
      drainSseBuffer(buffer, onEvent);
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) return;
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async normalizeStartedRun(started: RunRecordSummary | { runId: string }, workflowId?: string): Promise<RunRecordSummary> {
    const id = typeof started.runId === "string"
      ? started.runId
      : "id" in started
        ? started.id
        : undefined;
    if (!id) throw new Error("Specflow server did not return a run id.");
    try {
      const record = await this.getRun(id);
      return {
        id,
        runId: id,
        workflowId: record.workflowId,
        status: record.status,
        resumedFromRunId: record.resumedFromRunId,
        resumedByRunId: record.resumedByRunId,
        errorMsg: record.errorMsg,
      };
    } catch {
      return {
        id,
        runId: id,
        workflowId: "workflowId" in started ? started.workflowId : workflowId ?? "",
        status: "status" in started ? started.status : "running",
      };
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), init);
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    return response.json() as Promise<T>;
  }
}

function drainSseBuffer(buffer: string, onEvent: (event: RestoreStreamEvent) => void): string {
  for (;;) {
    const separator = buffer.indexOf("\n\n");
    if (separator < 0) return buffer;
    const rawEvent = buffer.slice(0, separator);
    buffer = buffer.slice(separator + 2);
    const parsed = parseSseEvent(rawEvent);
    if (parsed) onEvent(parsed);
  }
}

function parseSseEvent(rawEvent: string): RestoreStreamEvent | undefined {
  const lines = rawEvent.split(/\r?\n/);
  const eventName = lines
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return undefined;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (eventName === "error" && (!parsed || typeof parsed !== "object" || !("type" in parsed))) {
      const error = parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : data;
      return { type: "error", error };
    }
    return parsed as RestoreStreamEvent;
  } catch {
    return eventName === "error" ? { type: "error", error: data } : undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to the status text.
  }
  return `${response.status} ${response.statusText}`.trim();
}
