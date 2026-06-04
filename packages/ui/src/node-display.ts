import type { WorkflowNode } from './types';

export function nodeTitleFallback(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nodeDisplayTitle(node: Pick<WorkflowNode, 'id' | 'title'>): string {
  const title = node.title.trim();
  return title || nodeTitleFallback(node.id) || node.id;
}

export function nodeTitleIsFallback(node: Pick<WorkflowNode, 'title'>): boolean {
  return node.title.trim().length === 0;
}
