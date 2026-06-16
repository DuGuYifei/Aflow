import type { WorkflowExecutionCheckpoint } from "@specflow/bridge";
import type {
  AgentFlowDoc,
  AgentFlowNode,
  CanvasEdge,
  CanvasLayoutDoc,
  CanvasNodeLayout,
  CanvasSession,
  CanvasVariable,
} from "./canvas-doc";
import { computeRunReachability, type RuntimeEditClass, type RunReachability } from "./run-reachability";
import type { RunRecord } from "./run-store";

export type RunGraphOperation =
  | { op: "update_node"; nodeId: string; patch: Partial<AgentFlowNode> }
  | { op: "update_node_layout"; nodeId: string; position: Partial<CanvasNodeLayout> }
  | { op: "update_edge"; edgeId: string; patch: Partial<CanvasEdge> }
  | { op: "add_node"; node: AgentFlowNode; position?: Partial<CanvasNodeLayout> }
  | { op: "remove_node"; nodeId: string }
  | { op: "add_edge"; edge: CanvasEdge }
  | { op: "remove_edge"; edgeId: string }
  | { op: "replace_edge_endpoint"; edgeId: string; from?: string; to?: string }
  | { op: "add_session"; session: CanvasSession }
  | { op: "update_session"; sessionId: string; patch: Partial<CanvasSession> }
  | { op: "remove_session"; sessionId: string }
  | { op: "add_variable"; variable: CanvasVariable }
  | { op: "update_variable"; name: string; patch: Partial<CanvasVariable> }
  | { op: "remove_variable"; name: string }
  | {
      op: "insert_node_between";
      sourceNodeId: string;
      targetNodeId: string;
      node: AgentFlowNode;
      position?: Partial<CanvasNodeLayout>;
      incomingEdge?: Partial<CanvasEdge>;
      outgoingEdge?: Partial<CanvasEdge>;
    };

export interface RunGraphPatchInput {
  record: RunRecord;
  operations: RunGraphOperation[];
  summary?: string;
}

