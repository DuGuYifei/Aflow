import type { AcpTimelineEvent } from '@specflow/shared';

export type Theme = 'light' | 'dark';
export type Language = 'en' | 'zh-CN';

export interface Variable {
  name: string;           // always prefixed: "specflow_branch"
  title?: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

export type Density = 'comfortable' | 'compact';
export type RunStatus = 'running' | 'paused' | 'interrupted' | 'success' | 'error' | 'stopped' | 'cancelled' | 'idle' | 'pending';
export type RunState = 'running' | 'paused' | 'interrupted' | 'success' | 'error' | 'cancelled' | 'pending';
export type RunStateMap = Record<string, RunState>;
export type RuntimeEditClass = 'current' | 'future' | 'history_future' | 'history_only' | 'inactive';

export interface Session {
  id: string;
  name: string;
  agentServerId: string;
  agent?: string;
  /** Raw JSON string for ACP McpServer[]. */
  mcpServers?: string;
}

export interface Workflow {
  id: string;
  name: string;
  meta: string;
  runs: number;
  version?: 1 | 2;
  deprecated?: boolean;
  local?: boolean;
  active?: boolean;
}

export interface RunSnapshot {
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

export interface RunReachability {
  nodes: Record<string, RuntimeEditClass>;
  currentNodeIds: string[];
  futureNodeIds: string[];
  completedNodeIds: string[];
}

export interface Run {
  id: string;
  workflowId?: string;
  label: string;
  ticket: string;
  status: RunStatus;
  activeNode?: string;
  pausedNodeId?: string;
  progress?: string;
  time: string;
  duration: string;
  agent: string;
  active?: boolean;
  errorMsg?: string;
  nodeOutputs?: Record<string, string>;
  canvasSnapshot?: RunSnapshot;
  nodeStates?: RunStateMap;
  initialInput?: string;
  variableValues?: Record<string, string>;
  resumedFromRunId?: string;
  resumedByRunId?: string;
  snapshotRevision?: number;
  snapshotEditedAt?: string;
  snapshotEditSummary?: string;
}

export interface LogLine {
  chunk: string;
  nodeId?: string;
  stream?: 'stdout' | 'stderr' | 'system';
}

export type LegacyTimelineEvent =
  | {
    type: 'terminal';
    chunk: string;
    nodeId?: string;
    agentInvocationId?: string;
    specflowSessionId?: string;
    stream?: 'stdout' | 'stderr' | 'system';
    localContext?: boolean;
  }
  | {
    type: 'session-update';
    update: unknown;
    nodeId?: string;
    agentInvocationId?: string;
    sessionId?: string;
    specflowSessionId?: string;
    localContext?: boolean;
  }
  | {
    type: 'gate-decision';
    nodeId?: string;
    branchId: string;
    reason?: string;
    branches?: Array<{
      branchId: string;
      label: string;
      traversalsUsed: number;
      maxTraversals: number;
      available: boolean;
    }>;
  }
  | {
    type: 'display-message';
    role: 'agent' | 'user' | 'system';
    text: string;
    nodeId?: string;
    agentInvocationId?: string;
    specflowSessionId?: string;
    localContext?: boolean;
    fork?: {
      specflowSessionId: string;
      parentSpecflowSessionId?: string;
      purpose?: 'node' | 'gate' | 'handoff';
      sourceNodeId?: string;
      targetNodeId?: string;
      nodeId?: string;
      agentInvocationId?: string;
    };
  };

export type TimelineEvent = AcpTimelineEvent | LegacyTimelineEvent;

export interface Branch {
  id: string;
  label: string;
  description?: string;
  maxTraversals?: number;
}

export interface StartNode {
  kind: 'start';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
  locked?: boolean;
}

export interface StepNode {
  kind: 'step';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  prompt: string;
  sessionId: string | null;
  pauseAfterRun?: boolean;
  locked?: boolean;
  images?: Array<{ path: string; label?: string; mimeType?: string }>;
  paths?: string[];
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
}

export interface GateNode {
  kind: 'gate';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  decisionCriteria: string;
  branches: Branch[];
  locked?: boolean;
  configOptions?: Record<string, string | boolean>;
}

export interface EndNode {
  kind: 'end';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
  locked?: boolean;
}

export interface InputNode {
  kind: 'input';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  variableName: string;    // stored prefixed: "specflow_component_tree"
  required?: boolean;
  defaultValue?: string;
  description?: string;
  sessionId: null;
  locked?: boolean;
}

export type WorkflowNode = StartNode | StepNode | GateNode | EndNode | InputNode;

export interface Edge {
  id: string;
  from: string;
  to: string;
  transmit?: boolean;
  outputTag?: string;
  handoffPrompt?: string;
  branch?: string;
  loopback?: boolean;
  maxTraversals?: number;
}

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'variable'; name: string }
  | { kind: 'edge'; id: string }
  | { kind: 'nodes'; ids: string[] };
