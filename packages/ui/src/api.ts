import type { Session, WorkflowNode, Edge, Workflow, Run, RunState, Variable, LogLine, TimelineEvent, RunReachability } from './types';
import { isAcpTimelineEvent, type AcpTimelineEvent } from '@specflow/shared';

export interface CanvasDoc {
  id: string;
  version?: 1 | 2;
  name: string;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  variables?: Variable[];
  derived?: {
    loopClosingEdgeIds?: string[];
  };
}

export type AgentFlowNode = Omit<WorkflowNode, 'x' | 'y' | 'w'>;

export interface AgentFlowDoc {
  id: string;
  version?: 1 | 2;
  name: string;
  sessions: Session[];
  nodes: AgentFlowNode[];
  edges: Edge[];
  variables?: Variable[];
  derived?: {
    loopClosingEdgeIds?: string[];
  };
}

export interface CanvasLayoutDoc {
  workflowId: string;
  version: 1;
  nodes: Array<{ nodeId: string; x: number; y: number; w: number }>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface ApiRunRecord {
  id: string;
  workflowId: string;
  label: string;
  ticket?: string;
  status: "running" | "paused" | "interrupted" | "success" | "error" | "stopped" | "cancelled";
  activeNode?: string;
  pausedNodeId?: string;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  agent: string;
  errorMsg?: string;
  nodeStates: Record<string, RunState>;
  nodeOutputs?: Record<string, string>;
  agentSessions?: AgentSessionRecord[];
  agentflowSnapshot?: AgentFlowDoc;
  canvasSnapshot?: CanvasLayoutDoc | CanvasDoc;
  initialInput?: string;
  variableValues?: Record<string, string>;
  resumedFromRunId?: string;
  resumedByRunId?: string;
  snapshotRevision?: number;
  snapshotEditedAt?: string;
  snapshotEditSummary?: string;
}

export interface AgentSessionInvocationRef {
  runId: string;
  invocationId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  purpose?: 'node' | 'gate' | 'handoff';
  sourceNodeId?: string;
  targetNodeId?: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
}

export interface AgentSessionRestoreAttempt {
  id: string;
  requestedMode: 'inspect' | 'continue';
  selectedPrimitive?: 'load' | 'resume';
  status: 'requested' | 'success' | 'failure';
  startedAt: string;
  completedAt?: string;
  error?: string;
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
  latestStatus: 'running' | 'done' | 'failed' | 'cancelled';
  runIds: string[];
  invocationIds: string[];
  invocations: AgentSessionInvocationRef[];
  restoreAttempts?: AgentSessionRestoreAttempt[];
}

export type AgentServerSettings =
  | {
      type: 'registry';
      registryId: string;
      installedVersion?: string;
      cwd?: string;
      env?: Record<string, string>;
      additionalDirectories?: string[];
    }
  | {
      type: 'custom';
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      additionalDirectories?: string[];
    }
  | {
      type: 'headless';
      command: string;
      argsTemplate: string[];
      cwd?: string;
      env?: Record<string, string>;
      additionalDirectories?: string[];
    };

export interface AgentServerEntry {
  id: string;
  settings: AgentServerSettings;
  registry?: {
    registryId: string;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable: boolean;
  };
}

export interface AgentAuthenticationEnvVar {
  name: string;
  label?: string;
  secret: boolean;
  optional: boolean;
}

export type AgentAuthenticationMethod =
  | { type: 'agent'; id: string; name: string; description?: string }
  | {
      type: 'env_var';
      id: string;
      name: string;
      description?: string;
      link?: string;
      vars: AgentAuthenticationEnvVar[];
      missingVars: string[];
    }
  | {
      type: 'terminal';
      id: string;
      name: string;
      description?: string;
    };

export interface AgentAuthenticationStatus {
  agentServerId: string;
  needsAuth: boolean;
  methods: AgentAuthenticationMethod[];
}

export type AgentAuthenticationResponse =
  | AgentAuthenticationStatus
  | { status: 'terminal_started'; terminalSessionId: string };

export type AuthTerminalStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AuthTerminalEvent =
  | { type: 'output'; sessionId: string; data: string; at: string }
  | {
      type: 'status';
      sessionId: string;
      status: AuthTerminalStatus;
      exitCode?: number;
      signal?: string | null;
      error?: string;
      authStatus?: AgentAuthenticationStatus;
      at: string;
    };

export type TerminalSessionStatus = AuthTerminalStatus;

export type TerminalSessionEvent =
  | { type: 'output'; sessionId: string; data: string; at: string }
  | {
      type: 'status';
      sessionId: string;
      status: TerminalSessionStatus;
      exitCode?: number;
      signal?: string | null;
      error?: string;
      at: string;
    };

export class AgentAuthenticationRequiredError extends Error {
  readonly statuses: AgentAuthenticationStatus[];