export interface RunGraphPatchRejectedOperation {
  index: number;
  op: string;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface RunGraphPatchAppliedOperation {
  index: number;
  op: string;
  status: "applied" | "skipped";
}

export interface RunGraphMigrationPreview {
  queueRebuild?: {
    discardedFutureQueueEntries: Array<{ nodeId: string; traversal?: number }>;
    rebuiltQueueEntries: Array<{ nodeId: string; traversal?: number }>;
    frontier: string[];
  };
  pendingInputRebuild?: {
    discardedFutureInputKeys: string[];
    preservedInputKeys: string[];
  };
  nodeStateChanges?: Array<{ nodeId: string; from?: string; to?: string }>;
  edgeReachabilityChanges?: {
    removedEdgeIds: string[];
    addedEdgeIds: string[];
  };
}

export interface RunGraphPatchResult {
  ok: boolean;
  agentflow: AgentFlowDoc;
  layout: CanvasLayoutDoc;
  checkpoint?: WorkflowExecutionCheckpoint;
  reachability: RunReachability;
  appliedOperations: RunGraphPatchAppliedOperation[];
  rejectedOperations: RunGraphPatchRejectedOperation[];
  migrationPreview: RunGraphMigrationPreview;
}

const EDITABLE_NODE_CLASSES = new Set<RuntimeEditClass>(["current", "future", "history_future"]);
const FUTURE_NODE_CLASSES = new Set<RuntimeEditClass>(["future", "history_future", "current"]);
const TOPOLOGY_OPS = new Set<RunGraphOperation["op"]>([
  "add_node",
  "remove_node",
  "add_edge",
  "remove_edge",
  "replace_edge_endpoint",
  "insert_node_between",
]);

export function applyRunGraphPatch(input: RunGraphPatchInput): RunGraphPatchResult {
  const agentflow = cloneJson(input.record.agentflowSnapshot);
  const layout = cloneJson(input.record.canvasSnapshot);
  const reachability = computeRunReachability(input.record);
  const appliedOperations: RunGraphPatchAppliedOperation[] = [];
  const rejectedOperations: RunGraphPatchRejectedOperation[] = [];
  const migrationPreview: RunGraphMigrationPreview = {};
  let topologyChanged = false;

  for (const [index, operation] of input.operations.entries()) {
    const beforeNodeIds = new Set(agentflow.nodes.map((node) => node.id));
    const beforeEdgeIds = new Set(agentflow.edges.map((edge) => edge.id));
    const rejected = applyOperation({
      index,
      operation,
      agentflow,
      layout,
      reachability,
      record: input.record,
    });
    if (rejected) {
      rejectedOperations.push(rejected);
      continue;
    }
    appliedOperations.push({ index, op: operation.op, status: "applied" });
    if (TOPOLOGY_OPS.has(operation.op)) {
      topologyChanged = true;
      migrationPreview.edgeReachabilityChanges = mergeEdgeChanges(
        migrationPreview.edgeReachabilityChanges,
        beforeEdgeIds,
        new Set(agentflow.edges.map((edge) => edge.id)),
      );
      migrationPreview.nodeStateChanges = [
        ...(migrationPreview.nodeStateChanges ?? []),
        ...newNodeStateChanges(input.record, beforeNodeIds, new Set(agentflow.nodes.map((node) => node.id))),
      ];
    }
  }

  const checkpoint = parseCheckpoint(input.record.checkpoint);
  const migratedCheckpoint = checkpoint && topologyChanged
    ? rebuildFutureSchedulingFromCheckpoint(checkpoint, migrationPreview)
    : checkpoint;

  return {
    ok: rejectedOperations.length === 0,
    agentflow,
    layout,
    checkpoint: migratedCheckpoint,
    reachability: computeRunReachability({
      ...input.record,
      agentflowSnapshot: agentflow,
      canvasSnapshot: layout,
      ...(migratedCheckpoint ? { checkpoint: migratedCheckpoint as unknown as Record<string, unknown> } : {}),
    }),
    appliedOperations,
    rejectedOperations,
    migrationPreview,
  };
}

function applyOperation(input: {
  index: number;
  operation: RunGraphOperation;
  agentflow: AgentFlowDoc;
  layout: CanvasLayoutDoc;
  reachability: RunReachability;
  record: RunRecord;
}): RunGraphPatchRejectedOperation | undefined {
  switch (input.operation.op) {
    case "update_node":
      return updateNode({ ...input, operation: input.operation });
    case "update_node_layout":
      return updateNodeLayout({ ...input, operation: input.operation });
    case "update_edge":
      return updateEdge({ ...input, operation: input.operation });
    case "add_node":
      return addNode(input, input.operation.node, input.operation.position);
    case "remove_node":
      return removeNode(input, input.operation.nodeId);
    case "add_edge":
      return addEdge({ ...input, operation: input.operation });
    case "remove_edge":
      return removeEdge(input, input.operation.edgeId);
    case "replace_edge_endpoint":
      return replaceEdgeEndpoint({ ...input, operation: input.operation });
    case "add_session":
      return addSession({ ...input, operation: input.operation });
    case "update_session":
      return updateSession({ ...input, operation: input.operation });
    case "remove_session":
      return removeSession({ ...input, operation: input.operation });
    case "add_variable":
      return addVariable({ ...input, operation: input.operation });
    case "update_variable":
      return updateVariable({ ...input, operation: input.operation });
    case "remove_variable":
      return removeVariable({ ...input, operation: input.operation });
    case "insert_node_between":
      return insertNodeBetween({ ...input, operation: input.operation });
  }
}

function updateNode(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "update_node" }>;
  agentflow: AgentFlowDoc;
  reachability: RunReachability;
  record: RunRecord;
}): RunGraphPatchRejectedOperation | undefined {
  const node = input.agentflow.nodes.find((candidate) => candidate.id === input.operation.nodeId);
  if (!node) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Node "${input.operation.nodeId}" does not exist.`, { nodeId: input.operation.nodeId });
  const editClass = input.reachability.nodes[node.id] ?? "inactive";
  if (!EDITABLE_NODE_CLASSES.has(editClass)) {
    return reject(input, "SNAPSHOT_EDIT_UNREACHABLE_NODE", `Node "${node.id}" is ${editClass} and cannot be edited for this run.`, { nodeId: node.id });
  }
  const patch = input.operation.patch as Partial<AgentFlowNode> & { id?: string; kind?: string };
  if (patch.id && patch.id !== node.id) {
    return reject(input, "SNAPSHOT_EDIT_CURRENT_NODE_ID_UNSUPPORTED", "Runtime graph patch cannot change node ids.", { nodeId: node.id });
  }
  if (patch.kind && patch.kind !== node.kind) {
    return reject(input, "SNAPSHOT_EDIT_NODE_KIND_UNSUPPORTED", "Runtime graph patch cannot change node kind.", { nodeId: node.id });
  }
  assignPatch(node, withoutKeys(patch, ["id", "kind"]));
  return undefined;
}

function updateEdge(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "update_edge" }>;
  agentflow: AgentFlowDoc;
  reachability: RunReachability;
}): RunGraphPatchRejectedOperation | undefined {
  const edge = input.agentflow.edges.find((candidate) => candidate.id === input.operation.edgeId);
  if (!edge) return reject(input, "SNAPSHOT_EDIT_EDGE_NOT_FOUND", `Edge "${input.operation.edgeId}" does not exist.`, { edgeId: input.operation.edgeId });
  if (input.operation.patch.from || input.operation.patch.to) {
    return reject(input, "SNAPSHOT_EDIT_USE_REPLACE_EDGE_ENDPOINT", "Use replace_edge_endpoint to change edge endpoints.", { edgeId: edge.id });
  }
  const fromClass = input.reachability.nodes[edge.from] ?? "inactive";
  const toClass = input.reachability.nodes[edge.to] ?? "inactive";
  if (!EDITABLE_NODE_CLASSES.has(fromClass) && !EDITABLE_NODE_CLASSES.has(toClass)) {
    return reject(input, "SNAPSHOT_EDIT_UNREACHABLE_EDGE", `Edge "${edge.id}" is not on a reachable future path for this run.`, { edgeId: edge.id });
  }
  assignPatch(edge, withoutKeys(input.operation.patch, ["id", "from", "to"]));
  return undefined;
}

function updateNodeLayout(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "update_node_layout" }>;
  agentflow: AgentFlowDoc;
  layout: CanvasLayoutDoc;
  reachability: RunReachability;
}): RunGraphPatchRejectedOperation | undefined {
  const node = input.agentflow.nodes.find((candidate) => candidate.id === input.operation.nodeId);
  if (!node) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Node "${input.operation.nodeId}" does not exist.`, { nodeId: input.operation.nodeId });
  const editClass = input.reachability.nodes[node.id] ?? "inactive";
  if (!EDITABLE_NODE_CLASSES.has(editClass)) {
    return reject(input, "SNAPSHOT_EDIT_UNREACHABLE_NODE", `Node "${node.id}" is ${editClass} and cannot be edited for this run.`, { nodeId: node.id });
  }
  const existing = input.layout.nodes.find((entry) => entry.nodeId === node.id);
  upsertLayout(input.layout, {
    nodeId: node.id,
    x: finiteNumber(input.operation.position.x) ?? existing?.x ?? 0,
    y: finiteNumber(input.operation.position.y) ?? existing?.y ?? 0,
    w: finiteNumber(input.operation.position.w) ?? existing?.w ?? 220,
  });
  return undefined;
}

