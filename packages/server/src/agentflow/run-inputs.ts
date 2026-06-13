import type { AgentFlowDoc } from "./canvas-doc";

export interface RunInputVariable {
  name: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  value: string;
  source: "override" | "default" | "missing";
}

export interface PreparedCanvasRun {
  doc: AgentFlowDoc;
  initialInput: string;
  variables: RunInputVariable[];
  effectiveValues: Record<string, string>;
  missingVariables: RunInputVariable[];
}

export function prepareCanvasRun(
  canvasDocument: AgentFlowDoc,
  input: {
    initialInput?: string;
    variableValues?: Record<string, string>;
  } = {},
): PreparedCanvasRun {
  const overrides = input.variableValues ?? {};
  const variables: RunInputVariable[] = [];
  const effectiveValues: Record<string, string> = {};
  const declaredVariables = canvasDocument.version === 2
    ? (canvasDocument.variables ?? [])
    : canvasDocument.nodes
      .filter((node) => node.kind === "input")
      .map((node) => ({
        name: node.variableName,
        required: node.required,
        defaultValue: node.defaultValue,
        description: node.description,
      }));

  for (const variable of declaredVariables) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, variable.name);
    const overrideValue = overrides[variable.name];
    const value = hasOverride ? overrideValue : variable.defaultValue ?? "";
    const required = variable.required !== false;
    const isMissing = required && value.trim() === "";
    const source = isMissing ? "missing" : hasOverride ? "override" : "default";

    effectiveValues[variable.name] = value;
    variables.push({
      name: variable.name,
      required,
      defaultValue: variable.defaultValue,
      description: variable.description,
      value,
      source,
    });
  }

  for (const [key, value] of Object.entries(overrides)) {
    effectiveValues[key] = value;
  }

  const tokenRx = /<(specflow_[A-Za-z0-9_]+)>/g;
  const substitute = (s: string | undefined) =>
    s?.replace(tokenRx, (orig, key: string) => (key in effectiveValues ? effectiveValues[key] : orig));

  const substitutedNodes = canvasDocument.nodes.map((node) => {
    if (node.kind === "step") return { ...node, prompt: substitute(node.prompt) ?? "" };
    if (node.kind === "gate") return { ...node, decisionCriteria: substitute(node.decisionCriteria) ?? "" };
    return node;
  });

  return {
    doc: { ...canvasDocument, nodes: substitutedNodes },
    initialInput: substitute(input.initialInput) ?? input.initialInput ?? "",
    variables,
    effectiveValues,
    missingVariables: variables.filter((variable) => variable.source === "missing"),
  };
}
