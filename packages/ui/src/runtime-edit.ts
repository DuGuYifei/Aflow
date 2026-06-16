import type { Edge, RuntimeEditClass } from './types';

export function runtimeClassCanEdit(editClass: RuntimeEditClass | undefined): boolean {
  return editClass === 'current' || editClass === 'future' || editClass === 'history_future';
}

export function runtimeClassCanDelete(editClass: RuntimeEditClass | undefined): boolean {
  return editClass === 'future' || editClass === 'history_future';
}

export function runtimeEdgeCanEdit(edge: Edge | undefined, nodeClasses: Record<string, RuntimeEditClass> | undefined): boolean {
  if (!edge || !nodeClasses) return false;
  return runtimeClassCanEdit(nodeClasses[edge.from]) || runtimeClassCanEdit(nodeClasses[edge.to]);
}