function addNode(
  input: {
    index: number;
    operation: RunGraphOperation;
    agentflow: AgentFlowDoc;
    layout: CanvasLayoutDoc;
  },
  node: AgentFlowNode,
  position?: Partial<CanvasNodeLayout>,
): RunGraphPatchRejectedOperation | undefined {
  if (input.agentflow.nodes.some((candidate) => candidate.id === node.id)) {
    return reject(input, "SNAPSHOT_EDIT_NODE_ALREADY_EXISTS", `Node "${node.id}" already exists.`, { nodeId: node.id });
  }
  input.agentflow.nodes.push(cloneJson(node));
  upsertLayout(input.layout, {
    nodeId: node.id,
    x: finiteNumber(position?.x) ?? 0,
    y: finiteNumber(position?.y) ?? 0,
    w: finiteNumber(position?.w) ?? 220,
  });
  return undefined;
}

function removeNode(input: {
  index: number;
  operation: RunGraphOperation;
  agentflow: AgentFlowDoc;
  layout: CanvasLayoutDoc;
  reachability: RunReachability;
}, nodeId: string): RunGraphPatchRejectedOperation | undefined {
  const node = input.agentflow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Node "${nodeId}" does not exist.`, { nodeId });
  const editClass = input.reachability.nodes[nodeId] ?? "inactive";
  if (editClass === "current") {
    return reject(input, "SNAPSHOT_EDIT_REQUIRED_NODE_REMOVED", `Current node "${nodeId}" cannot be removed from an active run.`, { nodeId });
  }
  if (!FUTURE_NODE_CLASSES.has(editClass)) {
    return reject(input, "SNAPSHOT_EDIT_HISTORY_REWRITE_UNSUPPORTED", `Node "${nodeId}" is ${editClass} and cannot be removed for this run.`, { nodeId });
  }
  input.agentflow.nodes = input.agentflow.nodes.filter((candidate) => candidate.id !== nodeId);
  input.agentflow.edges = input.agentflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  input.layout.nodes = input.layout.nodes.filter((entry) => entry.nodeId !== nodeId);
  return undefined;
}

function addEdge(input: {
  index: number;
  operation: RunGraphOperation;
  agentflow: AgentFlowDoc;
  reachability: RunReachability;
}): RunGraphPatchRejectedOperation | undefined {
  const edge = (input.operation as Extract<RunGraphOperation, { op: "add_edge" }>).edge;
  if (input.agentflow.edges.some((candidate) => candidate.id === edge.id)) {
    return reject(input, "SNAPSHOT_EDIT_EDGE_ALREADY_EXISTS", `Edge "${edge.id}" already exists.`, { edgeId: edge.id });
  }
  const endpointError = validateEdgeEndpoints(input, edge);
  if (endpointError) return endpointError;
  input.agentflow.edges.push(cloneJson(edge));
  return undefined;
}

function removeEdge(input: {
  index: number;
  operation: RunGraphOperation;
  agentflow: AgentFlowDoc;
  reachability: RunReachability;
}, edgeId: string): RunGraphPatchRejectedOperation | undefined {
  const edge = input.agentflow.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return reject(input, "SNAPSHOT_EDIT_EDGE_NOT_FOUND", `Edge "${edgeId}" does not exist.`, { edgeId });
  const fromClass = input.reachability.nodes[edge.from] ?? "inactive";
  const toClass = input.reachability.nodes[edge.to] ?? "inactive";
  if (!EDITABLE_NODE_CLASSES.has(fromClass) && !EDITABLE_NODE_CLASSES.has(toClass)) {
    return reject(input, "SNAPSHOT_EDIT_UNREACHABLE_EDGE", `Edge "${edgeId}" is not on a reachable future path for this run.`, { edgeId });
  }
  input.agentflow.edges = input.agentflow.edges.filter((candidate) => candidate.id !== edgeId);
  return undefined;
}

function replaceEdgeEndpoint(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "replace_edge_endpoint" }>;
  agentflow: AgentFlowDoc;
  reachability: RunReachability;
}): RunGraphPatchRejectedOperation | undefined {
  const edge = input.agentflow.edges.find((candidate) => candidate.id === input.operation.edgeId);
  if (!edge) return reject(input, "SNAPSHOT_EDIT_EDGE_NOT_FOUND", `Edge "${input.operation.edgeId}" does not exist.`, { edgeId: input.operation.edgeId });
  const nextEdge = { ...edge, from: input.operation.from ?? edge.from, to: input.operation.to ?? edge.to };
  const endpointError = validateEdgeEndpoints(input, nextEdge);
  if (endpointError) return endpointError;
  edge.from = nextEdge.from;
  edge.to = nextEdge.to;
  return undefined;
}

function addSession(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "add_session" }>;
  agentflow: AgentFlowDoc;
}): RunGraphPatchRejectedOperation | undefined {
  if (input.agentflow.sessions.some((session) => session.id === input.operation.session.id)) {
    return reject(input, "SNAPSHOT_EDIT_SESSION_ALREADY_EXISTS", `Session "${input.operation.session.id}" already exists.`, { });
  }
  input.agentflow.sessions.push(cloneJson(input.operation.session));
  return undefined;
}

function updateSession(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "update_session" }>;
  agentflow: AgentFlowDoc;
  reachability: RunReachability;
}): RunGraphPatchRejectedOperation | undefined {
  const session = input.agentflow.sessions.find((candidate) => candidate.id === input.operation.sessionId);
  if (!session) return reject(input, "SNAPSHOT_EDIT_SESSION_NOT_FOUND", `Session "${input.operation.sessionId}" does not exist.`);
  const referencedByEditableNode = input.agentflow.nodes.some((node) =>
    node.kind === "step"
    && node.sessionId === input.operation.sessionId
    && EDITABLE_NODE_CLASSES.has(input.reachability.nodes[node.id] ?? "inactive")
  );
  if (!referencedByEditableNode) {
    return reject(input, "SNAPSHOT_EDIT_UNREACHABLE_SESSION", `Session "${input.operation.sessionId}" is not referenced by an editable node in this run.`);
  }
  assignPatch(session, withoutKeys(input.operation.patch, ["id"]));
  return undefined;
}

function removeSession(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "remove_session" }>;
  agentflow: AgentFlowDoc;
}): RunGraphPatchRejectedOperation | undefined {
  if (input.agentflow.nodes.some((node) => node.kind === "step" && node.sessionId === input.operation.sessionId)) {
    return reject(input, "SNAPSHOT_EDIT_SESSION_IN_USE", `Session "${input.operation.sessionId}" is still referenced by nodes.`);
  }
  input.agentflow.sessions = input.agentflow.sessions.filter((session) => session.id !== input.operation.sessionId);
  return undefined;
}

function addVariable(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "add_variable" }>;
  agentflow: AgentFlowDoc;
}): RunGraphPatchRejectedOperation | undefined {
  const variables = input.agentflow.variables ?? [];
  if (variables.some((variable) => variable.name === input.operation.variable.name)) {
    return reject(input, "SNAPSHOT_EDIT_VARIABLE_ALREADY_EXISTS", `Variable "${input.operation.variable.name}" already exists.`);
  }
  input.agentflow.variables = [...variables, cloneJson(input.operation.variable)];
  return undefined;
}

function updateVariable(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "update_variable" }>;
  agentflow: AgentFlowDoc;
}): RunGraphPatchRejectedOperation | undefined {
  const variable = input.agentflow.variables?.find((candidate) => candidate.name === input.operation.name);
  if (!variable) return reject(input, "SNAPSHOT_EDIT_VARIABLE_NOT_FOUND", `Variable "${input.operation.name}" does not exist.`);
  assignPatch(variable, withoutKeys(input.operation.patch, ["name"]));
  return undefined;
}

function removeVariable(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "remove_variable" }>;
  agentflow: AgentFlowDoc;
}): RunGraphPatchRejectedOperation | undefined {
  input.agentflow.variables = (input.agentflow.variables ?? []).filter((variable) => variable.name !== input.operation.name);
  return undefined;
}

function insertNodeBetween(input: {
  index: number;
  operation: Extract<RunGraphOperation, { op: "insert_node_between" }>;
  agentflow: AgentFlowDoc;
  layout: CanvasLayoutDoc;
  reachability: RunReachability;
  record: RunRecord;
}): RunGraphPatchRejectedOperation | undefined {
  const { sourceNodeId, targetNodeId, node } = input.operation;
  const source = input.agentflow.nodes.find((candidate) => candidate.id === sourceNodeId);
  const target = input.agentflow.nodes.find((candidate) => candidate.id === targetNodeId);
  if (!source) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Source node "${sourceNodeId}" does not exist.`, { nodeId: sourceNodeId });
  if (!target) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Target node "${targetNodeId}" does not exist.`, { nodeId: targetNodeId });
  const sourceClass = input.reachability.nodes[sourceNodeId] ?? "inactive";
  const targetClass = input.reachability.nodes[targetNodeId] ?? "inactive";
  if (!EDITABLE_NODE_CLASSES.has(sourceClass) && !EDITABLE_NODE_CLASSES.has(targetClass)) {
    return reject(input, "SNAPSHOT_EDIT_OPERATION_NOT_MIGRATABLE", `Cannot insert between ${sourceClass} source and ${targetClass} target.`, { nodeId: node.id });
  }
  const existingEdge = input.agentflow.edges.find((edge) => edge.from === sourceNodeId && edge.to === targetNodeId);
  const addError = addNode(input, node, input.operation.position ?? midpointLayout(input.layout, sourceNodeId, targetNodeId, node.id));
  if (addError) return addError;
  if (existingEdge) input.agentflow.edges = input.agentflow.edges.filter((edge) => edge.id !== existingEdge.id);
  const incomingEdge = {
    ...(existingEdge ? cloneJson(existingEdge) : { id: `${sourceNodeId}__${node.id}`, from: sourceNodeId, to: node.id }),
    ...input.operation.incomingEdge,
    from: sourceNodeId,
    to: node.id,
  };
  const outgoingEdge = {
    id: `${node.id}__${targetNodeId}`,
    ...(input.operation.outgoingEdge ?? {}),
    from: node.id,
    to: targetNodeId,
  };
  input.agentflow.edges.push(incomingEdge, outgoingEdge);
  return undefined;
}

function validateEdgeEndpoints(
  input: {
    index: number;
    operation: RunGraphOperation;
    agentflow: AgentFlowDoc;
    reachability: RunReachability;
  },
  edge: CanvasEdge,
): RunGraphPatchRejectedOperation | undefined {
  const nodeIds = new Set(input.agentflow.nodes.map((node) => node.id));
  if (!nodeIds.has(edge.from)) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Edge source "${edge.from}" does not exist.`, { edgeId: edge.id });
  if (!nodeIds.has(edge.to)) return reject(input, "SNAPSHOT_EDIT_NODE_NOT_FOUND", `Edge target "${edge.to}" does not exist.`, { edgeId: edge.id });
  const fromClass = input.reachability.nodes[edge.from] ?? "future";
  const toClass = input.reachability.nodes[edge.to] ?? "future";
  if (fromClass === "history_only" || toClass === "history_only") {
    return reject(input, "SNAPSHOT_EDIT_HISTORY_REWRITE_UNSUPPORTED", `Edge "${edge.id}" cannot rewrite history_only nodes.`, { edgeId: edge.id });
  }
  return undefined;
}

