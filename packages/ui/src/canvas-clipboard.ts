import { edgeKey, nextSymbolKey } from './appearance';
import type { Edge, Session, WorkflowNode } from './types';

export interface CanvasNodeCopy {
  version: 1;
  sourceWorkflowId: string;
  nodes: WorkflowNode[];
  edges: Edge[];
}

export interface CanvasPastePosition {
  x: number;
  y: number;
}

export interface CanvasPasteResult {
  nodes: WorkflowNode[];
  edges: Edge[];
}

export const CANVAS_PASTE_OFFSET = 24;

const NODE_HEIGHT: Record<WorkflowNode['kind'], number> = {
  step: 120,
  gate: 110,
  end: 36,
  input: 72,
};

export function createCanvasNodeCopy(input: {
  sourceWorkflowId: string;
  nodes: WorkflowNode[];
  edges?: Edge[];
}): CanvasNodeCopy {
  const copiedNodes = input.nodes.map(cloneNode);
  const copiedNodeIds = new Set(copiedNodes.map((node) => node.id));
  return {
    version: 1,
    sourceWorkflowId: input.sourceWorkflowId,
    nodes: copiedNodes,
    edges: (input.edges ?? [])
      .filter((edge) => copiedNodeIds.has(edge.from) && copiedNodeIds.has(edge.to))
      .map((edge) => ({ ...edge })),
  };
}

export function createPastedNode(input: {
  copiedNode: WorkflowNode;
  existingNodes: WorkflowNode[];
  sessions: Session[];
  position: CanvasPastePosition;
  pasteIndex?: number;
}): WorkflowNode {
  return createPastedNodes({
    copiedNodes: [input.copiedNode],
    copiedEdges: [],
    existingNodes: input.existingNodes,
    existingEdges: [],
    sessions: input.sessions,
    position: input.position,
    pasteIndex: input.pasteIndex,
  }).nodes[0]!;
}

export function createPastedNodes(input: {
  copiedNodes: WorkflowNode[];
  copiedEdges?: Edge[];
  existingNodes: WorkflowNode[];
  existingEdges: Edge[];
  sessions: Session[];
  position: CanvasPastePosition;
  pasteIndex?: number;
}): CanvasPasteResult {
  const { copiedNodes, existingNodes, existingEdges, sessions, position, pasteIndex = 0 } = input;
  if (copiedNodes.length === 0) return { nodes: [], edges: [] };

  const sourceBounds = nodeBounds(copiedNodes);
  const offsetX = position.x - (sourceBounds.minX + sourceBounds.width / 2) + pasteIndex * CANVAS_PASTE_OFFSET;
  const offsetY = position.y - (sourceBounds.minY + sourceBounds.height / 2) + pasteIndex * CANVAS_PASTE_OFFSET;
  const idMap = new Map<string, string>();
  let workingNodes = [...existingNodes];

  const nodes = copiedNodes.map((copiedNode) => {
    const id = nextSymbolKey(`${copiedNode.id}-copy`, workingNodes.map((node) => node.id));
    idMap.set(copiedNode.id, id);
    const pasted = cloneNodeForPaste(copiedNode, {
      id,
      x: copiedNode.x + offsetX,
      y: copiedNode.y + offsetY,
      existingNodes: workingNodes,
      sessions,
    });
    workingNodes = [...workingNodes, pasted];
    return pasted;
  });

  const pastedEdges = (input.copiedEdges ?? [])
    .map((edge) => {
      const from = idMap.get(edge.from);
      const to = idMap.get(edge.to);
      if (!from || !to) return null;
      return {
        ...edge,
        id: edgeKey({ from, to, branch: edge.branch }),
        from,
        to,
      };
    })
    .filter((edge): edge is Edge => Boolean(edge))
    .filter((edge) => !existingEdges.some((existingEdge) => existingEdge.id === edge.id));

  return { nodes, edges: pastedEdges };
}

export function nodeBounds(nodes: WorkflowNode[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT[node.kind]);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function nodeHeight(kind: WorkflowNode['kind']): number {
  return NODE_HEIGHT[kind];
}

function cloneNodeForPaste(node: WorkflowNode, input: {
  id: string;
  x: number;
  y: number;
  existingNodes: WorkflowNode[];
  sessions: Session[];
}): WorkflowNode {
  if (node.kind === 'step') {
    return {
      kind: 'step',
      id: input.id,
      alias: nextStepAlias(input.existingNodes),
      x: input.x,
      y: input.y,
      w: node.w,
      title: node.title,
      prompt: node.prompt,
      sessionId: targetSessionId(node.sessionId, input.sessions),
      pauseAfterRun: node.pauseAfterRun,
      images: node.images?.map((image) => ({ ...image })),
      paths: node.paths ? [...node.paths] : undefined,
      modeId: node.modeId,
      configOptions: node.configOptions ? { ...node.configOptions } : undefined,
    };
  }

  if (node.kind === 'gate') {
    return {
      kind: 'gate',
      id: input.id,
      alias: nextGateAlias(input.existingNodes),
      x: input.x,
      y: input.y,
      w: node.w,
      title: node.title,
      decisionCriteria: node.decisionCriteria,
      branches: node.branches.map((branch) => ({ ...branch })),
      configOptions: node.configOptions ? { ...node.configOptions } : undefined,
    };
  }

  if (node.kind === 'input') {
    return {
      kind: 'input',
      id: input.id,
      alias: 'IN',
      x: input.x,
      y: input.y,
      w: node.w,
      title: node.title,
      variableName: uniqueInputVariableName(node.variableName, input.existingNodes),
      required: node.required,
      defaultValue: node.defaultValue,
      description: node.description,
      sessionId: null,
    };
  }

  return {
    kind: 'end',
    id: input.id,
    alias: 'END',
    x: input.x,
    y: input.y,
    w: node.w,
    title: node.title,
    sessionId: null,
  };
}

function cloneNode(node: WorkflowNode): WorkflowNode {
  if (node.kind === 'step') {
    return {
      ...node,
      images: node.images?.map((image) => ({ ...image })),
      paths: node.paths ? [...node.paths] : undefined,
      configOptions: node.configOptions ? { ...node.configOptions } : undefined,
    };
  }
  if (node.kind === 'gate') {
    return {
      ...node,
      branches: node.branches.map((branch) => ({ ...branch })),
      configOptions: node.configOptions ? { ...node.configOptions } : undefined,
    };
  }
  return { ...node };
}

function nextStepAlias(existingNodes: WorkflowNode[]): string {
  return String(existingNodes.filter((node) => node.kind === 'step').length + 1).padStart(2, '0');
}

function nextGateAlias(existingNodes: WorkflowNode[]): string {
  return `G${existingNodes.filter((node) => node.kind === 'gate').length + 1}`;
}

function targetSessionId(sourceSessionId: string | null, sessions: Session[]): string | null {
  if (sourceSessionId && sessions.some((session) => session.id === sourceSessionId)) return sourceSessionId;
  return sessions[0]?.id ?? null;
}

function uniqueInputVariableName(baseName: string, existingNodes: WorkflowNode[]): string {
  const used = new Set(
    existingNodes
      .filter((node): node is Extract<WorkflowNode, { kind: 'input' }> => node.kind === 'input')
      .map((node) => node.variableName),
  );
  if (!used.has(baseName)) return baseName;
  let suffix = 2;
  while (used.has(`${baseName}_${suffix}`)) suffix += 1;
  return `${baseName}_${suffix}`;
}
