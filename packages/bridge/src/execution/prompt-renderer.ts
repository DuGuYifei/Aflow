import {
  renderPromptTemplate,
  wrapXmlTag,
  type GateNode,
  type PromptTemplate,
  type WorkflowEdge,
  type WorkflowNode,
} from "@specflow/workflow";

export interface PromptRenderContext {
  node: WorkflowNode;
  input: string;
  edgeValues: Record<string, string>;
}

export function renderNodePrompt(context: PromptRenderContext): string {
  return renderPromptTemplate({
    template: context.node.promptTemplate,
    variables: {
      specflow_input: context.input,
      ...context.edgeValues,
    },
  });
}

export function renderHandoffPrompt(template: PromptTemplate, input: string): string {
  const prompt = renderPromptTemplate({
    template,
    variables: {
      specflow_input: input,
    },
  });
  return [
    prompt,
    "",
    "The receiving workflow session cannot see this conversation history.",
    "Your response is the only handoff content it receives. Include all information needed by the receiving session in this response.",
    "Do not refer to a prior, previous, above, or preceding message instead of reproducing required content.",
  ].join("\n");
}

export function renderGatePrompt(node: GateNode, input: string): string {
  const criteria = renderPromptTemplate({
    template: node.promptTemplate,
    variables: { specflow_input: input },
  });
  const branches = JSON.stringify(node.branches.map((branch) => ({
    id: branch.id,
    label: branch.label,
    description: branch.description ?? "",
  })));
  return [
    "Select exactly one workflow branch based on the prior node output.",
    "",
    "Decision criteria:",
    criteria,
    "",
    "Prior node output:",
    `<specflow_input>${input}</specflow_input>`,
    "",
    `Available branches: ${branches}`,
    "",
    "Return exactly one complete JSON object matching this schema.",
    "The entire trimmed response must start with { and end with }.",
    "Do not include markdown fences, prefixes, suffixes, XML, code blocks, explanations, or any text outside the JSON object.",
    '{"branchId":"<one available branch id>","reason":"<short explanation>"}',
  ].join("\n");
}

export function renderGateRepairPrompt(node: GateNode, invalidOutput: string, error: string): string {
  const branches = JSON.stringify(node.branches.map((branch) => ({
    id: branch.id,
    label: branch.label,
    description: branch.description ?? "",
  })));
  return [
    "Your previous gate decision could not be used.",
    "",
    "Validation error:",
    error,
    "",
    "Previous response:",
    `<invalid_gate_response>${invalidOutput}</invalid_gate_response>`,
    "",
    `Available branches: ${branches}`,
    "",
    "Return exactly one complete JSON object matching this schema.",
    "The entire trimmed response must start with { and end with }.",
    "Do not include markdown fences, prefixes, suffixes, XML, code blocks, explanations, or any text outside the JSON object.",
    '{"branchId":"<one available branch id>","reason":"<short explanation>"}',
  ].join("\n");
}

export function createTaggedEdgeVariable(edge: WorkflowEdge, content: string): Record<string, string> {
  if (edge.kind !== "tagged-output") {
    return {};
  }

  return {
    [edge.outputTag.promptReference]: wrapXmlTag(edge.outputTag.xmlTagName, content),
  };
}
