import type { AcpTimelineEvent } from "@specflow/shared";

export interface DesignReferenceSummary {
  name: string;
  path: string;
}

export interface DesignProjectSummary {
  name: string;
  path: string;
  kind: DesignProjectKind;
  updatedAt?: string;
  runtime?: DesignRuntimeState;
}

export interface DesignProjectDetail extends DesignProjectSummary {
  artifact: DesignArtifact;
}

export type DesignReferenceImportRequest =
  | { type: "git"; name: string; url: string; branch?: string }
  | { type: "copy"; name: string; sourcePath: string };

export interface DesignReferenceContext {
  name: string;
  path: string;
  interfaceDescription?: string;
}

export type DesignProjectKind = "html" | "react";

export interface DesignProjectDevCommand {
  command: string;
  args: string[];
}

export interface DesignProjectConfig {
  kind: DesignProjectKind;
  devCommand?: DesignProjectDevCommand;
  lastRuntime?: {
    port?: number;
    startedAt?: string;
    stoppedAt?: string;
  };
}

export type DesignRuntimeStatus = "stopped" | "starting" | "running" | "failed";

export interface DesignRuntimeState {
  kind: DesignProjectKind;
  status: DesignRuntimeStatus;
  port?: number;
  url?: string;
  startedAt?: string;
  stoppedAt?: string;
  command?: DesignProjectDevCommand;
  error?: string;
  outputTail?: string;
}

export interface DesignChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  at: string;
  attachments?: DesignMessageAttachment[];
}

export interface DesignMessageAttachment {
  id: string;
  kind: "image";
  path: string;
  name: string;
  mimeType?: string;
}

export type DesignLogKind =
  | "user"
  | "prompt"
  | "assistant"
  | "terminal"
  | "lifecycle"
  | "session-update"
  | "error";

export interface DesignLogEntry {
  id: string;
  at: string;
  kind: DesignLogKind;
  phase?: "memory" | "message";
  title?: string;
  text?: string;
  stream?: "stdout" | "stderr" | "system";
  eventType?: string;
  data?: unknown;
}

export interface DesignComponentNode {
  id: string;
  name: string;
  type?: string;
  selector?: string;
  filePath?: string;
  xpath?: string;
  tagName?: string;
  textContent?: string;
  selectionLevel?: "component" | "dom-element" | string;
  anchorKind?: "data-component-id" | "id" | "xpath" | string;
  description?: string;
  children?: DesignComponentNode[];
}

export interface DesignArtifact {
  id: string;
  projectName: string;
  projectPath: string;
  kind: DesignProjectKind;
  runtime?: DesignRuntimeState;
  createdAt: string;
  frames?: DesignArtifactFrame[];
}

export interface DesignArtifactFrame {
  id: string;
  title: string;
  kind?: "desktop" | "mobile" | "tablet" | "state" | "wireframe" | "other" | string;
  width: number;
  height: number;
  x: number;
  y: number;
  route?: string;
  designPath?: string;
  wireframePath?: string;
  descriptionPath?: string;
}

export interface DesignSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  project: DesignProjectSummary;
  agentServerId?: string;
  acpSessionId?: string;
  memoryInjected: boolean;
  reference?: DesignReferenceContext;
  messages: DesignChatMessage[];
  logs?: AcpTimelineEvent[];
  latestArtifact?: DesignArtifact;
}

export interface DesignSessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectName: string;
  agentServerId?: string;
  acpSessionId?: string;
  title: string;
  messageCount: number;
}

export interface DesignSendMessageRequest {
  sessionId?: string;
  projectName: string;
  agentServerId: string;
  message: string;
  attachments?: DesignMessageAttachment[];
  referenceName?: string;
  referenceInterfaceDescription?: string;
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
}

export interface DesignInitializeSessionRequest {
  projectName: string;
  agentServerId: string;
  referenceName?: string;
  referenceInterfaceDescription?: string;
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
}

export interface DesignCreateProjectRequest {
  name: string;
  kind?: DesignProjectKind;
}

export interface DesignVersionAuthorSettings {
  authorName?: string;
  authorEmail?: string;
}

export interface DesignVersionSettings {
  versionControl?: DesignVersionAuthorSettings;
}

export interface DesignVersionCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  message: string;
  versionCode?: string;
  note?: string;
  branches: string[];
  isHead: boolean;
}

export interface DesignVersionState {
  gitAvailable: boolean;
  gitVersion?: string;
  initialized: boolean;
  dirty: boolean;
  currentBranch?: string;
  currentHead?: string;
  commits: DesignVersionCommit[];
  settings: DesignVersionSettings;
}

export interface DesignRecordVersionRequest {
  authorName: string;
  authorEmail: string;
  note?: string;
}

export interface DesignBranchFromVersionRequest {
  commitHash: string;
  branchName?: string;
}
