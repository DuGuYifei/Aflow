import type { AgentFlowDoc, AgentFlowNode, CanvasEdge } from "./canvas-doc";
import { contentSourceForEdge, hasTransferProperties } from "./canvas-edge-semantics";
import { assertRunnableAgentFlowV1Loops } from "./v1/validation";
import { assertControlledLoopsV2, assertRunnableAgentFlowV2Shape } from "./v2/validation";

const SYMBOL_KEY = /^[a-z][a-z0-9-]*$/;
const XML_SAFE_TAG = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const INPUT_VARIABLE_NAME = /^specflow_[A-Za-z0-9_]+$/;

export interface AgentFlowValidationAgentServer {
  settings: {
    type: string;
  };
}

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
  let startNumber = 0;
  const nodes: AgentFlowNode[] = canvasDocument.nodes.map((node) => {
    const alias = typeof node.alias === "string" ? node.alias : "";
    if (node.kind === "start") {
      startNumber += 1;
      return {
        ...node,
        alias: alias.trim() ? alias : (startNumber === 1 ? "START" : `START ${startNumber}`),
        title: node.title ?? "Start",
        sessionId: null,
      };
    }
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
      branches: (node.branches ?? []).map((branch) => ({
        ...branch,
        label: branch.label ?? branch.id,
      })),
    };
  });
  return {
    ...canvasDocument,
    version: canvasDocument.version ?? 1,
    name: canvasDocument.name ?? "",
    sessions: canvasDocument.sessions.map((session) => ({
      ...session,
      name: session.name ?? session.id,
      agentServerId: session.agentServerId ?? "",
    })),
    nodes,
    edges: canvasDocument.edges ?? [],
    variables: canvasDocument.variables?.map((variable) => ({
      ...variable,
      title: variable.title ?? "",
      required: variable.required !== false,
    })),
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
    if (target?.kind === "start") {
      throw new Error(`Edge "${edge.id}" cannot target a start node.`);
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

  const version = canvasDocument.version ?? 1;
  const sessionIds = new Set(canvasDocument.sessions.map((session) => session.id));
  for (const session of canvasDocument.sessions) {
    if (!session.agentServerId.trim()) {
      throw new Error(`Session "${session.id}" must define agentServerId before running.`);
    }
  }

  if (version === 2) {
    assertRunnableAgentFlowV2Shape(canvasDocument);
  }

  const inputVariables = new Set<string>();
  for (const variable of canvasDocument.variables ?? []) {
    if (!INPUT_VARIABLE_NAME.test(variable.name)) {
      throw new Error(`Variable "${variable.name}" must match ${INPUT_VARIABLE_NAME.source}.`);
    }
    if (inputVariables.has(variable.name)) {
      throw new Error(`Duplicate input variable "${variable.name}".`);
    }
    inputVariables.add(variable.name);
  }

  for (const node of canvasDocument.nodes) {
    if (node.kind === "step" && (!node.sessionId || !sessionIds.has(node.sessionId))) {
      throw new Error(`Node "${node.id}" references missing session "${node.sessionId}".`);
    }
    if (node.kind === "gate" && node.branches.length === 0) {
      throw new Error(`Gate node "${node.id}" must define at least one branch.`);
    }
    if (node.kind === "gate") {
      for (const branch of node.branches) {
        if (branch.maxTraversals !== undefined && (!Number.isInteger(branch.maxTraversals) || branch.maxTraversals < 1)) {
          throw new Error(`Gate node "${node.id}" branch "${branch.id}" maxTraversals must be a positive integer.`);
        }
      }
    }
    if (version === 2 && node.kind === "input") {
      throw new Error(`v2 workflow "${canvasDocument.id}" cannot use input nodes; declare top-level variables instead.`);
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
    if (version === 2 && edge.loopback) {
      throw new Error(`v2 edge "${edge.id}" cannot define loopback; loops are detected automatically.`);
    }
    if (version === 2 && edge.maxTraversals !== undefined) {
      throw new Error(`v2 edge "${edge.id}" cannot define maxTraversals; put it on the gate branch instead.`);
    }
    if (source?.kind === "start") {
      if (edge.branch || hasTransferProperties(edge) || edge.maxTraversals !== undefined || edge.loopback) {
        throw new Error(`Start edge "${edge.id}" must be control-only.`);
      }
      if (target?.kind !== "step") {
        throw new Error(`Start edge "${edge.id}" must target a step node.`);
      }
    }
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
    } else if ((source?.kind === "input" || source?.kind === "start" || target?.kind === "end") && hasTransferProperties(edge)) {
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
  if (version === 1) {
    assertRunnableAgentFlowV1Loops(canvasDocument);
  } else {
    assertControlledLoopsV2(canvasDocument);
  }
}

export function assertInteractivePauseSupported(
  input: AgentFlowDoc,
  agentServers: Map<string, AgentFlowValidationAgentServer>,
): void {
  const canvasDocument = normalizeAgentFlowDraft(input);
  const sessionsById = new Map(canvasDocument.sessions.map((session) => [session.id, session]));
  for (const node of canvasDocument.nodes) {
    if (node.kind !== "step" || !node.pauseAfterRun) continue;
    const serverId = sessionsById.get(node.sessionId ?? "")?.agentServerId;
    if (serverId && agentServers.get(serverId)?.settings.type === "headless") {
      throw new Error(`Node "${node.id}" cannot pause for interaction because headless agent "${serverId}" has no ACP session.`);
    }
  }
}

export function assertNoPauseNodes(input: AgentFlowDoc): void {
  const canvasDocument = normalizeAgentFlowDraft(input);
  const pausedNodes = canvasDocument.nodes.filter((node) => node.kind === "step" && node.pauseAfterRun);
  if (pausedNodes.length === 0) return;
  throw new Error([
    "specflow run does not support pauseAfterRun nodes.",
    "Start the UI with `specflow`, then run this workflow from the browser to use pause/continue.",
    "Paused nodes:",
    ...pausedNodes.map((node) => `  - ${node.alias} ${node.title} (${node.id})`),
  ].join("\n"));
}

export function assertServerRunnableAgentFlow(
  input: AgentFlowDoc,
  agentServers: Map<string, AgentFlowValidationAgentServer>,
): void {
  assertRunnableAgentFlow(input);
  assertInteractivePauseSupported(input, agentServers);
}

export function assertCliRunnableAgentFlow(input: AgentFlowDoc): void {
  assertNoPauseNodes(input);
  assertRunnableAgentFlow(input);
}

function areExclusiveGateBranches(first: CanvasEdge, second: CanvasEdge, canvasDocument: AgentFlowDoc): boolean {
  if (first.from !== second.from || !first.branch || !second.branch || first.branch === second.branch) return false;
  return canvasDocument.nodes.find((node) => node.id === first.from)?.kind === "gate";
}
