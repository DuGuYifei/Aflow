import type { WorkflowDiagnostic, WorkflowDiagnosticSeverity } from './types';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const WORKFLOW_LIST_HIDDEN_CODES = new Set([
  'REQUIRED_VARIABLE_NEEDS_RUNTIME_VALUE',
]);

export function getWorkflowListDiagnostics(diagnostics: WorkflowDiagnostic[] | undefined): WorkflowDiagnostic[] {
  return (diagnostics ?? []).filter((diagnostic) => !WORKFLOW_LIST_HIDDEN_CODES.has(diagnostic.code));
}

export function formatWorkflowDiagnosticSeverity(severity: WorkflowDiagnosticSeverity, t: Translate): string {
  return t(`diagnostics.severity.${severity}`);
}

export function formatWorkflowDiagnostic(diagnostic: WorkflowDiagnostic, t: Translate): string {
  const key = `diagnostics.code.${diagnostic.code}`;
  const message = t(key, {
    code: diagnostic.code,
    node: diagnostic.nodeId ?? 'unknown',
    edge: diagnostic.edgeId ?? 'unknown',
    session: diagnostic.sessionId ?? 'unknown',
    variable: diagnostic.variableName ?? 'unknown',
  });
  return message === key ? diagnostic.message : message;
}
