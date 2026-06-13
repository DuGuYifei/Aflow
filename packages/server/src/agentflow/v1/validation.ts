import type { AgentFlowDoc, CanvasEdge } from "../canvas-doc";

export function assertRunnableAgentFlowV1Loops(canvasDocument: AgentFlowDoc): void {
  assertControlledLoopbacks(canvasDocument);
  assertAcyclicExecutedEdges(canvasDocument);
}

function assertAcyclicExecutedEdges(canvasDocument: AgentFlowDoc): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of canvasDocument.edges.filter((candidate) => !candidate.loopback)) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error(`Workflow contains an unmarked cycle through node "${nodeId}".`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const targetId of adjacency.get(nodeId) ?? []) visit(targetId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of canvasDocument.nodes) visit(node.id);
}

function assertControlledLoopbacks(canvasDocument: AgentFlowDoc): void {
  const bySource = new Map<string, CanvasEdge[]>();
  for (const edge of canvasDocument.edges.filter((candidate) => !candidate.loopback)) {
    bySource.set(edge.from, [...(bySource.get(edge.from) ?? []), edge]);
  }
  const gateIds = new Set(canvasDocument.nodes.filter((node) => node.kind === "gate").map((node) => node.id));
  for (const loopback of canvasDocument.edges.filter((edge) => edge.loopback)) {
    const pending: Array<{ nodeId: string; crossedGateBranch: boolean }> = [{
      nodeId: loopback.to,
      crossedGateBranch: false,
    }];
    const visited = new Set<string>();
    let controlled = gateIds.has(loopback.from) && Boolean(loopback.branch);
    while (!controlled && pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.nodeId}:${current.crossedGateBranch}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (current.nodeId === loopback.from && current.crossedGateBranch) {
        controlled = true;
        break;
      }
      for (const edge of bySource.get(current.nodeId) ?? []) {
        pending.push({
          nodeId: edge.to,
          crossedGateBranch: current.crossedGateBranch || (gateIds.has(edge.from) && Boolean(edge.branch)),
        });
      }
    }
    if (!controlled) {
      throw new Error(`Loopback edge "${loopback.id}" must close a path controlled by a gate branch.`);
    }
  }
}
