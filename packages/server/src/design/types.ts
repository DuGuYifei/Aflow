export interface DesignReferenceSummary {
  name: string;
  path: string;
}

export interface DesignProjectSummary {
  name: string;
  path: string;
  updatedAt?: string;
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
  description?: string;
  children?: DesignComponentNode[];
}

export interface DesignArtifact {
  id: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  frames?: DesignArtifactFrame[];
  componentTree?: DesignComponentNode[];
}

export interface DesignArtifactFrame {
  id: string;
  title: string;
  kind?: "desktop" | "mobile" | "tablet" | "state" | "wireframe" | "other" | string;
  width: number;
  height: number;
  x: number;
  y: number;
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
  logs?: DesignLogEntry[];
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