  constructor(statuses: AgentAuthenticationStatus[]) {
    super('Agent authentication required');
    this.name = 'AgentAuthenticationRequiredError';
    this.statuses = statuses;
  }
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description?: string;
  repository?: string;
  website?: string;
  icon?: string;
  distribution: {
    binary?: Record<string, unknown>;
    npx?: unknown;
    uvx?: unknown;
  };
}

export interface RegistryIndex {
  version: string;
  agents: RegistryAgent[];
}

export type RestoreMode = 'inspect' | 'continue';

export interface RestoreStartResponse {
  restoreId: string;
  agentSessionId: string;
  runId: string;
  status: 'running';
  requestedMode: RestoreMode;
}

export type RestoreSseEventType = 'restore-status' | 'session-update' | 'terminal' | 'interaction-requested';

export type RestoreStreamEvent =
  | {
      type: 'restore-status';
      restoreId: string;
      agentSessionId: string;
      runId: string;
      requestedMode: RestoreMode;
      selectedPrimitive?: 'load' | 'resume';
      capabilities?: Pick<AgentServerCapabilities, 'modes' | 'configOptions'>;
      status: 'requested' | 'success' | 'failure';
      error?: string;
      at: string;
    }
  | {
      type: 'session-update';
      restoreId: string;
      agentSessionId: string;
      sessionId: string;
      update: unknown;
      at: string;
    }
  | {
      type: 'terminal';
      restoreId: string;
      agentSessionId: string;
      stream: LogLine['stream'];
      chunk: string;
      at: string;
    }
  | {
      type: 'interaction-requested';
      restoreId: string;
      interaction: RunInteraction;
      at: string;
    };

export type RunInteractionStatus = 'pending' | 'resolved' | 'cancelled';

export interface PausedNodeSession {
  runId: string;
  nodeId: string;
  specflowSessionId: string;
  agentServerId: string;
  pausedAt: string;
}

export interface RunInteraction {
  id: string;
  runId: string;
  kind: 'permission' | 'elicitation';
  status: RunInteractionStatus;
  createdAt: string;
  resolvedAt?: string;
  nodeId?: string;
  nodeRunId?: string;
  edgeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId?: string;
  toolCall?: unknown;
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
  request?: unknown;
  resolution?: unknown;
}

export type ApiRunLogEvent =
  | (AcpTimelineEvent & { runId: string })
  | {
      type: 'terminal';
      runId: string;
      nodeId?: string;
      agentInvocationId?: string;
      specflowSessionId?: string;
      stream: LogLine['stream'];
      sequence: number;
      chunk: string;
      createdAt: string;
    }
  | {
      type: 'session_update';
      runId: string;
      nodeId?: string;
      agentInvocationId: string;
      sessionId: string;
      specflowSessionId?: string;
      update: unknown;
      at: string;
    }
  | {
      type: 'agent_prompt';
      runId: string;
      nodeRunId?: string;
      nodeId?: string;
      edgeId?: string;
      purpose?: 'node' | 'gate' | 'handoff';
      sourceNodeId?: string;
      targetNodeId?: string;
      agentInvocationId: string;
      agentId: string;
      agentServerId: string;
      specflowSessionId?: string;
      prompt: string;
      at: string;
    }
  | {
      type: 'node_status';
      runId: string;
      nodeId: string;
      gateDecision?: { branchId: string; reason?: string };
      gateBranches?: Array<{ branchId: string; label: string; traversalsUsed: number; maxTraversals: number; available: boolean }>;
      [key: string]: unknown;
    }
  | {
      type: 'agent_lifecycle';
      runId: string;
      nodeRunId?: string;
      nodeId?: string;
      edgeId?: string;
      purpose?: 'node' | 'gate' | 'handoff';
      sourceNodeId?: string;
      targetNodeId?: string;
      specflowSessionId?: string;
      parentSpecflowSessionId?: string;
      agentInvocationId: string;
      agentId: string;
      agentServerId: string;
      lifecycle: unknown;
    }
  | {
      type: 'run_status' | 'restore_attempt' | 'interaction';
      runId: string;
      [key: string]: unknown;
    };

export interface CanvasSummary {
  id: string;
  name: string;
  runs: number;
  version?: 1 | 2;
  deprecated?: boolean;
  local?: boolean;
}

export async function fetchCanvases(): Promise<CanvasSummary[]> {
  const response = await fetch('/api/canvases');
  if (!response.ok) throw new Error(`Failed to fetch canvases: ${response.status}`);
  return response.json();
}

export async function fetchCanvas(id: string): Promise<CanvasDoc> {
  const response = await fetch(`/api/canvases/${id}`);
  if (!response.ok) throw new Error(await apiError(response, `Failed to load canvas ${id}`));
  return response.json();
}

export async function saveCanvas(id: string, canvasDocument: CanvasDoc): Promise<void> {
  const response = await fetch(`/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(canvasDocument),
  });
  if (!response.ok) throw new Error(await apiError(response, `Failed to save canvas ${id}`));
}

export async function uploadCanvasAssets(
  id: string,
  kind: 'image' | 'path',
  files: File[],
  directory = false,
): Promise<{ paths: string[]; images?: Array<{ path: string; label?: string; mimeType?: string }> }> {
  const body = new FormData();
  for (const file of files) {
    body.append('files', file, file.name);
    body.append('relativePaths', (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
  }
  const response = await fetch(`/api/canvases/${id}/assets?kind=${kind}&directory=${directory}`, { method: 'POST', body });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to import assets'));
  return response.json();
}

export async function createCanvas(name: string): Promise<CanvasDoc> {
  const response = await fetch('/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`Failed to create canvas: ${response.status}`);
  return response.json();
}

export async function deleteCanvas(id: string): Promise<void> {
  const response = await fetch(`/api/canvases/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await apiError(response, `Failed to delete canvas ${id}`));
}

export async function runCanvas(
  id: string,
  options?: { initialInput?: string; variableValues?: Record<string, string> },
): Promise<{ runId: string }> {
  const response = await fetch(`/api/canvases/${id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initialInput: options?.initialInput, variableValues: options?.variableValues }),
  });
  if (!response.ok) await throwRunStartError(response, 'Failed to start run');
  return response.json();
}

export async function fetchRuns(workflowId: string): Promise<ApiRunRecord[]> {
  const response = await fetch(`/api/runs?workflowId=${encodeURIComponent(workflowId)}`);
  if (!response.ok) throw new Error(`Failed to fetch runs: ${response.status}`);
  return response.json();
}

export async function fetchRun(id: string): Promise<ApiRunRecord> {
  const response = await fetch(`/api/runs/${id}`);
  if (!response.ok) throw new Error(`Run ${id} not found`);
  return response.json();
}

export interface RunLogPage {
  events: ApiRunLogEvent[];
  total: number;
  startIndex: number;
}

export async function fetchRunLogsRange(
  id: string,
  options: { tail?: number; from?: number; to?: number },
): Promise<RunLogPage> {
  const params = new URLSearchParams();
  if (typeof options.tail === 'number') params.set('tail', String(options.tail));
  if (typeof options.from === 'number') params.set('from', String(options.from));
  if (typeof options.to === 'number') params.set('to', String(options.to));
  const response = await fetch(`/api/runs/${id}/logs?${params.toString()}`);
  if (!response.ok) throw new Error(`Run logs ${id} not found`);
  return response.json();
}

export async function fetchRunLogs(id: string): Promise<ApiRunLogEvent[]> {
  const response = await fetch(`/api/runs/${id}/logs?timeline=compact`);
  if (!response.ok) throw new Error(`Run logs ${id} not found`);
  return response.json();
}

export async function fetchAgentSessions(filter: { workflowId?: string; agentServerId?: string } = {}): Promise<AgentSessionRecord[]> {
  const params = new URLSearchParams();
  if (filter.workflowId) params.set('workflowId', filter.workflowId);
  if (filter.agentServerId) params.set('agentServerId', filter.agentServerId);
  const queryString = params.toString();
  const response = await fetch(`/api/agent-sessions${queryString ? `?${queryString}` : ''}`);
  if (!response.ok) throw new Error(`Failed to fetch agent sessions: ${response.status}`);
  return response.json();
}

export async function fetchAgentServers(): Promise<AgentServerEntry[]> {
  const response = await fetch('/api/agent-servers');
  if (!response.ok) throw new Error(`Failed to fetch agent servers: ${response.status}`);
  return response.json();
}

export async function fetchAgentRegistry(): Promise<RegistryIndex> {
  const response = await fetch('/api/agent-servers/registry');
  if (!response.ok) throw new Error(`Failed to fetch ACP registry: ${response.status}`);
  return response.json();
}

export async function saveAgentServer(id: string, settings: AgentServerSettings): Promise<AgentServerEntry[]> {
  const response = await fetch(`/api/agent-servers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(`Failed to save agent server: ${response.status}`);
  return response.json();
}

export async function removeAgentServer(id: string): Promise<AgentServerEntry[]> {
  const response = await fetch(`/api/agent-servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Failed to remove agent server: ${response.status}`);
  return response.json();
}

export async function fetchAgentServerAuth(id: string): Promise<AgentAuthenticationStatus> {
  const response = await fetch(`/api/agent-servers/${encodeURIComponent(id)}/auth`);
  if (!response.ok) throw new Error(await apiError(response, `Failed to inspect auth for ${id}`));
  return response.json();
}

export interface AgentServerCapabilities {
  probedAt: string;
  installedVersion?: string;
  agentCapabilities: Record<string, unknown>;
  modes: { availableModes: Array<{ id: string; name: string; description?: string }>; currentModeId?: string } | null;
  configOptions: Array<{
    id: string;
    name: string;
    description?: string;
    category?: 'mode' | 'model' | 'thought_level' | 'other' | string;
    type: 'select' | 'boolean';
    currentValue?: string | boolean;
    options?: Array<{ value: string; name: string; description?: string }> | Array<{ group: string; name: string; options: Array<{ value: string; name: string; description?: string }> }>;
  }> | null;
  availableCommands: Array<{ name: string; description: string; inputHint?: string }>;
}

export interface SkillSummary {
  name: string;
  description: string;
  source: 'global' | 'projectLocal';
  filePath: string;
  bodyPreview: string;
}

export async function fetchAgentServerCapabilities(id: string): Promise<AgentServerCapabilities | undefined> {
  const response = await fetch(`/api/agent-servers/${encodeURIComponent(id)}/capabilities`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await apiError(response, `Failed to fetch capabilities for ${id}`));
  return response.json();
}

export async function refreshAgentServerCapabilities(id: string): Promise<AgentServerCapabilities> {
  const response = await fetch(`/api/agent-servers/${encodeURIComponent(id)}/capabilities/refresh`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, `Failed to refresh capabilities for ${id}`));
  return response.json();
}

export async function fetchSkills(): Promise<SkillSummary[]> {
  const response = await fetch('/api/skills');
  if (!response.ok) throw new Error(await apiError(response, 'Failed to fetch skills'));
  return response.json();
}

export async function authenticateAgentServer(
  id: string,
  methodId: string,
): Promise<AgentAuthenticationResponse> {
  const response = await fetch(`/api/agent-servers/${encodeURIComponent(id)}/auth/${encodeURIComponent(methodId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(await apiError(response, `Failed to authenticate ${id}`));
  return response.json();
}

export function subscribeToAuthTerminal(
  sessionId: string,
  onEvent: (event: AuthTerminalEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/events`);
  const handle = (messageEvent: MessageEvent) => {
    try {
      const event = JSON.parse(messageEvent.data) as AuthTerminalEvent;
      onEvent(event);
      if (event.type === 'status' && event.status !== 'running') source.close();
    } catch { /* ignore bad json */ }
  };
  source.addEventListener('output', handle);
  source.addEventListener('status', handle);
  if (onError) source.addEventListener('error', onError);
  return () => source.close();
}

export async function sendAuthTerminalInput(sessionId: string, data: string): Promise<void> {
  const response = await fetch(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to send terminal input'));
}

export async function resizeAuthTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  const response = await fetch(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/resize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to resize terminal'));
}

export async function cancelAuthTerminal(sessionId: string): Promise<void> {
  const response = await fetch(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to cancel terminal auth'));
}

export async function checkAuthTerminal(sessionId: string): Promise<AgentAuthenticationStatus> {
  const response = await fetch(`/api/agent-auth-terminals/${encodeURIComponent(sessionId)}/check`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to check terminal auth'));
  const body = await response.json() as { authStatus: AgentAuthenticationStatus };
  return body.authStatus;
}

export async function startAflowMigration(workflowId: string): Promise<{ terminalSessionId: string; label?: string }> {
  const response = await fetch('/api/aflow/migrations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to start Aflow migration'));
  return response.json();
}

export function subscribeToAflowMigrationTerminal(
  sessionId: string,
  onEvent: (event: TerminalSessionEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`/api/aflow/migrations/${encodeURIComponent(sessionId)}/events`);
  const handle = (messageEvent: MessageEvent) => {
    try {
      const event = JSON.parse(messageEvent.data) as TerminalSessionEvent;
      onEvent(event);
      if (event.type === 'status' && event.status !== 'running') source.close();
    } catch { /* ignore bad json */ }
  };
  source.addEventListener('output', handle);
  source.addEventListener('status', handle);
  if (onError) source.addEventListener('error', onError);
  return () => source.close();
}

export async function sendAflowMigrationTerminalInput(sessionId: string, data: string): Promise<void> {
  const response = await fetch(`/api/aflow/migrations/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to send terminal input'));
}

export async function resizeAflowMigrationTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  const response = await fetch(`/api/aflow/migrations/${encodeURIComponent(sessionId)}/resize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to resize terminal'));
}

export async function cancelAflowMigrationTerminal(sessionId: string): Promise<void> {
  const response = await fetch(`/api/aflow/migrations/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to cancel terminal'));
}

export async function fetchAgentSession(id: string): Promise<AgentSessionRecord> {
  const response = await fetch(`/api/agent-sessions/${id}`);
  if (!response.ok) throw new Error(`Agent session ${id} not found`);
  return response.json();
}

export async function restoreAgentSession(id: string, mode: RestoreMode): Promise<RestoreStartResponse> {
  const response = await fetch(`/api/agent-sessions/${id}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`Failed to restore agent session: ${response.status}`);
  return response.json();
}

export async function promptRestoredSession(
  restoreId: string,
  prompt: string,
  options: { modeId?: string; configOptions?: Record<string, string | boolean> } = {},
  signal?: AbortSignal,
): Promise<{ output: string }> {
  const response = await fetch(`/api/agent-session-restores/${restoreId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      ...(options.modeId ? { modeId: options.modeId } : {}),
      ...(options.configOptions && Object.keys(options.configOptions).length > 0 ? { configOptions: options.configOptions } : {}),
    }),
    signal,
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to prompt restored session'));
  return response.json();
}

export async function closeRestoredSession(restoreId: string): Promise<void> {
  const response = await fetch(`/api/agent-session-restores/${restoreId}/close`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to close restored session'));
}

export async function cancelRestoredSession(restoreId: string): Promise<void> {
  const response = await fetch(`/api/agent-session-restores/${restoreId}/cancel`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to cancel restored session'));
}

export async function fetchPausedNodes(runId: string): Promise<PausedNodeSession[]> {
  const response = await fetch(`/api/runs/${runId}/paused-nodes`);
  if (!response.ok) throw new Error(await apiError(response, 'Failed to fetch paused nodes'));
  return response.json();
}

export interface ResumableSessionSuggestion {
  agentSessionId: string;
  acpSessionId: string;
  agentServerId: string;
  nodeId?: string;
  continuationPrompt: string;
  canLoad: boolean;
  canResume: boolean;
}

export async function fetchResumableSession(runId: string): Promise<ResumableSessionSuggestion | undefined> {
  const response = await fetch(`/api/runs/${runId}/resumable-session`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await apiError(response, 'Failed to look up resumable session'));
  return response.json();
}

/**
 * Start a new run that picks up the workflow where {runId} left off: completed
 * nodes are skipped using their recorded output, interrupted nodes get a
 * continuation prompt against their existing ACP session.
 */
export async function continueWorkflowRun(runId: string): Promise<{ runId: string }> {
  const response = await fetch(`/api/runs/${runId}/continue`, { method: 'POST' });
  if (!response.ok) await throwRunStartError(response, 'Failed to continue workflow');
  return response.json();
}

export const resumeWorkflowRun = continueWorkflowRun;

export async function pauseRun(id: string): Promise<void> {
  const response = await fetch(`/api/runs/${id}/pause`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to pause run'));
}

export async function interruptRun(id: string): Promise<void> {
  const response = await fetch(`/api/runs/${id}/interrupt`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to interrupt run'));
}

export async function playRun(id: string): Promise<void> {
  const response = await fetch(`/api/runs/${id}/play`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to play run'));
}

export async function promptPausedNode(runId: string, nodeId: string, prompt: string, signal?: AbortSignal): Promise<{ output: string }> {
  const response = await fetch(`/api/runs/${runId}/paused-nodes/${nodeId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to prompt paused node'));
  return response.json();
}

export async function continuePausedNode(runId: string, nodeId: string): Promise<void> {
  const response = await fetch(`/api/runs/${runId}/paused-nodes/${nodeId}/continue`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to continue paused node'));
}

export async function deleteRun(id: string): Promise<void> {
  await fetch(`/api/runs/${id}`, { method: 'DELETE' });
}

export async function stopRun(id: string): Promise<void> {
  const response = await fetch(`/api/runs/${id}/stop`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to stop run'));
}

export const cancelRun = stopRun;

export async function patchRunSnapshot(
  runId: string,
  snapshot: CanvasDoc,
  summary?: string,
): Promise<{ ok: boolean; snapshotRevision: number; snapshot: CanvasDoc; reachability: RunReachability }> {
  const response = await fetch(`/api/runs/${runId}/snapshot`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshot, ...(summary ? { summary } : {}) }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to update run snapshot'));
  return response.json();
}

export async function fetchRunReachability(runId: string): Promise<RunReachability> {
  const response = await fetch(`/api/runs/${runId}/reachability`);
  if (!response.ok) throw new Error(await apiError(response, 'Failed to fetch run reachability'));
  return response.json();
}

export async function saveRunBestPractice(
  runId: string,
  options: { name?: string; shared?: boolean } = {},
): Promise<{ ok: boolean; workflow: CanvasSummary }> {
  const response = await fetch(`/api/runs/${runId}/best-practice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Failed to save best practice'));
  return response.json();
}

export async function rerunRun(
  id: string,
  options?: { initialInput?: string; variableValues?: Record<string, string> },
): Promise<{ runId: string }> {
  const response = await fetch(`/api/runs/${id}/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initialInput: options?.initialInput, variableValues: options?.variableValues }),
  });
  if (!response.ok) await throwRunStartError(response, 'Failed to re-run');
  return response.json();
}

export async function respondToRunInteraction(
  runId: string,
  interactionId: string,
  interactionResponse: unknown,
): Promise<void> {
  const response = await fetch(`/api/runs/${runId}/interactions/${interactionId}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(interactionResponse),
  });
  if (!response.ok) throw new Error(`Failed to respond to interaction: ${response.status}`);
}

export type SseEventType = 'hello' | 'node-status' | 'terminal' | 'session-update' | 'agent-prompt' | 'agent-lifecycle' | 'timeline' | 'run-status' | 'interaction-requested';

export function subscribeToRun(
  runId: string,
  onEvent: (type: SseEventType, data: unknown) => void,
  options: { replay?: boolean } = {},
): () => void {
  const query = options.replay === false ? "?replay=false" : "";
  const source = new EventSource(`/api/runs/${runId}/events${query}`);

  const handle = (type: SseEventType) => (messageEvent: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(messageEvent.data));
    } catch { /* ignore bad json */ }
  };

  source.addEventListener('hello',       handle('hello'));
  source.addEventListener('node-status', handle('node-status'));
  source.addEventListener('terminal',    handle('terminal'));
  source.addEventListener('session-update', handle('session-update'));
  source.addEventListener('agent-prompt', handle('agent-prompt'));
  source.addEventListener('agent-lifecycle', handle('agent-lifecycle'));
  source.addEventListener('timeline', handle('timeline'));
  source.addEventListener('run-status',  handle('run-status'));
  source.addEventListener('interaction-requested', handle('interaction-requested'));

  return () => source.close();
}

export function subscribeToRestore(
  restoreId: string,
  onEvent: (type: RestoreSseEventType, data: RestoreStreamEvent) => void,
): () => void {
  const source = new EventSource(`/api/agent-session-restores/${restoreId}/events`);

  const handle = (type: RestoreSseEventType) => (messageEvent: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(messageEvent.data) as RestoreStreamEvent);
    } catch { /* ignore bad json */ }
  };

  source.addEventListener('restore-status', handle('restore-status'));
  source.addEventListener('session-update', handle('session-update'));
  source.addEventListener('terminal', handle('terminal'));
  source.addEventListener('interaction-requested', handle('interaction-requested'));

  return () => source.close();
}

async function apiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `${fallback}: ${response.status}`;
  } catch {
    return `${fallback}: ${response.status}`;
  }
}

async function throwRunStartError(response: Response, fallback: string): Promise<never> {
  let body: { error?: string; authStatuses?: AgentAuthenticationStatus[] } = {};
  try {
    body = await response.json();
  } catch {
    // Fall through to the status-based error below.
  }
  if (body.authStatuses?.length) {
    throw new AgentAuthenticationRequiredError(body.authStatuses);
  }
  throw new Error(body.error || `${fallback}: ${response.status}`);
}

// ── helpers ───────────────────────────────────────────────────────────────────

export function apiRunToUiRun(runRecord: ApiRunRecord): Run {
  const canvasSnapshot = combineSnapshot(runRecord.agentflowSnapshot, runRecord.canvasSnapshot);
  return {
    id: runRecord.id,
    workflowId: runRecord.workflowId,
    label: runRecord.label,
    ticket: runRecord.ticket ?? '',
    status: runRecord.status === 'cancelled' ? 'stopped' : runRecord.status,
    activeNode: runRecord.activeNode,
    pausedNodeId: runRecord.pausedNodeId,
    time: formatTime(runRecord.startedAt),
    duration: runRecord.duration ?? '—',
    agent: runRecord.agent,
    errorMsg: runRecord.errorMsg,
    nodeOutputs: runRecord.nodeOutputs,
    canvasSnapshot,
    nodeStates: runRecord.nodeStates,
    initialInput: runRecord.initialInput,
    variableValues: runRecord.variableValues,
    resumedFromRunId: runRecord.resumedFromRunId,
    resumedByRunId: runRecord.resumedByRunId,
    snapshotRevision: runRecord.snapshotRevision,
    snapshotEditedAt: runRecord.snapshotEditedAt,
    snapshotEditSummary: runRecord.snapshotEditSummary,
  };
}

export function apiRunLogsToTimelineEvents(events: ApiRunLogEvent[]): TimelineEvent[] {
  const hasAcpTimeline = events.some(isAcpTimelineEvent);
  if (hasAcpTimeline) {
    return events.flatMap((event): TimelineEvent[] => {
      if (isAcpTimelineEvent(event)) return [event];
      if (event.type === 'node_status' && event.gateDecision) {
        return [{
          type: 'gate-decision',
          nodeId: event.nodeId,
          branchId: event.gateDecision.branchId,
          reason: event.gateDecision.reason,
          branches: event.gateBranches,
        }];
      }
      return [];
    });
  }
  return events
    .flatMap((event): TimelineEvent[] => apiRunLogToTimelineEvents(event));
}

export function apiRunLogToTimelineEvents(event: ApiRunLogEvent): TimelineEvent[] {
  if (isAcpTimelineEvent(event)) return [event];
  if (event.type === 'terminal') {
    return [{
      type: 'terminal',
      chunk: event.chunk,
      nodeId: event.nodeId,
      agentInvocationId: event.agentInvocationId,
      specflowSessionId: event.specflowSessionId,
      stream: event.stream,
    }];
  }
  if (event.type === 'session_update') {
    return [{
      type: 'session-update',
      update: event.update,
      nodeId: event.nodeId,
      agentInvocationId: event.agentInvocationId,
      sessionId: event.sessionId,
      specflowSessionId: event.specflowSessionId,
    }];
  }
  if (event.type === 'agent_prompt') {
    return [{
      type: 'display-message',
      role: 'user',
      text: event.prompt,
      nodeId: event.nodeId,
      agentInvocationId: event.agentInvocationId,
      specflowSessionId: event.specflowSessionId,
    }];
  }
  if (event.type === 'agent_lifecycle') {
    const lifecycle = recordValue(event.lifecycle);
    if (lifecycle.type === 'session_forked') {
      return [{
        type: 'display-message',
        role: 'system',
        text: forkLogText(event),
        nodeId: event.nodeId,
        specflowSessionId: event.parentSpecflowSessionId ?? event.specflowSessionId,
        ...(event.specflowSessionId ? {
          fork: {
            specflowSessionId: event.specflowSessionId,
            parentSpecflowSessionId: event.parentSpecflowSessionId,
            purpose: event.purpose,
            sourceNodeId: event.sourceNodeId,
            targetNodeId: event.targetNodeId,
            nodeId: event.nodeId,
            agentInvocationId: event.agentInvocationId,
          },
        } : {}),
      }];
    }
    return [];
  }
  if (event.type === 'node_status' && event.gateDecision) {
    return [{
      type: 'gate-decision',
      nodeId: event.nodeId,
      branchId: event.gateDecision.branchId,
      reason: event.gateDecision.reason,
      branches: event.gateBranches,
    }];
  }
  return [];
}

function forkLogText(event: Extract<ApiRunLogEvent, { type: 'agent_lifecycle' }>): string {
  const session = event.specflowSessionId ? ` · ${event.parentSpecflowSessionId ?? 'parent'} -> ${event.specflowSessionId}` : '';
  if (event.purpose === 'handoff') {
    const from = event.sourceNodeId ?? 'source';
    const to = event.targetNodeId ?? 'target';
    return `fork · handoff · ${from} -> ${to}${session}`;
  }
  if (event.purpose === 'gate') {
    return `fork · gate · ${event.nodeId ?? 'gate'}${session}`;
  }
  return `fork${session}`;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function combineSnapshot(
  agentflow: AgentFlowDoc | undefined,
  layoutOrLegacy: CanvasLayoutDoc | CanvasDoc | undefined,
): CanvasDoc | undefined {
  if (!layoutOrLegacy) return undefined;
  if ('id' in layoutOrLegacy) return layoutOrLegacy;
  if (!agentflow) return undefined;

  const layoutByNode = new Map(layoutOrLegacy.nodes.map((node) => [node.nodeId, node]));
  return {
    id: agentflow.id,
    version: agentflow.version,
    name: agentflow.name,
    sessions: agentflow.sessions,
    nodes: agentflow.nodes.map((node) => {
      const layout = layoutByNode.get(node.id);
      return {
        ...node,
        x: layout?.x ?? 0,
        y: layout?.y ?? 0,
        w: layout?.w ?? defaultWidth(node.kind),
      } as WorkflowNode;
    }),
    edges: agentflow.edges,
    variables: agentflow.variables,
    derived: agentflow.derived,
  };
}

function defaultWidth(kind: WorkflowNode['kind']): number {
  if (kind === 'start') return 140;
  if (kind === 'gate') return 200;
  if (kind === 'input') return 200;
  if (kind === 'end') return 140;
  return 220;
}

export function summaryToWorkflow(summary: CanvasSummary): Workflow {
  return {
    id: summary.id,
    name: summary.name,
    meta: `${summary.runs} runs`,
    runs: summary.runs,
    version: summary.version,
    deprecated: summary.deprecated,
    ...(summary.local ? { local: true } : {}),
  };
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `${time} · today`;
  if (diffDays === 1) return `yesterday · ${time}`;
  return `${diffDays}d ago`;
}
