import type { AgentFlowDoc, AgentFlowNode, CanvasEdge } from "./canvas-doc";
import { contentSourceForEdge, hasTransferProperties } from "./canvas-edge-semantics";

const SYMBOL_KEY = /^[a-z][a-z0-9-]*$/;
const XML_SAFE_TAG = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const INPUT_VARIABLE_NAME = /^specflow_[A-Za-z0-9_]+$/;

export function assertSymbolKey(value: string, label: string): void {
  if (!SYMBOL_KEY.test(value)) {
    throw new Error(`${label} "${value}" must match ${SYMBOL_KEY.source}.`);
  }
}

export function edgeIdFromReferences(edge: Pick<CanvasEdge, "from" | "to" | "branch">): string {
  return `edge:${edge.from}:${edge.branch ?? ""}->${edge.to}`;
}

export function normalizeAgentFlowDraft(canvasDocument: AgentFlowDoc): AgentFlowDoc {
  let stepNumber = 0;
  let gateNumber = 0;
  const nodes: AgentFlowNode[] = canvasDocument.nodes.map((node) => {
    const alias = typeof node.alias === "string" ? node.alias : "";
    if (node.kind === "input") {
      return {
        ...node,
        alias: alias.trim() ? alias : "IN",
        title: node.title ?? "",
        variableName: node.variableName ?? "",
        sessionId: null,
      };
    }
    if (node.kind === "end") {
      return {
        ...node,
        alias: alias.trim() ? alias : "END",
        title: node.title ?? "",
        sessionId: null,
      };
    }
    if (node.kind === "step") {
      stepNumber += 1;
      return {
        ...node,
        alias: alias.trim() ? alias : String(stepNumber).padStart(2, "0"),
        title: node.title ?? "",
        prompt: node.prompt ?? "",
        sessionId: node.sessionId ?? "",
      };
    }
    gateNumber += 1;
    return {
      ...node,
      alias: alias.trim() ? alias : `G${gateNumber}`,
      title: node.title ?? "",
      decisionCriteria: node.decisionCriteria ?? "",
      branches: node.branches ?? [],
    };
  });
  return {
    ...canvasDocument,
    name: canvasDocument.name ?? "",
    sessions: canvasDocument.sessions.map((session) => ({
      ...session,
      name: session.name ?? session.id,
      agentServerId: session.agentServerId ?? "",
    })),
    nodes,
    edges: canvasDocument.edges ?? [],
  };
}