function rebuildFutureSchedulingFromCheckpoint(
  checkpoint: WorkflowExecutionCheckpoint,
  preview: RunGraphMigrationPreview,
): WorkflowExecutionCheckpoint {
  const discardedFutureQueueEntries = checkpoint.queue.map((entry) => ({ nodeId: entry.nodeId, traversal: entry.traversal }));
  const preservedInputKeys = new Set<string>();
  const nextPendingInputs: WorkflowExecutionCheckpoint["pendingInputs"] = {};
  const rebuiltQueueEntries: WorkflowExecutionCheckpoint["queue"] = [];
  if (checkpoint.interruptedNodeId && checkpoint.interruptedExecutionKey) {
    const interruptedInput = checkpoint.pendingInputs[checkpoint.interruptedExecutionKey];
    if (interruptedInput) {
      nextPendingInputs[checkpoint.interruptedExecutionKey] = interruptedInput;
      preservedInputKeys.add(checkpoint.interruptedExecutionKey);
    }
    rebuiltQueueEntries.push({
      nodeId: checkpoint.interruptedNodeId,
      traversal: parseTraversalFromExecutionKey(checkpoint.interruptedExecutionKey),
    });
  }
  preview.queueRebuild = {
    discardedFutureQueueEntries,
    rebuiltQueueEntries: rebuiltQueueEntries.map((entry) => ({ nodeId: entry.nodeId, traversal: entry.traversal })),
    frontier: checkpoint.pendingCompletion?.nodeId
      ? [checkpoint.pendingCompletion.nodeId]
      : checkpoint.interruptedNodeId
        ? [checkpoint.interruptedNodeId]
        : [],
  };
  preview.pendingInputRebuild = {
    discardedFutureInputKeys: Object.keys(checkpoint.pendingInputs).filter((key) => !preservedInputKeys.has(key)),
    preservedInputKeys: [...preservedInputKeys],
  };
  return {
    ...checkpoint,
    queue: rebuiltQueueEntries,
    pendingInputs: nextPendingInputs,
    createdAt: new Date().toISOString(),
  };
}

