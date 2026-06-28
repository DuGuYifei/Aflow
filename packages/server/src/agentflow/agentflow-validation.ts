import type { AgentFlowDoc, AgentFlowNode, CanvasDerivedMetadata, CanvasEdge, WorkflowDiagnostic } from "./canvas-doc";
import { contentSourceForEdge, hasTransferProperties } from "./canvas-edge-semantics";
import { assertControlledLoopsV2, assertRunnableAgentFlowV2Shape } from "./v2/validation";
import { analyzeAgentFlowLoops } from "./v2/loop-analysis";

const SYMBOL_KEY = /^[a-z][a-z0-9-]*$/;
const XML_SAFE_TAG = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const INPUT_VARIABLE_NAME = /^specflow_[A-Za-z0-9_]+$/;

export interface AgentFlowValidationAgentServer {
  settings: {
    type: string;
  };
}

export interface AgentFlowDiagnosticsResult {
  diagnostics: WorkflowDiagnostic[];
  derived: CanvasDerivedMetadata;
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
    version: canvasDocument.version ?? 2,
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

export function collectAgentFlowDiagnostics(input: AgentFlowDoc): AgentFlowDiagnosticsResult {
  const canvasDocument = normalizeAgentFlowDraft(input);
  const diagnostics: WorkflowDiagnostic[] = [];
  const derived: CanvasDerivedMetadata = {};
  const version = canvasDocument.version ?? 2;

  const push = (diagnostic: WorkflowDiagnostic): void => {
    diagnostics.push(diagnostic);
  };
  const pushError = (
    code: string,
    message: string,
    details: Omit<WorkflowDiagnostic, "code" | "severity" | "message"> = {},
  ): void => push({ code, severity: "error", message, ...details });
  const pushWarning = (
    code: string,
    message: string,
    details: Omit<WorkflowDiagnostic, "code" | "severity" | "message"> = {},
  ): void => push({ code, severity: "warning", message, ...details });
  const validateSymbol = (value: string, label: string, code: string, details: Omit<WorkflowDiagnostic, "code" | "severity" | "message"> = {}): void => {
    if (!SYMBOL_KEY.test(value)) {
      pushError(code, `${label} "${value}" must match ${SYMBOL_KEY.source}.`, details);
    }
  };

  validateSymbol(canvasDocument.id, "workflow filename", "INVALID_WORKFLOW_KEY");
  if (version !== 2) {
    pushError("UNSUPPORTED_WORKFLOW_VERSION", `Workflow "${canvasDocument.id}" must use version: 2. Workflow YAML v1 is no longer supported.`);
  }

  const sessionIds = new Set<string>();
  for (const session of canvasDocument.sessions) {
    validateSymbol(session.id, "session key", "INVALID_SESSION_KEY", { sessionId: session.id });
    if (sessionIds.has(session.id)) pushError("DUPLICATE_SESSION", `Duplicate session "${session.id}".`, { sessionId: session.id });
    sessionIds.add(session.id);
    if (!session.agentServerId.trim()) {
      pushError("SESSION_MISSING_AGENT_SERVER", `Session "${session.id}" must define agentServerId before running.`, { sessionId: session.id });
    }
  }

  const nodeIds = new Set<string>();
  const nodesById = new Map<string, AgentFlowNode>();
  const branchIdsByGate = new Map<string, Set<string>>();
  for (const node of canvasDocument.nodes) {
    validateSymbol(node.id, "node key", "INVALID_NODE_KEY", { nodeId: node.id });
    if (nodeIds.has(node.id)) pushError("DUPLICATE_NODE", `Duplicate node "${node.id}".`, { nodeId: node.id });
    nodeIds.add(node.id);
    nodesById.set(node.id, node);
    if (node.kind === "step" && (!node.sessionId || !sessionIds.has(node.sessionId))) {
      pushError("NODE_MISSING_SESSION", `Node "${node.id}" references missing session "${node.sessionId}".`, { nodeId: node.id, sessionId: node.sessionId ?? undefined });
    }
    if (node.kind === "gate") {
      if (node.branches.length === 0) {
        pushError("GATE_MISSING_BRANCH", `Gate node "${node.id}" must define at least one branch.`, { nodeId: node.id });
      }
      const branchIds = new Set<string>();
      for (const branch of node.branches) {
        validateSymbol(branch.id, `node "${node.id}" branch key`, "INVALID_BRANCH_KEY", { nodeId: node.id });
        if (branchIds.has(branch.id)) pushError("DUPLICATE_BRANCH", `Duplicate branch "${branch.id}" on node "${node.id}".`, { nodeId: node.id });
        branchIds.add(branch.id);
        if (branch.maxTraversals !== undefined && (!Number.isInteger(branch.maxTraversals) || branch.maxTraversals < 1)) {
          pushError("INVALID_BRANCH_MAX_TRAVERSALS", `Gate node "${node.id}" branch "${branch.id}" maxTraversals must be a positive integer.`, { nodeId: node.id });
        }
      }
      branchIdsByGate.set(node.id, branchIds);
    }
    if (version === 2 && node.kind === "input") {
      pushError("V2_INPUT_NODE_UNSUPPORTED", `v2 workflow "${canvasDocument.id}" cannot use input nodes; declare top-level variables instead.`, { nodeId: node.id });
    }
    if (node.kind === "input") {
      if (!node.variableName.trim()) {
        pushError("INPUT_NODE_MISSING_VARIABLE", `Input node "${node.id}" must define variableName before running.`, { nodeId: node.id });
      } else if (!INPUT_VARIABLE_NAME.test(node.variableName)) {
        pushError("INVALID_INPUT_NODE_VARIABLE", `Input node "${node.id}" variableName "${node.variableName}" must match ${INPUT_VARIABLE_NAME.source}.`, { nodeId: node.id, variableName: node.variableName });
      }
    }
  }

  const inputVariables = new Set<string>();
  for (const variable of canvasDocument.variables ?? []) {
    if (!INPUT_VARIABLE_NAME.test(variable.name)) {
      pushError("INVALID_VARIABLE_NAME", `Variable "${variable.name}" must match ${INPUT_VARIABLE_NAME.source}.`, { variableName: variable.name });
    }
    if (inputVariables.has(variable.name)) {
      pushError("DUPLICATE_VARIABLE", `Duplicate input variable "${variable.name}".`, { variableName: variable.name });
    }
    inputVariables.add(variable.name);
    if (variable.required !== false && !variable.defaultValue) {
      pushWarning("REQUIRED_VARIABLE_NEEDS_RUNTIME_VALUE", `Required variable "${variable.name}" needs a runtime value before this workflow can run.`, { variableName: variable.name });
    }
  }
  for (const node of canvasDocument.nodes) {
    if (node.kind !== "input" || !node.variableName) continue;
    if (inputVariables.has(node.variableName)) {
      pushError("DUPLICATE_VARIABLE", `Duplicate input variable "${node.variableName}".`, { nodeId: node.id, variableName: node.variableName });
    }
    inputVariables.add(node.variableName);
  }

  const incomingByTarget = new Map<string, CanvasEdge[]>();
  const outgoingBySource = new Map<string, CanvasEdge[]>();
  const edgeIds = new Set<string>();
  for (const edge of canvasDocument.edges) {
    incomingByTarget.set(edge.to, [...(incomingByTarget.get(edge.to) ?? []), edge]);
    outgoingBySource.set(edge.from, [...(outgoingBySource.get(edge.from) ?? []), edge]);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      pushError("EDGE_MISSING_NODE", `Edge "${edge.id}" references a missing node.`, { edgeId: edge.id });
    }
    const source = nodesById.get(edge.from);
    const target = nodesById.get(edge.to);
    if (edge.branch && !branchIdsByGate.get(edge.from)?.has(edge.branch)) {
      pushError("EDGE_MISSING_BRANCH", `Edge from "${edge.from}" references missing branch "${edge.branch}".`, { edgeId: edge.id, nodeId: edge.from });
    }
    if (target?.kind === "input") pushError("EDGE_TARGETS_INPUT", `Edge "${edge.id}" cannot target an input node.`, { edgeId: edge.id, nodeId: target.id });
    if (target?.kind === "start") pushError("EDGE_TARGETS_START", `Edge "${edge.id}" cannot target a start node.`, { edgeId: edge.id, nodeId: target.id });
    if (source?.kind === "end") pushError("EDGE_LEAVES_END", `Edge "${edge.id}" cannot leave an end node.`, { edgeId: edge.id, nodeId: source.id });
    const authoredEdgeId = edgeIdFromReferences(edge);
    if (edgeIds.has(authoredEdgeId)) pushError("DUPLICATE_EDGE", `Duplicate edge "${authoredEdgeId}".`, { edgeId: edge.id });
    edgeIds.add(authoredEdgeId);
  }

