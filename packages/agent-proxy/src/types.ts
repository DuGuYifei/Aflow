import type {
  CompleteElicitationNotification,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  InitializeResponse,
  McpServer,
  PromptResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";

export type AgentServerId = string;

export type AgentServerSource = "custom" | "registry" | "headless";

export interface AgentServerCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface BaseAgentServerSettings {
  defaultMode?: string | null;
  defaultModel?: string | null;
  defaultConfigOptions?: Record<string, string | boolean>;
  env?: Record<string, string>;
}

export interface CustomAcpAgentServerSettings extends BaseAgentServerSettings {
  type: "custom";
  command: string;
  args?: string[];
}

export interface RegistryAcpAgentServerSettings extends BaseAgentServerSettings {
  type: "registry";
  registryId: string;
}

export interface HeadlessAgentServerSettings extends BaseAgentServerSettings {
  type: "headless";
  command: string;
  argsTemplate: string[];
}

export type AgentServerSettings =
  | CustomAcpAgentServerSettings
  | RegistryAcpAgentServerSettings
  | HeadlessAgentServerSettings;

export interface AgentServerConfigFile {
  agentServers?: Record<AgentServerId, AgentServerSettings>;
  agent_servers?: Record<AgentServerId, AgentServerSettings>;
}

export type AgentTerminalStream = "stdout" | "stderr" | "system";

export interface AgentTerminalEvent {
  stream: AgentTerminalStream;
  chunk: string;
}

export interface AgentPermissionSelection {
  outcome: "selected";
  optionId: string;
}

export interface AgentPermissionCancelled {
  outcome: "cancelled";
}

export type AgentPermissionResult = AgentPermissionSelection | AgentPermissionCancelled;

export interface AgentPermissionRequest {
  sessionId: string;
  toolCall: unknown;
  options: Array<{ optionId: string; name?: string; kind?: string }>;
  raw: unknown;
}

export interface AgentSessionUpdateEvent {
  sessionId: string;
  update: SessionNotification["update"];
}

export interface AgentRunRequest {
  agentServerId: AgentServerId;
  prompt: string;
  promptBlocks?: ContentBlock[];
  messageId?: string;
  cwd: string;
  additionalDirectories?: string[];
  mcpServers?: McpServer[];
  runId?: string;
  workflowSessionId?: string;
  signal?: AbortSignal;
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
  onPermissionRequest?: (request: AgentPermissionRequest) => Promise<AgentPermissionResult>;
  onSessionUpdate?: (event: AgentSessionUpdateEvent) => void;
  onElicitationRequest?: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>;
  onElicitationComplete?: (notification: CompleteElicitationNotification) => void | Promise<void>;
  onExtMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onExtNotification?: (method: string, params: Record<string, unknown>) => void | Promise<void>;
}

export interface AgentRunResult {
  agentServerId: AgentServerId;
  exitCode: number;
  output: string;
  sessionId?: string;
  stopReason?: PromptResponse["stopReason"];
  initializeResponse?: InitializeResponse;
}

export interface ResolvedAgentServer {
  id: AgentServerId;
  source: AgentServerSource;
  command: AgentServerCommand;
  settings: AgentServerSettings;
}
