import type { Edge, Session, WorkflowNode } from './types';
import { createCanvasNodeCopy, createPastedNode, createPastedNodes } from './canvas-clipboard';

declare function describe(name: string, callback: () => void): void;
declare function test(name: string, callback: () => void): void;
declare const expect: (value: unknown) => {
  toBe(expected: unknown): void;
  not: { toBe(expected: unknown): void };
};

describe('canvas clipboard', () => {
  test('pastes a step with unique id, next alias, and target fallback session', () => {
    const sessions: Session[] = [{ id: 'target-session', name: 'target-session', agentServerId: 'codex-acp' }];
    const existingNodes: WorkflowNode[] = [
      stepNode('step', '01', 'target-session'),
      stepNode('step-copy', '02', 'target-session'),
    ];
    const copiedNode = stepNode('step', '01', 'source-session');

    const pasted = createPastedNode({
      copiedNode,
      existingNodes,
      sessions,
      position: { x: 500, y: 400 },
    });

    expect(pasted.kind).toBe('step');
    expect(pasted.id).toBe('step-copy-2');
    expect(pasted.alias).toBe('03');
    expect(pasted.x).toBe(390);
    expect(pasted.y).toBe(340);
    if (pasted.kind !== 'step') throw new Error('expected step node');
    expect(pasted.sessionId).toBe('target-session');
  });

  test('keeps a step session when the target flow has that session', () => {
    const sessions: Session[] = [{ id: 'shared-session', name: 'shared-session', agentServerId: 'codex-acp' }];

    const pasted = createPastedNode({
      copiedNode: stepNode('step', '01', 'shared-session'),
      existingNodes: [],
      sessions,
      position: { x: 500, y: 400 },
    });

    if (pasted.kind !== 'step') throw new Error('expected step node');
    expect(pasted.sessionId).toBe('shared-session');
  });

  test('pastes an input with a unique variable name', () => {
    const existingNodes: WorkflowNode[] = [
      inputNode('input-a', 'specflow_var'),
      inputNode('input-b', 'specflow_var_2'),
    ];

    const pasted = createPastedNode({
      copiedNode: inputNode('input-a', 'specflow_var'),
      existingNodes,
      sessions: [],
      position: { x: 300, y: 200 },
    });

    expect(pasted.kind).toBe('input');
    if (pasted.kind !== 'input') throw new Error('expected input node');
    expect(pasted.variableName).toBe('specflow_var_3');
  });

  test('copies a node into an isolated cross-flow buffer payload', () => {
    const source = stepNode('step', '01', 'source-session');
    const copied = createCanvasNodeCopy({ sourceWorkflowId: 'source-flow', nodes: [source] });

    source.title = 'changed after copy';

    expect(copied.version).toBe(1);
    expect(copied.sourceWorkflowId).toBe('source-flow');
    expect(copied.nodes[0]!.title).toBe('Step step');
    expect(copied.nodes[0] === source).toBe(false);
  });

  test('copies and pastes multiple nodes with internal edges', () => {
    const sourceNodes: WorkflowNode[] = [
      stepNode('a', '01', 'main'),
      stepNode('b', '02', 'main', 420, 160),
      stepNode('outside', '03', 'main', 900, 160),
    ];
    const sourceEdges: Edge[] = [
      { id: 'edge:a:->b', from: 'a', to: 'b', transmit: true, outputTag: 'answer' },
      { id: 'edge:b:->outside', from: 'b', to: 'outside' },
    ];
    const copied = createCanvasNodeCopy({
      sourceWorkflowId: 'source-flow',
      nodes: sourceNodes.slice(0, 2),
      edges: sourceEdges,
    });

    const pasted = createPastedNodes({
      copiedNodes: copied.nodes,
      copiedEdges: copied.edges,
      existingNodes: [],
      existingEdges: [],
      sessions: [{ id: 'main', name: 'main', agentServerId: 'codex-acp' }],
      position: { x: 600, y: 400 },
    });

    expect(pasted.nodes.length).toBe(2);
    expect(pasted.edges.length).toBe(1);
    expect(pasted.nodes[0]!.id).toBe('a-copy');
    expect(pasted.nodes[1]!.id).toBe('b-copy');
    expect(pasted.edges[0]!.id).toBe('edge:a-copy:->b-copy');
    expect(pasted.edges[0]!.outputTag).toBe('answer');
  });
});

function stepNode(id: string, alias: string, sessionId: string | null, x = 100, y = 100): Extract<WorkflowNode, { kind: 'step' }> {
  return {
    kind: 'step',
    id,
    alias,
    x,
    y,
    w: 220,
    title: `Step ${id}`,
    prompt: 'Run the step',
    sessionId,
  };
}

function inputNode(id: string, variableName: string): Extract<WorkflowNode, { kind: 'input' }> {
  return {
    kind: 'input',
    id,
    alias: 'IN',
    x: 100,
    y: 100,
    w: 200,
    title: 'Run input',
    variableName,
    sessionId: null,
  };
}