  const collectBranchSessionsBeforeJoin = (edge: CanvasEdge): Set<string> => {
    const sessions = new Set<string>();
    const visited = new Set<string>();
    const stack = [edge.to];
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = nodesById.get(nodeId);
      if (!node) continue;
      if (node.kind === "step" && node.sessionId) sessions.add(node.sessionId);
      for (const nextEdge of outgoingBySource.get(nodeId) ?? []) {
        const targetIncomingCount = incomingByTarget.get(nextEdge.to)?.length ?? 0;
        if (targetIncomingCount > 1) continue;
        stack.push(nextEdge.to);
      }
    }
    return sessions;
  };

  for (const node of canvasDocument.nodes) {
    if (node.kind !== "step") continue;
    const outgoing = (outgoingBySource.get(node.id) ?? []).filter((edge) => nodesById.has(edge.to));
    if (outgoing.length <= 1) continue;
    pushWarning(
      "NON_GATE_FANOUT",
      `Step node "${node.id}" has ${outgoing.length} outgoing edges; all targets will run in queue order. Use a gate for choose-one branching.`,
      { nodeId: node.id, edgeId: outgoing[0]?.id },
    );
    const firstBranchBySession = new Map<string, number>();
    const warnedSessions = new Set<string>();
    outgoing.forEach((edge, branchIndex) => {
      for (const sessionId of collectBranchSessionsBeforeJoin(edge)) {
        const firstBranch = firstBranchBySession.get(sessionId);
        if (firstBranch === undefined) {
          firstBranchBySession.set(sessionId, branchIndex);
        } else if (firstBranch !== branchIndex && !warnedSessions.has(sessionId)) {
          warnedSessions.add(sessionId);
          pushWarning(
            "FANOUT_SHARED_SESSION_REVIEW",
            `Step node "${node.id}" fans out into branches that may reuse session "${sessionId}" before joining; confirm queued session reuse is intentional.`,
            { nodeId: node.id, edgeId: edge.id, sessionId },
          );
        }
      }
    });
  }

  const startNodes = canvasDocument.nodes.filter((node) => node.kind === "start");
  if (startNodes.length === 0) {
    pushError("V2_START_REQUIRED", `v2 workflow "${canvasDocument.id}" must define at least one start node.`);
  }
  const initialSessions = new Map<string, string>();
  for (const start of startNodes) {
    if ((incomingByTarget.get(start.id) ?? []).length > 0) {
      pushError("V2_START_HAS_INCOMING", `Start node "${start.id}" cannot have incoming edges.`, { nodeId: start.id });
    }
    const outgoing = outgoingBySource.get(start.id) ?? [];
    if (outgoing.length === 0) {
      pushError("V2_START_WITHOUT_STEP", `Start node "${start.id}" must connect to a step node.`, { nodeId: start.id });
    }
    for (const edge of outgoing) {
      const target = nodesById.get(edge.to);
      if (target?.kind !== "step") {
        pushError("V2_START_EDGE_TARGET", `Start edge "${edge.id}" must target a step node.`, { edgeId: edge.id, nodeId: edge.to });
        continue;
      }
      if (!target.sessionId) continue;
      const previous = initialSessions.get(target.sessionId);
      if (previous && previous !== target.id) {
        pushError(
          "V2_START_SESSION_CONFLICT",
          `Multiple v2 start nodes cannot initially target the same session "${target.sessionId}" (${previous}, ${target.id}).`,
          { edgeId: edge.id, nodeId: target.id, sessionId: target.sessionId },
        );
      }
      initialSessions.set(target.sessionId, target.id);
    }
  }

  const businessInputsByGate = new Map<string, number>();
  const inputEdgesByTargetTag = new Map<string, CanvasEdge[]>();
  for (const edge of canvasDocument.edges) {
    const source = nodesById.get(edge.from);
    const target = nodesById.get(edge.to);
    if (edge.loopback) {
      pushError("V2_EDGE_LOOPBACK_UNSUPPORTED", `v2 edge "${edge.id}" cannot define loopback; loops are detected automatically.`, { edgeId: edge.id });
    }
    if (edge.maxTraversals !== undefined) {
      pushError("V2_EDGE_MAX_TRAVERSALS_UNSUPPORTED", `v2 edge "${edge.id}" cannot define maxTraversals; put it on the gate branch instead.`, { edgeId: edge.id });
    }
    if (source?.kind === "start") {
      if (edge.branch || hasTransferProperties(edge) || edge.maxTraversals !== undefined || edge.loopback) {
        pushError("START_EDGE_NOT_CONTROL_ONLY", `Start edge "${edge.id}" must be control-only.`, { edgeId: edge.id });
      }
      if (target?.kind !== "step") {
        pushError("START_EDGE_TARGET", `Start edge "${edge.id}" must target a step node.`, { edgeId: edge.id, nodeId: edge.to });
      }
    }
    if (source?.kind === "gate" && !edge.branch) {
      pushError("GATE_EDGE_MISSING_BRANCH", `Edge "${edge.id}" leaving gate "${source.id}" must select a branch.`, { edgeId: edge.id, nodeId: source.id });
    }
    if (edge.maxTraversals !== undefined && (!Number.isInteger(edge.maxTraversals) || edge.maxTraversals < 1)) {
      pushError("INVALID_EDGE_MAX_TRAVERSALS", `Edge "${edge.id}" maxTraversals must be a positive integer.`, { edgeId: edge.id });
    }
    if (edge.maxTraversals !== undefined && source?.kind !== "gate") {
      pushError("EDGE_MAX_TRAVERSALS_SOURCE", `Edge "${edge.id}" can define maxTraversals only when leaving a gate.`, { edgeId: edge.id, nodeId: source?.id });
    }
    if (edge.outputTag && !XML_SAFE_TAG.test(edge.outputTag)) {
      pushError("INVALID_OUTPUT_TAG", `Edge "${edge.id}" outputTag must be an XML-safe tag name.`, { edgeId: edge.id });
    }
    if (target?.kind === "gate" && source?.kind !== "input") {
      const count = (businessInputsByGate.get(target.id) ?? 0) + 1;
      if (count > 1) pushError("GATE_MULTIPLE_BUSINESS_INPUTS", `Gate node "${target.id}" accepts exactly one business input edge.`, { nodeId: target.id, edgeId: edge.id });
      businessInputsByGate.set(target.id, count);
    }
    if (target?.kind === "gate" && hasTransferProperties(edge)) {
      pushError("GATE_INPUT_TRANSFER_UNSUPPORTED", `Gate input edge "${edge.id}" cannot declare transmission properties.`, { edgeId: edge.id });
    } else if (target?.kind === "gate" && edge.loopback) {
      pushError("GATE_INPUT_LOOPBACK_UNSUPPORTED", `Gate input edge "${edge.id}" cannot be a loopback edge.`, { edgeId: edge.id });
    } else if ((source?.kind === "input" || source?.kind === "start" || target?.kind === "end") && hasTransferProperties(edge)) {
      pushError("CONTROL_EDGE_TRANSFER_UNSUPPORTED", `Control-only edge "${edge.id}" cannot declare transmission properties.`, { edgeId: edge.id });
    } else if (edge.transmit !== true && (edge.outputTag || edge.handoffPrompt)) {
      pushError("EDGE_TRANSFER_DISABLED_FIELDS", `Edge "${edge.id}" cannot define outputTag or handoffPrompt unless transmit is enabled.`, { edgeId: edge.id });
    } else if (edge.transmit === true && !edge.outputTag) {
      pushError("EDGE_TRANSMIT_MISSING_TAG", `Transmitting edge "${edge.id}" must define outputTag.`, { edgeId: edge.id });
    } else if (edge.transmit === true && target?.kind === "step") {
      try {
        const contentSource = contentSourceForEdge(edge, canvasDocument);
        if (contentSource?.kind === "step" && contentSource.sessionId === target.sessionId) {
          pushError("SAME_SESSION_TRANSFER_UNSUPPORTED", `Same-session edge "${edge.id}" cannot declare transmission properties.`, { edgeId: edge.id });
        }
      } catch (error) {
        pushError("EDGE_TRANSFER_SOURCE_INVALID", errorMessage(error), { edgeId: edge.id });
      }
      const targetTag = `${target.id}:${edge.outputTag}`;
      const matchingEdges = inputEdgesByTargetTag.get(targetTag) ?? [];
      if (matchingEdges.some((candidate) => !areExclusiveGateBranches(candidate, edge, canvasDocument))) {
        pushError("DUPLICATE_TRANSMITTED_OUTPUT_TAG", `Node "${target.id}" has duplicate transmitted outputTag "${edge.outputTag}".`, { edgeId: edge.id, nodeId: target.id });
      }
      matchingEdges.push(edge);
      inputEdgesByTargetTag.set(targetTag, matchingEdges);
    }
  }

  try {
    const analysis = analyzeAgentFlowLoops(canvasDocument);
    derived.loopClosingEdgeIds = analysis.loopClosingEdgeIds;
    const branchesByGate = new Map(
      canvasDocument.nodes
        .filter((node) => node.kind === "gate")
        .map((node) => [node.id, new Map(node.branches.map((branch) => [branch.id, branch]))]),
    );
    for (const branch of analysis.cyclicInternalGateBranches) {
      const gateBranch = branchesByGate.get(branch.gateId)?.get(branch.branchId);
      if (!gateBranch?.maxTraversals) {
        pushError(
          "V2_LOOP_BRANCH_MAX_TRAVERSALS_REQUIRED",
          `Loop branch "${branch.gateId}.${branch.branchId}" must define maxTraversals because edge "${branch.edgeId}" stays inside a loop.`,
          { nodeId: branch.gateId, edgeId: branch.edgeId },
        );
      }
    }
  } catch (error) {
    derived.loopClosingEdgeIds = [];
    pushError("V2_LOOP_INVALID", errorMessage(error));
  }

  return { diagnostics, derived };
}

