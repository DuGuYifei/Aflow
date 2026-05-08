import type { WorkflowEdge } from "./graph/edge";
import type { WorkflowNode } from "./graph/node";
import type { AgentDefinition } from "./schema/agent";
import type { WorkflowSession } from "./schema/session";

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  agents: AgentDefinition[];
  sessions: WorkflowSession[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function createEmptyWorkflow(name = "Untitled workflow"): Workflow {
  return {
    id: crypto.randomUUID(),
    name,
    agents: [],
    sessions: [],
    nodes: [],
    edges: [],
  };
}