export function assertValidAgentFlowDraft(input: AgentFlowDoc): void {
  const canvasDocument = normalizeAgentFlowDraft(input);
  assertSymbolKey(canvasDocument.id, "workflow filename");

  const sessionIds = new Set<string>();
  for (const session of canvasDocument.sessions) {
    assertSymbolKey(session.id, "session key");
    if (sessionIds.has(session.id)) throw new Error(`Duplicate session "${session.id}".`);
    sessionIds.add(session.id);
  }

  const nodeIds = new Set<string>();
  for (const node of canvasDocument.nodes) {
    assertSymbolKey(node.id, "node key");
    if (nodeIds.has(node.id)) throw new Error(`Duplicate node "${node.id}".`);
    nodeIds.add(node.id);
    if (node.kind !== "gate") continue;
    const branchIds = new Set<string>();
    for (const branch of node.branches) {
      assertSymbolKey(branch.id, `node "${node.id}" branch key`);
      if (branchIds.has(branch.id)) throw new Error(`Duplicate branch "${branch.id}" on node "${node.id}".`);
      branchIds.add(branch.id);
    }
  }

  const branchesByGate = new Map(
    canvasDocument.nodes
      .filter((node) => node.kind === "gate")
      .map((node) => [node.id, new Set(node.branches.map((branch) => branch.id))]),
  );
  const edgeIds = new Set<string>();
  for (const edge of canvasDocument.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge "${edge.id}" references a missing node.`);
    }
    if (edge.branch && !branchesByGate.get(edge.from)?.has(edge.branch)) {
      throw new Error(`Edge from "${edge.from}" references missing branch "${edge.branch}".`);
    }
    const source = canvasDocument.nodes.find((node) => node.id === edge.from);
    const target = canvasDocument.nodes.find((node) => node.id === edge.to);
    if (target?.kind === "input") {
      throw new Error(`Edge "${edge.id}" cannot target an input node.`);
    }
    if (source?.kind === "end") {
      throw new Error(`Edge "${edge.id}" cannot leave an end node.`);
    }
    const id = edgeIdFromReferences(edge);
    if (edgeIds.has(id)) throw new Error(`Duplicate edge "${id}".`);
    edgeIds.add(id);
  }
}

export function assertRunnableAgentFlow(input: AgentFlowDoc): void {
  const canvasDocument = normalizeAgentFlowDraft(input);
  assertValidAgentFlowDraft(canvasDocument);

  const sessionIds = new Set(canvasDocument.sessions.map((session) => session.id));
  for (const session of canvasDocument.sessions) {
    if (!session.agentServerId.trim()) {
      throw new Error(`Session "${session.id}" must define agentServerId before running.`);
    }
  }

  const inputVariables = new Set<string>();
  for (const node of canvasDocument.nodes) {
    if (node.kind === "step" && (!node.sessionId || !sessionIds.has(node.sessionId))) {
      throw new Error(`Node "${node.id}" references missing session "${node.sessionId}".`);
    }
    if (node.kind === "gate" && node.branches.length === 0) {
      throw new Error(`Gate node "${node.id}" must define at least one branch.`);
    }
    if (node.kind !== "input") continue;
    if (!node.variableName.trim()) {
      throw new Error(`Input node "${node.id}" must define variableName before running.`);
    }
    if (!INPUT_VARIABLE_NAME.test(node.variableName)) {
      throw new Error(`Input node "${node.id}" variableName "${node.variableName}" must match ${INPUT_VARIABLE_NAME.source}.`);
    }
    if (inputVariables.has(node.variableName)) {
      throw new Error(`Duplicate input variable "${node.variableName}".`);
    }
    inputVariables.add(node.variableName);
  }

  const businessInputsByGate = new Map<string, number>();
  const inputEdgesByTargetTag = new Map<string, CanvasEdge[]>();
  for (const edge of canvasDocument.edges) {
    const source = canvasDocument.nodes.find((node) => node.id === edge.from);
    const target = canvasDocument.nodes.find((node) => node.id === edge.to);
    if (source?.kind === "gate" && !edge.branch) {
      throw new Error(`Edge "${edge.id}" leaving gate "${source.id}" must select a branch.`);
    }
    if (edge.maxTraversals !== undefined && (!Number.isInteger(edge.maxTraversals) || edge.maxTraversals < 1)) {
      throw new Error(`Edge "${edge.id}" maxTraversals must be a positive integer.`);
    }
    if (edge.maxTraversals !== undefined && source?.kind !== "gate") {
      throw new Error(`Edge "${edge.id}" can define maxTraversals only when leaving a gate.`);
    }
    if (edge.outputTag && !XML_SAFE_TAG.test(edge.outputTag)) {
      throw new Error(`Edge "${edge.id}" outputTag must be an XML-safe tag name.`);
    }
    if (target?.kind === "gate" && source?.kind !== "input") {
      const count = (businessInputsByGate.get(target.id) ?? 0) + 1;
      if (count > 1) throw new Error(`Gate node "${target.id}" accepts exactly one business input edge.`);
      businessInputsByGate.set(target.id, count);
    }
    if (target?.kind === "gate" && hasTransferProperties(edge)) {
      throw new Error(`Gate input edge "${edge.id}" cannot declare transmission properties.`);
    } else if (target?.kind === "gate" && edge.loopback) {
      throw new Error(`Gate input edge "${edge.id}" cannot be a loopback edge.`);
    } else if ((source?.kind === "input" || target?.kind === "end") && hasTransferProperties(edge)) {
      throw new Error(`Control-only edge "${edge.id}" cannot declare transmission properties.`);
    } else if (edge.transmit !== true && (edge.outputTag || edge.handoffPrompt)) {
      throw new Error(`Edge "${edge.id}" cannot define outputTag or handoffPrompt unless transmit is enabled.`);
    } else if (edge.transmit === true && !edge.outputTag) {
      throw new Error(`Transmitting edge "${edge.id}" must define outputTag.`);
    } else if (edge.transmit === true && target?.kind === "step") {
      const contentSource = contentSourceForEdge(edge, canvasDocument);
      if (contentSource?.kind === "step" && contentSource.sessionId === target.sessionId) {
        throw new Error(`Same-session edge "${edge.id}" cannot declare transmission properties.`);
      }
      const targetTag = `${target.id}:${edge.outputTag}`;
      const matchingEdges = inputEdgesByTargetTag.get(targetTag) ?? [];
      if (matchingEdges.some((candidate) => !areExclusiveGateBranches(candidate, edge, canvasDocument))) {
        throw new Error(`Node "${target.id}" has duplicate transmitted outputTag "${edge.outputTag}".`);
      }
      matchingEdges.push(edge);
      inputEdgesByTargetTag.set(targetTag, matchingEdges);
    }
  }
  assertControlledLoopbacks(canvasDocument);
  assertAcyclicExecutedEdges(canvasDocument);
}

function areExclusiveGateBranches(first: CanvasEdge, second: CanvasEdge, canvasDocument: AgentFlowDoc): boolean {
  if (first.from !== second.from || !first.branch || !second.branch || first.branch === second.branch) return false;
  return canvasDocument.nodes.find((node) => node.id === first.from)?.kind === "gate";
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