export function assertRunnableAgentFlow(input: AgentFlowDoc): void {
  const canvasDocument = normalizeAgentFlowDraft(input);
  assertValidAgentFlowDraft(canvasDocument);

  const diagnostics = collectAgentFlowDiagnostics(canvasDocument).diagnostics;
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (firstError) throw new Error(firstError.message);

  const version = canvasDocument.version ?? 2;
  if (version !== 2) {
    throw new Error(`Workflow "${canvasDocument.id}" must use version: 2. Workflow YAML v1 is no longer supported.`);
  }
  const sessionIds = new Set(canvasDocument.sessions.map((session) => session.id));
  for (const session of canvasDocument.sessions) {
    if (!session.agentServerId.trim()) {
      throw new Error(`Session "${session.id}" must define agentServerId before running.`);
    }
  }

  assertRunnableAgentFlowV2Shape(canvasDocument);

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
    if (node.kind === "input") {
      throw new Error(`v2 workflow "${canvasDocument.id}" cannot use input nodes; declare top-level variables instead.`);
    }
  }

  const businessInputsByGate = new Map<string, number>();
  const inputEdgesByTargetTag = new Map<string, CanvasEdge[]>();
  for (const edge of canvasDocument.edges) {
    const source = canvasDocument.nodes.find((node) => node.id === edge.from);
    const target = canvasDocument.nodes.find((node) => node.id === edge.to);
    if (edge.loopback) {
      throw new Error(`v2 edge "${edge.id}" cannot define loopback; loops are detected automatically.`);
    }
    if (edge.maxTraversals !== undefined) {
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
  assertControlledLoopsV2(canvasDocument);
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
  const pausedNodes = canvasDocument.nodes.filter((node) => (node.kind === "step" || node.kind === "gate") && node.pauseAfterRun);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
