import {
  RESTORE_SSE_EVENTS,
  RUN_SSE_EVENTS,
  type RunSseEventType,
} from "@specflow/shared";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

export interface SpecflowHealth {
  app: string;
  ok: boolean;
  sessions: number;
  startedAt: string;
  workspaceRoot?: string;
  serverId?: string;
  apiVersion?: number;
}

export interface CanvasSummary {
  id: string;
  name: string;
  version?: number;
  local?: boolean;
  runs?: number;
  diagnostics?: unknown[];
}

export interface WorkflowSourceReadResponse {
  workflowId: string;
  yaml: string;
  path: string;
  local: boolean;
  source: "local-file" | "shared-file" | "path-file";
}

export interface WorkflowSourceWriteResponse {
  ok: boolean;
  workflowId: string;
  path: string;
  local: boolean;
  diagnostics?: unknown[];
  derived?: unknown;
}

export interface WorkflowSourceForkResponse {
  ok: boolean;
  sourceWorkflowId: string;
  workflowId: string;
  path: string;
  local: boolean;
  yaml: string;
}

export interface WorkflowAssetImportResponse {
  paths: string[];
  images?: Array<{ path: string; label: string; mimeType?: string }>;
}

export type AgentServerSettings =
  | {
      type: "registry";
      registryId: string;
      installedVersion?: string;
      cwd?: string;
      env?: Record<string, string>;
      additionalDirectories?: string[];
    }
  | {
      type: "custom";
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      additionalDirectories?: string[];
    }
  | {
      type: "headless";
      command: string;
      argsTemplate?: string[];
      cwd?: string;
      env?: Record<string, string>;
      additionalDirectories?: string[];
    };

export interface AgentServerEntry {
  id: string;
  settings: AgentServerSettings;
  source?: string;
  registry?: {
    registryId: string;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
  };
  [key: string]: unknown;
}

export interface AgentRegistryIndex {
  version?: string;
  agents?: Array<Record<string, unknown> & { id?: string; name?: string; version?: string }>;
  [key: string]: unknown;
}

export interface WorkflowValidateResponse {
  ok: boolean;
  workflowId?: string;
  name?: string;
  version?: number;
  sessions?: number;
  nodes?: number;
  edges?: number;
  diagnostics?: unknown[];
  derived?: unknown;
  error?: string;
}

export interface RunInputVariable {
  name: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  value: string;
  source: "override" | "default" | "missing";
}