function parseCheckpoint(value: Record<string, unknown> | undefined): WorkflowExecutionCheckpoint | undefined {
  if (!value || !Array.isArray(value.queue) || !value.pendingInputs || typeof value.pendingInputs !== "object") return undefined;
  return cloneJson(value) as unknown as WorkflowExecutionCheckpoint;
}

function reject(
  input: { index: number; operation: RunGraphOperation },
  code: string,
  message: string,
  extra: { nodeId?: string; edgeId?: string } = {},
): RunGraphPatchRejectedOperation {
  return { index: input.index, op: input.operation.op, code, message, ...extra };
}

function upsertLayout(layout: CanvasLayoutDoc, entry: CanvasNodeLayout): void {
  const existing = layout.nodes.find((candidate) => candidate.nodeId === entry.nodeId);
  if (existing) Object.assign(existing, entry);
  else layout.nodes.push(entry);
}

function midpointLayout(
  layout: CanvasLayoutDoc,
  sourceNodeId: string,
  targetNodeId: string,
  nodeId: string,
): CanvasNodeLayout {
  const source = layout.nodes.find((entry) => entry.nodeId === sourceNodeId);
  const target = layout.nodes.find((entry) => entry.nodeId === targetNodeId);
  if (!source || !target) return { nodeId, x: 0, y: 0, w: 220 };
  return {
    nodeId,
    x: Math.round((source.x + target.x) / 2),
    y: Math.round((source.y + target.y) / 2),
    w: 220,
  };
}

