import type { AgentFlowDoc, CanvasEdge } from "../canvas-doc";

export interface LoopAnalysis {
  loopClosingEdgeIds: string[];
  cyclicInternalGateBranches: Array<{ gateId: string; branchId: string; edgeId: string }>;
}

interface Scc {
  nodeIds: string[];
  nodeSet: Set<string>;
}

export function analyzeAgentFlowLoops(canvasDocument: AgentFlowDoc): LoopAnalysis {
  const runtimeNodeIds = new Set(
    canvasDocument.nodes
      .filter((node) => node.kind !== "start" && node.kind !== "end" && node.kind !== "input")
      .map((node) => node.id),
  );
  const runtimeEdges = canvasDocument.edges.filter((edge) =>
    runtimeNodeIds.has(edge.from) && runtimeNodeIds.has(edge.to));
  const sccs = stronglyConnectedComponents([...runtimeNodeIds], runtimeEdges);
  const nodeKindById = new Map(canvasDocument.nodes.map((node) => [node.id, node.kind]));

  const loopClosingEdgeIds: string[] = [];
  const cyclicInternalGateBranches: Array<{ gateId: string; branchId: string; edgeId: string }> = [];

  for (const scc of sccs) {
    const selfLoop = runtimeEdges.some((edge) => edge.from === edge.to && scc.nodeSet.has(edge.from));
    if (scc.nodeIds.length === 1 && !selfLoop) continue;

    const hasGate = scc.nodeIds.some((nodeId) => nodeKindById.get(nodeId) === "gate");
    if (!hasGate) {
      throw new Error(`Loop containing ${formatNodeList(scc.nodeIds)} must be controlled by a gate.`);
    }

    const entryNodeIds = new Set<string>();
    for (const edge of canvasDocument.edges) {
      if (!scc.nodeSet.has(edge.to)) continue;
      if (scc.nodeSet.has(edge.from)) continue;
      entryNodeIds.add(edge.to);
    }

    if (entryNodeIds.size === 0) {
      throw new Error(`Loop containing ${formatNodeList(scc.nodeIds)} has no entry node.`);
    }
    if (entryNodeIds.size > 1) {
      throw new Error(
        `Loop containing ${formatNodeList(scc.nodeIds)} has multiple entry nodes: ${[...entryNodeIds].sort().join(", ")}.`,
      );
    }

    const entryNodeId = [...entryNodeIds][0]!;
    for (const edge of runtimeEdges) {
      if (scc.nodeSet.has(edge.from) && edge.to === entryNodeId) {
        loopClosingEdgeIds.push(edge.id);
      }
      if (scc.nodeSet.has(edge.from) && scc.nodeSet.has(edge.to) && edge.branch) {
        cyclicInternalGateBranches.push({ gateId: edge.from, branchId: edge.branch, edgeId: edge.id });
      }
    }
  }

  return {
    loopClosingEdgeIds: [...new Set(loopClosingEdgeIds)],
    cyclicInternalGateBranches,
  };
}

function stronglyConnectedComponents(nodeIds: string[], edges: CanvasEdge[]): Scc[] {
  const outgoing = new Map<string, string[]>();
  for (const nodeId of nodeIds) outgoing.set(nodeId, []);
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  let nextIndex = 0;
  const indexByNode = new Map<string, number>();
  const lowlinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: Scc[] = [];

  const visit = (nodeId: string): void => {
    indexByNode.set(nodeId, nextIndex);
    lowlinkByNode.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!indexByNode.has(targetId)) {
        visit(targetId);
        lowlinkByNode.set(nodeId, Math.min(lowlinkByNode.get(nodeId)!, lowlinkByNode.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowlinkByNode.set(nodeId, Math.min(lowlinkByNode.get(nodeId)!, indexByNode.get(targetId)!));
      }
    }

    if (lowlinkByNode.get(nodeId) !== indexByNode.get(nodeId)) return;
    const component: string[] = [];
    for (;;) {
      const popped = stack.pop()!;
      onStack.delete(popped);
      component.push(popped);
      if (popped === nodeId) break;
    }
    result.push({ nodeIds: component.sort(), nodeSet: new Set(component) });
  };

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) visit(nodeId);
  }
  return result;
}

function formatNodeList(nodeIds: string[]): string {
  return nodeIds.sort().map((nodeId) => `"${nodeId}"`).join(", ");
}
