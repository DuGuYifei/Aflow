import type { AgentFlowDoc } from "../canvas-doc";
import { analyzeAgentFlowLoops } from "./loop-analysis";

export function assertRunnableAgentFlowV2Shape(canvasDocument: AgentFlowDoc): void {
  const startNodes = canvasDocument.nodes.filter((node) => node.kind === "start");
  if (startNodes.length === 0) {
    throw new Error(`v2 workflow "${canvasDocument.id}" must define at least one start node.`);
  }

  const incomingByTarget = new Map<string, typeof canvasDocument.edges>();
  const outgoingBySource = new Map<string, typeof canvasDocument.edges>();
  for (const edge of canvasDocument.edges) {
    incomingByTarget.set(edge.to, [...(incomingByTarget.get(edge.to) ?? []), edge]);
    outgoingBySource.set(edge.from, [...(outgoingBySource.get(edge.from) ?? []), edge]);
  }

  const nodesById = new Map(canvasDocument.nodes.map((node) => [node.id, node]));
  const initialSessions = new Map<string, string>();
  for (const start of startNodes) {
    if ((incomingByTarget.get(start.id) ?? []).length > 0) {
      throw new Error(`Start node "${start.id}" cannot have incoming edges.`);
    }
    const outgoing = outgoingBySource.get(start.id) ?? [];
    if (outgoing.length === 0) {
      throw new Error(`Start node "${start.id}" must connect to a step node.`);
    }
    for (const edge of outgoing) {
      const target = nodesById.get(edge.to);
      if (target?.kind !== "step") {
        throw new Error(`Start edge "${edge.id}" must target a step node.`);
      }
      if (!target.sessionId) continue;
      const previous = initialSessions.get(target.sessionId);
      if (previous && previous !== target.id) {
        throw new Error(
          `Multiple v2 start nodes cannot initially target the same session "${target.sessionId}" (${previous}, ${target.id}).`,
        );
      }
      initialSessions.set(target.sessionId, target.id);
    }
  }
}

export function assertControlledLoopsV2(canvasDocument: AgentFlowDoc): void {
  const analysis = analyzeAgentFlowLoops(canvasDocument);
  const branchesByGate = new Map(
    canvasDocument.nodes
      .filter((node) => node.kind === "gate")
      .map((node) => [node.id, new Map(node.branches.map((branch) => [branch.id, branch]))]),
  );

  for (const branch of analysis.cyclicInternalGateBranches) {
    const gateBranch = branchesByGate.get(branch.gateId)?.get(branch.branchId);
    if (!gateBranch?.maxTraversals) {
      throw new Error(
        `Loop branch "${branch.gateId}.${branch.branchId}" must define maxTraversals because edge "${branch.edgeId}" stays inside a loop.`,
      );
    }
  }
}