function mergeEdgeChanges(
  current: RunGraphMigrationPreview["edgeReachabilityChanges"],
  before: Set<string>,
  after: Set<string>,
): RunGraphMigrationPreview["edgeReachabilityChanges"] {
  return {
    removedEdgeIds: unique([...(current?.removedEdgeIds ?? []), ...[...before].filter((id) => !after.has(id))]),
    addedEdgeIds: unique([...(current?.addedEdgeIds ?? []), ...[...after].filter((id) => !before.has(id))]),
  };
}

function newNodeStateChanges(record: RunRecord, before: Set<string>, after: Set<string>): Array<{ nodeId: string; from?: string; to?: string }> {
  const added = [...after]
    .filter((nodeId) => !before.has(nodeId))
    .map((nodeId) => ({ nodeId, from: undefined, to: record.nodeStates[nodeId] ?? "pending" }));
  const removed = [...before]
    .filter((nodeId) => !after.has(nodeId) && record.nodeStates[nodeId] !== "success")
    .map((nodeId) => ({ nodeId, from: record.nodeStates[nodeId], to: undefined }));
  return [...added, ...removed];
}

function parseTraversalFromExecutionKey(key: string): number {
  const match = key.match(/:(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function withoutKeys(value: object, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.includes(key)) result[key] = entry;
  }
  return result;
}

function assignPatch(target: object, patch: Record<string, unknown>): void {
  const writable = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete writable[key];
    else writable[key] = value;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
