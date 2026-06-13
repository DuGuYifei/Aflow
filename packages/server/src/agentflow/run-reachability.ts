import type { AgentFlowDoc, AgentFlowNode, CanvasEdge } from "./canvas-doc";
import type { RunRecord, RunState } from "./run-store";

export type RuntimeEditClass = "current" | "future" | "history_future" | "history_only" | "inactive";

export interface RunReachability {
  nodes: Record<string, RuntimeEditClass>;
  currentNodeIds: string[];
  futureNodeIds: string[];
  completedNodeIds: string[];
}

interface CheckpointShape {
  queue?: Array<{ nodeId?: unknown }>;
  activeNodeId?: unknown;
  interruptedNodeId?: unknown;
  completedNodeIds?: unknown;
  inactiveEdgeIds?: unknown;
  branchTraversals?: unknown;
}

export function computeRunReachability(record: RunRecord): RunReachability {
  const checkpoint = (record.checkpoint ?? {}) as CheckpointShape;
  const currentNodeIds = compactStrings([checkpoint.activeNodeId, checkpoint.interruptedNodeId]);
  const frontier = new Set<string>([
    ...currentNodeIds,
    ...(Array.isArray(checkpoint.queue)
      ? checkpoint.queue.map((entry) => typeof entry.nodeId === "string" ? entry.nodeId : undefined).filter(isString)
      : []),
  ]);
  const completedNodeIds = new Set<string>([
    ...Object.entries(record.nodeStates ?? {})
      .filter(([, state]) => isCompletedState(state))
      .map(([nodeId]) => nodeId),
    ...(Array.isArray(checkpoint.completedNodeIds) ? checkpoint.completedNodeIds.filter(isString) : []),
  ]);
  const inactiveEdgeIds = new Set(Array.isArray(checkpoint.inactiveEdgeIds) ? checkpoint.inactiveEdgeIds.filter(isString) : []);
  const branchTraversals = parseBranchTraversals(checkpoint.branchTraversals);
  const futureNodeIds = reachableFrom(record.agentflowSnapshot, frontier, inactiveEdgeIds, branchTraversals);

  const classes: Record<string, RuntimeEditClass> = {};
  for (const node of record.agentflowSnapshot.nodes) {
    if (currentNodeIds.includes(node.id)) {
      classes[node.id] = "current";
    } else if (futureNodeIds.has(node.id) && completedNodeIds.has(node.id)) {
      classes[node.id] = "history_future";
    } else if (futureNodeIds.has(node.id)) {
      classes[node.id] = "future";
    } else if (completedNodeIds.has(node.id)) {
      classes[node.id] = "history_only";
    } else {
      classes[node.id] = "inactive";
    }
  }

  return {
    nodes: classes,
    currentNodeIds,
    futureNodeIds: [...futureNodeIds],
    completedNodeIds: [...completedNodeIds],
  };
}

function reachableFrom(
  agentflow: AgentFlowDoc,
  frontier: Set<string>,
  inactiveEdgeIds: Set<string>,
  branchTraversals: Map<string, number>,
): Set<string> {
  const nodesById = new Map(agentflow.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, CanvasEdge[]>();
  for (const edge of agentflow.edges) {
    if (inactiveEdgeIds.has(edge.id)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  const seen = new Set<string>();
  const queue = [...frontier];
  for (;;) {
    const nodeId = queue.shift();
    if (!nodeId) break;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) continue;
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (!edgeIsAvailable(node, edge, branchTraversals)) continue;
      if (!seen.has(edge.to)) queue.push(edge.to);
    }
  }
  return seen;
}

function edgeIsAvailable(node: AgentFlowNode, edge: CanvasEdge, branchTraversals: Map<string, number>): boolean {
  if (node.kind !== "gate" || !edge.branch) return true;
  const branch = node.branches.find((candidate) => candidate.id === edge.branch);
  const maxTraversals = branch?.maxTraversals;
  if (!maxTraversals || maxTraversals < 1) return true;
  return (branchTraversals.get(`${node.id}:${branch.id}`) ?? 0) < maxTraversals;
}

function parseBranchTraversals(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, rawCount] of Object.entries(value)) {
    if (typeof rawCount === "number" && Number.isFinite(rawCount)) {
      result.set(key, rawCount);
    }
  }
  return result;
}

function compactStrings(values: unknown[]): string[] {
  return values.filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCompletedState(state: RunState): boolean {
  return state === "success";
}