export interface WorkflowPrepareRunResponse {
  ready: boolean;
  workflowId?: string;
  variables?: RunInputVariable[];
  effectiveValues?: Record<string, string>;
  missingVariables?: RunInputVariable[];
  authStatuses?: unknown[];
  validationError?: string;
  diagnostics?: unknown[];
  error?: string;
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

export interface RunRecordDetail extends RunRecordSummary {
  label?: string;
  activeNode?: string;
  pausedNodeId?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  nodeStates?: Record<string, string>;
  nodeOutputs?: Record<string, string>;
  control?: Record<string, unknown>;
  checkpoint?: {
    pendingCompletion?: { nodeId?: string; output?: string };
    suspension?: { nodeId?: string; source?: string };
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
  agentInvocations?: Array<Record<string, unknown>>;
  agentSessions?: unknown[];
}

export interface AgentFlowDoc {
  id: string;
  version?: 1 | 2;
  name: string;
  sessions: Array<{ id: string; name?: string; agentServerId?: string; agent?: string; [key: string]: unknown }>;
  nodes: Array<Record<string, unknown> & { id: string; kind: string; title?: string }>;
  edges: Array<Record<string, unknown> & { id?: string; from: string; to: string }>;
  variables?: RunInputVariable[];
  [key: string]: unknown;
}

export interface CanvasLayoutDoc {
  workflowId: string;
  version?: number;
  nodes: Array<Record<string, unknown>>;
}

export interface CanvasDoc extends AgentFlowDoc {
  nodes: Array<Record<string, unknown> & { id: string; kind: string; title?: string; x?: number; y?: number; w?: number }>;
  diagnostics?: unknown[];
  derived?: unknown;
}

export type RuntimeEditClass = "current" | "future" | "history_future" | "history_only" | "inactive";

export interface RunReachability {
  nodes: Record<string, RuntimeEditClass>;
  edges?: Record<string, string>;
  [key: string]: unknown;
}

export type RunGraphOperation = Record<string, unknown> & { op: string };

export interface RunGraphPatchResponse {
  ok: boolean;
  snapshotRevision?: number;
  snapshot?: CanvasDoc;
  reachability?: RunReachability;
  appliedOperations?: Array<Record<string, unknown>>;
  rejectedOperations?: Array<Record<string, unknown>>;
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

export interface RunLogEvent {
  type: string;
  runId: string;
  nodeId?: string;
  nodeRunId?: string;
  agentInvocationId?: string;
  agentServerId?: string;
  specflowSessionId?: string;
  at?: string;
  chunk?: string;
  prompt?: string;
  update?: unknown;
  [key: string]: unknown;
}

export interface RunLogEventPage {
  events: RunLogEvent[];
  total: number;
  startIndex: number;
}

export interface RunInteraction {
  id: string;
  kind: "permission" | "elicitation";
  status: "pending" | "resolved" | "cancelled";
  runId: string;
  nodeId?: string;
  agentInvocationId: string;
  agentServerId: string;
  createdAt: string;
  resolution?: unknown;
  toolCall?: unknown;
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
  request?: unknown;
  [key: string]: unknown;
}

export interface AgentSessionRecord {
  id: string;
  workflowId: string;
  agentServerId: string;
  latestRunId: string;
  latestStatus: string;
  invocationIds: string[];
  invocations: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export type AgentRestoreMode = "inspect" | "continue";

export interface AgentSessionRestoreStarted {
  restoreId: string;
  agentSessionId: string;
  runId: string;
  status: "running";
  requestedMode: AgentRestoreMode;
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

export interface NativeResumeCommandSummary {
  agentSessionId: string;
  workflowId: string;
  latestRunId: string;
  latestInvocationId: string;
  latestStatus: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId: string;
  nodeId?: string;
  nodeTitle?: string;
  nativeResume: {
    available: boolean;
    status: string;
    command?: string;
    args?: string[];
    displayCommand?: string;
    commandExists?: boolean;
    agentDisplayName?: string;
    caveat?: string;
    reason?: string;
  };
}

export interface NativeResumeCommandsResponse {
  runId: string;
  workflowId: string;
  commands: NativeResumeCommandSummary[];
}

export type RestoreStreamEvent =
  | { type: typeof RESTORE_SSE_EVENTS.restoreStatus; [key: string]: unknown }
  | { type: typeof RESTORE_SSE_EVENTS.sessionUpdate; [key: string]: unknown }
  | { type: typeof RESTORE_SSE_EVENTS.terminal; [key: string]: unknown }
  | { type: typeof RESTORE_SSE_EVENTS.interactionRequested; interaction: RunInteraction; [key: string]: unknown }
  | { type: "error"; error: string };

export type RunStreamEvent =
  | { type: typeof RUN_SSE_EVENTS.hello; runId: string }
  | ({ type: typeof RUN_SSE_EVENTS.interactionRequested; interaction: RunInteraction })
  | ({ type: Exclude<RunSseEventType, typeof RUN_SSE_EVENTS.hello | typeof RUN_SSE_EVENTS.interactionRequested> } & Record<string, unknown>)
  | { type: "error"; error: string };

export class SpecflowClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async health(): Promise<SpecflowHealth> {
    return this.request<SpecflowHealth>("/api/health");
  }

  async readWorkflowSource(target: string): Promise<WorkflowSourceReadResponse> {
    return this.postJson("/api/workflows/source/read", { target });
  }

  async writeWorkflowSource(body: { workflowId: string; yaml: string; local?: boolean }): Promise<WorkflowSourceWriteResponse> {
    return this.postJson("/api/workflows/source/write", body);
  }

  async forkWorkflowSource(body: { source: string; newWorkflowId?: string; newName?: string; local?: boolean }): Promise<WorkflowSourceForkResponse> {
    return this.postJson("/api/workflows/source/fork", body);
  }

  async validateWorkflow(target: string): Promise<WorkflowValidateResponse> {
    return this.postJson("/api/workflows/validate", { target });
  }

  async prepareWorkflowRun(body: { workflowId: string; initialInput?: string; variableValues?: Record<string, string> }): Promise<WorkflowPrepareRunResponse> {
    return this.postJson("/api/workflows/prepare-run", body);
  }

  async listWorkflows(): Promise<CanvasSummary[]> {
    return this.request<CanvasSummary[]>("/api/canvases");
  }

  async getWorkflow(id: string): Promise<CanvasDoc> {
    return this.request<CanvasDoc>(`/api/canvases/${encodeURIComponent(id)}`);
  }

  async startRun(
    id: string,
    body: { initialInput?: string; variableValues?: Record<string, string>; pauseAfterFirstActivation?: boolean },
  ): Promise<RunRecordSummary> {
    const started = await this.postJson<RunRecordSummary | { runId: string }>(`/api/canvases/${encodeURIComponent(id)}/run`, body);
    return this.normalizeStartedRun(started, id);
  }

