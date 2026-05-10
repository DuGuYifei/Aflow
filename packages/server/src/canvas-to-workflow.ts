import type {
  AgentNode,
  GateNode,
  PassthroughEdge,
  TaggedOutputEdge,
  Workflow,
} from "@specflow/workflow";
import type { CanvasDoc, CanvasEdge, CanvasStepNode } from "./canvas-doc";

export const MOCK_AGENT_ID = "agent-mock";

export function canvasToWorkflow(doc: CanvasDoc): Workflow {
  const endNodeIds = new Set(
    doc.nodes.filter((n) => n.kind === "end").map((n) => n.id),
  );

  const loopbackEdgeIds = new Set(
    doc.edges.filter((e) => e.loopback).map((e) => e.id),
  );

  const agents: Workflow["agents"] = [
    { id: MOCK_AGENT_ID, kind: "provider", name: "Mock", provider: "mock" },
  ];

  const sessions: Workflow["sessions"] = doc.sessions.map((s) => ({
    id: s.id,
    name: s.name,
    agentId: MOCK_AGENT_ID,
    createdAt: new Date().toISOString(),
  }));

  const nodes: Workflow["nodes"] = doc.nodes
    .filter((n) => n.kind !== "end")
    .map((n) => {
      if (n.kind === "step") {
        return buildAgentNode(n);
      }
      if (n.kind === "gate") {
        return {
          id: n.id,
          kind: "gate",
          behavior: "functional",
          title: n.title,
          description: n.gateDesc,
          promptTemplate: { template: n.gateDesc ?? "" },
          decisionCriteria: n.gateDesc ?? "",
          inputVariable: "specflow_input",
          branches: n.branches.map((b) => ({ id: b.id, label: b.label, color: b.color })),
          position: { x: n.x, y: n.y },
        } satisfies GateNode;
      }
      throw new Error(`Unknown node kind: ${(n as { kind: string }).kind}`);
    });

  const edges: Workflow["edges"] = doc.edges
    .filter((e) => !loopbackEdgeIds.has(e.id))
    .filter((e) => !endNodeIds.has(e.to) && !endNodeIds.has(e.from))
    .map((e) => buildEdge(e, doc));

  return {
    id: doc.id,
    name: doc.name,
    agents,
    sessions,
    nodes,
    edges,
  };
}

function buildAgentNode(n: CanvasStepNode): AgentNode {
  return {
    id: n.id,
    kind: "agent",
    title: n.title,
    description: n.desc,
    promptTemplate: { template: n.desc ?? "" },
    agentId: MOCK_AGENT_ID,
    sessionId: n.sessionId ?? "",
    updateSpecDoc: n.updateDoc,
    attachments: (n.attachments ?? []).map((a) => ({
      id: crypto.randomUUID(),
      kind: "file",
      path: a.label,
      label: a.label,
    })),
    relatedResources: (n.paths ?? []).map((p) => ({
      id: crypto.randomUUID(),
      kind: "file",
      path: p,
    })),
    position: { x: n.x, y: n.y },
  };
}

function buildEdge(e: CanvasEdge, doc: CanvasDoc): PassthroughEdge | TaggedOutputEdge {
  // Gate-branch edge or same-session edge → passthrough
  if (e.branch || e.sameSession) {
    return {
      id: e.id,
      kind: "passthrough",
      sourceNodeId: e.from,
      targetNodeId: e.to,
      sourcePortId: e.branch,
    } satisfies PassthroughEdge;
  }

  // Cross-session tagged edge
  const toNode = doc.nodes.find((n) => n.id === e.to);
  const toSessionId = toNode && toNode.kind !== "end" ? toNode.sessionId : undefined;

  const tag = e.tag ?? e.id;
  return {
    id: e.id,
    kind: "tagged-output",
    sourceNodeId: e.from,
    targetNodeId: e.to,
    outputTag: {
      identifier: tag,
      xmlTagName: tag,
      promptReference: tag,
    },
    handoff: e.prompt
      ? {
          agentId: MOCK_AGENT_ID,
          sessionId: toSessionId ?? undefined,
          promptTemplate: { template: e.prompt },
        }
      : undefined,
  } satisfies TaggedOutputEdge;
}
