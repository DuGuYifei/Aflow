export interface CanvasBranch {
  id: string;
  label: string;
  description?: string;
  maxTraversals?: number;
}

export interface CanvasSession {
  id: string;
  name: string;
  agentServerId: string;
  agent?: string;
  /** Raw JSON string for `McpServer[]`; see WorkflowSession.mcpServers. */
  mcpServers?: string;
}

export interface CanvasStepNode {
  kind: "step";
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

export interface CanvasGateNode {
  kind: "gate";
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  decisionCriteria: string;
  branches: CanvasBranch[];
  pauseAfterRun?: boolean;
  configOptions?: Record<string, string | boolean>;
}

export interface CanvasStartNode {
  kind: "start";
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
}

export interface CanvasEndNode {
  kind: "end";
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
}

export interface CanvasInputNode {
  kind: "input";
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  variableName: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
  sessionId: null;
}

export type CanvasNode = CanvasStartNode | CanvasStepNode | CanvasGateNode | CanvasEndNode | CanvasInputNode;

export interface CanvasEdge {
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

export interface CanvasVariable {
  name: string;
  title?: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

export interface CanvasDoc {
  id: string;
  version?: 1 | 2;
  name: string;
  sessions: CanvasSession[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  variables?: CanvasVariable[];
  derived?: CanvasDerivedMetadata;
  diagnostics?: WorkflowDiagnostic[];
}

export interface CanvasDerivedMetadata {
  loopClosingEdgeIds?: string[];
}

export type WorkflowDiagnosticSeverity = "warning" | "error";

export interface WorkflowDiagnostic {
  code: string;
  severity: WorkflowDiagnosticSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
  sessionId?: string;
  variableName?: string;
}

export type AgentFlowStartNode = Omit<CanvasStartNode, "x" | "y" | "w">;
export type AgentFlowStepNode = Omit<CanvasStepNode, "x" | "y" | "w">;
export type AgentFlowGateNode = Omit<CanvasGateNode, "x" | "y" | "w">;
export type AgentFlowEndNode = Omit<CanvasEndNode, "x" | "y" | "w">;
export type AgentFlowInputNode = Omit<CanvasInputNode, "x" | "y" | "w">;

export type AgentFlowNode =
  | AgentFlowStartNode
  | AgentFlowStepNode
  | AgentFlowGateNode
  | AgentFlowEndNode
  | AgentFlowInputNode;

export interface AgentFlowDoc {
  id: string;
  version?: 1 | 2;
  name: string;
  sessions: CanvasSession[];
  nodes: AgentFlowNode[];
  edges: CanvasEdge[];
  variables?: CanvasVariable[];
  derived?: CanvasDerivedMetadata;
  diagnostics?: WorkflowDiagnostic[];
}

export interface CanvasNodeLayout {
  nodeId: string;
  x: number;
  y: number;
  w: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasLayoutDoc {
  workflowId: string;
  version: 1;
  nodes: CanvasNodeLayout[];
  viewport?: CanvasViewport;
}
