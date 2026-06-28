import { describe, expect, test } from "bun:test";
import { normalizeVariableValues, parseRunArgs, parseValidateArgs } from "./specflow";
import { assertCliRunnableAgentFlow, type AgentFlowDoc } from "@specflow/server";

const canvasDocument: AgentFlowDoc = {
  id: "flow",
  version: 2,
  name: "Flow",
  sessions: [{ id: "s1", name: "main", agentServerId: "echo-headless" }],
  variables: [
    { name: "specflow_task", title: "Task", required: true },
    { name: "specflow_audience", title: "Audience", required: false },
  ],
  nodes: [
    {
      kind: "start",
      id: "start",
      alias: "START",
      title: "Start",
      sessionId: null,
    },
    {
      kind: "step",
      id: "work",
      alias: "01",
      title: "Work",
      prompt: "Do <specflow_task> for <specflow_audience>.",
      sessionId: "s1",
    },
  ],
  edges: [{ id: "edge:start:->work", from: "start", to: "work" }],
};

describe("specflow run args", () => {
  test("parses file, -D values, and yes flag", () => {
    expect(parseRunArgs(["flow.yaml", "-Dtask=fix", "-D", "audience=devs", "--yes"])).toEqual({
      file: "flow.yaml",
      yes: true,
      values: {
        task: "fix",
        audience: "devs",
      },
    });
  });

  test("rejects removed --input option", () => {
    expect(() => parseRunArgs(["flow.yaml", "--input", "task"])).toThrow("Unexpected argument: --input");
    expect(() => parseRunArgs(["flow.yaml", "--input=task"])).toThrow("Unexpected argument: --input=task");
  });
});

describe("specflow validate args", () => {
  test("accepts exactly one workflow file", () => {
    expect(parseValidateArgs(["flow.yaml"])).toBe("flow.yaml");
  });

  test("rejects extra arguments and flags", () => {
    expect(() => parseValidateArgs(["flow.yaml", "extra.yaml"])).toThrow("Unexpected argument: extra.yaml");
    expect(() => parseValidateArgs(["--yes"])).toThrow("Unexpected argument: --yes");
  });
});

describe("specflow run input values", () => {
  test("maps friendly input names to internal specflow variables", () => {
    expect(normalizeVariableValues(canvasDocument, { task: "fix" })).toEqual({
      specflow_task: "fix",
    });
  });

  test("accepts fully prefixed input names for compatibility", () => {
    expect(normalizeVariableValues(canvasDocument, { specflow_audience: "devs" })).toEqual({
      specflow_audience: "devs",
    });
  });

  test("rejects unknown input names", () => {
    expect(() => normalizeVariableValues(canvasDocument, { missing: "x" })).toThrow(
      "Unknown input: missing\nAvailable inputs:\n  - task\n  - audience",
    );
  });

  test("rejects values when the workflow has no input nodes", () => {
    expect(() => normalizeVariableValues({ ...canvasDocument, variables: [] }, { task: "x" })).toThrow(
      "Unknown input: task\nAvailable inputs: none",
    );
  });
});

describe("specflow run workflow support", () => {
  test("accepts workflows without paused step nodes", () => {
    expect(() => assertCliRunnableAgentFlow(canvasDocument)).not.toThrow();
  });

  test("rejects workflows with paused step nodes", () => {
    const doc: AgentFlowDoc = {
      ...canvasDocument,
      nodes: [
        ...canvasDocument.nodes,
        {
          kind: "step",
          id: "review",
          alias: "02",
          title: "Review",
          prompt: "Review the change.",
          sessionId: "s1",
          pauseAfterRun: true,
        },
      ],
    };

    expect(() => assertCliRunnableAgentFlow(doc)).toThrow(
      "specflow run does not support pauseAfterRun nodes.\n"
      + "Start the UI with `specflow`, then run this workflow from the browser to use pause/continue.\n"
      + "Paused nodes:\n"
      + "  - 02 Review (review)",
    );
  });
});