  async continueWorkflowRun(id: string): Promise<RunRecordSummary> {
    const started = await this.request<RunRecordSummary | { runId: string }>(`/api/runs/${encodeURIComponent(id)}/continue`, { method: "POST" });
    return this.normalizeStartedRun(started);
  }

  async rerunRun(id: string, body: { initialInput?: string; variableValues?: Record<string, string> } = {}): Promise<RunRecordSummary> {
    const started = await this.postJson<RunRecordSummary | { runId: string }>(`/api/runs/${encodeURIComponent(id)}/rerun`, body);
    return this.normalizeStartedRun(started);
  }

  async listRuns(workflowId?: string): Promise<RunRecordDetail[]> {
    const params = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : "";
    return this.request<RunRecordDetail[]>(`/api/runs${params}`);
  }

  async getRun(id: string): Promise<RunRecordDetail> {
    return this.request<RunRecordDetail>(`/api/runs/${encodeURIComponent(id)}`);
  }

  async deleteRun(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async pauseRun(id: string): Promise<unknown> {
    return this.request<unknown>(`/api/runs/${encodeURIComponent(id)}/pause`, { method: "POST" });
  }

  async playRun(id: string, body: { pauseAfterNextActivation?: boolean } = {}): Promise<unknown> {
    return this.postJson(`/api/runs/${encodeURIComponent(id)}/play`, body);
  }

  async interruptRun(id: string): Promise<unknown> {
    return this.request<unknown>(`/api/runs/${encodeURIComponent(id)}/interrupt`, { method: "POST" });
  }

  async stopRun(id: string): Promise<unknown> {
    return this.request<unknown>(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
  }

  async getRunReachability(id: string): Promise<RunReachability> {
    return this.request<RunReachability>(`/api/runs/${encodeURIComponent(id)}/reachability`);
  }

  async patchRunGraph(id: string, body: { operations: RunGraphOperation[]; summary?: string }): Promise<RunGraphPatchResponse> {
    return this.request<RunGraphPatchResponse>(`/api/runs/${encodeURIComponent(id)}/graph`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async saveRunBestPractice(id: string, body: { name?: string; shared?: boolean } = {}): Promise<unknown> {
    return this.postJson(`/api/runs/${encodeURIComponent(id)}/best-practice`, body);
  }

  async importWorkflowAssets(
    workflowId: string,
    body: {
      kind: "image" | "path";
      files: Array<{ path: string; relativePath?: string; mimeType?: string }>;
      directory?: boolean;
    },
  ): Promise<WorkflowAssetImportResponse> {
    const form = new FormData();
    for (const file of body.files) {
      const data = await readFile(file.path);
      const relativePath = file.relativePath ?? basename(file.path);
      form.append("files", new Blob([data], { type: file.mimeType ?? mimeTypeForPath(file.path, body.kind) }), relativePath);
      form.append("relativePaths", relativePath);
    }
    const params = new URLSearchParams({ kind: body.kind });
    if (body.directory) params.set("directory", "true");
    return this.request<WorkflowAssetImportResponse>(`/api/canvases/${encodeURIComponent(workflowId)}/assets?${params}`, {
      method: "POST",
      body: form,
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
    return this.postJson(`/api/runs/${encodeURIComponent(runId)}/paused-nodes/${encodeURIComponent(nodeId)}/prompt`, { prompt });
  }

  async continuePausedNode(runId: string, nodeId: string, body: { play?: boolean; pauseAfterNextActivation?: boolean } = {}): Promise<unknown> {
    return this.postJson(`/api/runs/${encodeURIComponent(runId)}/paused-nodes/${encodeURIComponent(nodeId)}/continue`, body);
  }

  async listPendingInteractions(runId: string): Promise<RunInteraction[]> {
    return this.request<RunInteraction[]>(`/api/runs/${encodeURIComponent(runId)}/interactions?status=pending`);
  }

  async respondRunInteraction(runId: string, interactionId: string, resolution: unknown): Promise<{ ok: boolean; interaction: RunInteraction }> {
    return this.postJson(`/api/runs/${encodeURIComponent(runId)}/interactions/${encodeURIComponent(interactionId)}/respond`, resolution);
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
    return this.postJson(`/api/agent-sessions/${encodeURIComponent(id)}/restore`, { mode });
  }

  async promptRestoredSession(restoreId: string, prompt: string): Promise<{ output: string }> {
    return this.postJson(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/prompt`, { prompt });
  }

  async cancelRestoredSession(restoreId: string): Promise<unknown> {
    return this.request(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/cancel`, { method: "POST" });
  }

  async closeRestoredSession(restoreId: string): Promise<unknown> {
    return this.request(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/close`, { method: "POST" });
  }

  async listAgentServers(): Promise<AgentServerEntry[]> {
    return this.request<AgentServerEntry[]>("/api/agent-servers");
  }

  async listAgentRegistry(): Promise<AgentRegistryIndex> {
    return this.request<AgentRegistryIndex>("/api/agent-servers/registry");
  }

  async installRegistryAgent(registryId: string, body: { agentServerId?: string } = {}): Promise<AgentServerEntry[]> {
    return this.postJson<AgentServerEntry[]>(`/api/agent-servers/registry/${encodeURIComponent(registryId)}/install`, body);
  }

  async updateRegistryAgent(agentServerId: string): Promise<AgentServerEntry[]> {
    return this.request<AgentServerEntry[]>(`/api/agent-servers/${encodeURIComponent(agentServerId)}/update`, { method: "POST" });
  }

  async removeAgentServer(agentServerId: string): Promise<AgentServerEntry[]> {
    return this.request<AgentServerEntry[]>(`/api/agent-servers/${encodeURIComponent(agentServerId)}`, { method: "DELETE" });
  }

  async getAgentAuth(agentServerId: string): Promise<unknown> {
    return this.request(`/api/agent-servers/${encodeURIComponent(agentServerId)}/auth`);
  }

  async startAgentAuth(agentServerId: string, methodId: string): Promise<unknown> {
    return this.request(`/api/agent-servers/${encodeURIComponent(agentServerId)}/auth/${encodeURIComponent(methodId)}`, { method: "POST" });
  }

  async getAuthTerminal(sessionId: string): Promise<unknown> {
    return this.request(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}`);
  }

  async authTerminalInput(sessionId: string, data: string): Promise<unknown> {
    return this.postJson(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/input`, { data });
  }

  async authTerminalResize(sessionId: string, cols: number, rows: number): Promise<unknown> {
    return this.postJson(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/resize`, { cols, rows });
  }

  async authTerminalCancel(sessionId: string): Promise<unknown> {
    return this.request(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" });
  }

  async authTerminalCheck(sessionId: string): Promise<unknown> {
    return this.request(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/check`, { method: "POST" });
  }

  async getAgentCapabilities(agentServerId: string): Promise<unknown> {
    return this.request(`/api/agent-servers/${encodeURIComponent(agentServerId)}/capabilities`);
  }

  async refreshAgentCapabilities(agentServerId: string): Promise<unknown> {
    return this.request(`/api/agent-servers/${encodeURIComponent(agentServerId)}/capabilities/refresh`, { method: "POST" });
  }

  async getRunNativeResumeCommands(runId: string): Promise<NativeResumeCommandsResponse> {
    return this.request<NativeResumeCommandsResponse>(`/api/runs/${encodeURIComponent(runId)}/native-resume-commands`);
  }

  async getAgentSessionNativeResumeCommand(agentSessionId: string): Promise<NativeResumeCommandSummary> {
    return this.request<NativeResumeCommandSummary>(`/api/agent-sessions/${encodeURIComponent(agentSessionId)}/native-resume-command`);
  }

  async streamRunEvents(runId: string, onEvent: (event: RunStreamEvent) => void, options: { signal?: AbortSignal; replay?: boolean } = {}): Promise<void> {
    const url = new URL(`/api/runs/${encodeURIComponent(runId)}/events`, this.baseUrl);
    if (options.replay === false) url.searchParams.set("replay", "false");
    await streamSseEvents(url, onEvent, options);
  }

  async streamRestoreEvents(restoreId: string, onEvent: (event: RestoreStreamEvent) => void, options: { signal?: AbortSignal } = {}): Promise<void> {
    await streamSseEvents(new URL(`/api/agent-session-restores/${encodeURIComponent(restoreId)}/events`, this.baseUrl), onEvent, options);
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), init);
    if (!response.ok) throw new Error(await responseError(response));
    return response.json() as Promise<T>;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
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
}

export function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export async function streamSseEvents<T>(
  url: URL,
  onEvent: (event: T) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return;
    throw error;
  }
  if (!response.ok) throw new Error(await responseError(response));
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

function drainSseBuffer<T>(buffer: string, onEvent: (event: T) => void): string {
  for (;;) {
    const separator = buffer.indexOf("\n\n");
    if (separator < 0) return buffer;
    const rawEvent = buffer.slice(0, separator);
    buffer = buffer.slice(separator + 2);
    const parsed = parseSseEvent<T>(rawEvent);
    if (parsed !== undefined) onEvent(parsed);
  }
}

function parseSseEvent<T>(rawEvent: string): T | undefined {
  const lines = rawEvent.split(/\r?\n/);
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
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
      return { type: "error", error } as T;
    }
    return parsed as T;
  } catch {
    return eventName === "error" ? { type: "error", error: data } as T : undefined;
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

function mimeTypeForPath(path: string, kind: "image" | "path"): string {
  if (kind !== "image") return "application/octet-stream";
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}
