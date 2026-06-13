import { describe, expect, it } from "bun:test";
import { prepareCanvasRun } from "./agentflow/run-inputs";
import type { AgentFlowDoc, AgentFlowStepNode } from "./agentflow/canvas-doc";

const canvasDocument: AgentFlowDoc = {
  id: "simple",
  name: "Simple",
  sessions: [{ id: "s1", name: "codex", agentServerId: "codex-acp" }],
  nodes: [
    {
      kind: "input",
      id: "in1",
      alias: "IN",
      title: "Value",
      variableName: "specflow_value",
      sessionId: null,
    },
    {
      kind: "step",
      id: "n1",
      alias: "01",
      title: "Add one",
      prompt: "1 + <specflow_value> = ?",
      sessionId: "s1",
    },
  ],
  edges: [{ id: "e-input", from: "in1", to: "n1" }],
};

describe("prepareCanvasRun", () => {
  it("reports missing input nodes without defaults", () => {
    const prepared = prepareCanvasRun(canvasDocument);
    expect(prepared.missingVariables.map((variable) => variable.name)).toEqual(["specflow_value"]);
    expect(findStep(prepared.doc, "n1").prompt).toBe("1 +  = ?");
  });

  it("substitutes provided variable values into step prompts", () => {
    const prepared = prepareCanvasRun(canvasDocument, { variableValues: { specflow_value: "1" } });
    expect(prepared.missingVariables).toHaveLength(0);
    expect(prepared.variables[0]).toMatchObject({
      name: "specflow_value",
      required: true,
      value: "1",
      source: "override",
    });
    expect(findStep(prepared.doc, "n1").prompt).toBe("1 + 1 = ?");
  });

  it("treats empty overrides as missing", () => {
    const prepared = prepareCanvasRun(canvasDocument, { variableValues: { specflow_value: "" } });
    expect(prepared.missingVariables.map((variable) => variable.name)).toEqual(["specflow_value"]);
  });

  it("allows optional inputs to stay empty", () => {
    const prepared = prepareCanvasRun({
      ...canvasDocument,
      nodes: canvasDocument.nodes.map((node) => (
        node.kind === "input" ? { ...node, required: false } : node
      )),
    });
    expect(prepared.missingVariables).toHaveLength(0);
    expect(prepared.variables[0]).toMatchObject({
      name: "specflow_value",
      required: false,
      value: "",
      source: "default",
    });
  });

  it("uses top-level v2 variables instead of input nodes", () => {
    const prepared = prepareCanvasRun({
      id: "v2-simple",
      version: 2,
      name: "V2 Simple",
      sessions: [{ id: "s1", name: "codex", agentServerId: "codex-acp" }],
      variables: [{ name: "specflow_value", required: true }],
      nodes: [
        { kind: "start", id: "start", alias: "START", title: "Start", sessionId: null },
        {
          kind: "step",
          id: "n1",
          alias: "01",
          title: "Add one",
          prompt: "1 + <specflow_value> = ?",
          sessionId: "s1",
        },
      ],
      edges: [{ id: "e-start", from: "start", to: "n1" }],
    }, { variableValues: { specflow_value: "2" } });
    expect(prepared.missingVariables).toHaveLength(0);
    expect(findStep(prepared.doc, "n1").prompt).toBe("1 + 2 = ?");
  });
});

function findStep(input: AgentFlowDoc, id: string): AgentFlowStepNode {
  const node = input.nodes.find((node): node is AgentFlowStepNode => node.kind === "step" && node.id === id);
  if (!node) throw new Error(`Missing step ${id}`);
  return node;
}
