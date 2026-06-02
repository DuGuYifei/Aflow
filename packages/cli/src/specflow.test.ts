import { describe, expect, test } from "bun:test";
import { normalizeVariableValues, parseRunArgs, parseValidateArgs } from "./specflow";
import type { AgentFlowDoc } from "@specflow/server";

const canvasDocument: AgentFlowDoc = {
  id: "flow",
  name: "Flow",
  sessions: [],
  nodes: [
    {
      kind: "input",
      id: "task-input",
      alias: "IN",
      title: "Task",
      variableName: "specflow_task",
      sessionId: null,
    },
    {
      kind: "input",
      id: "audience-input",
      alias: "IN",
      title: "Audience",
      variableName: "specflow_audience",
      sessionId: null,
    },
  ],
  edges: [],
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
    expect(() => normalizeVariableValues({ ...canvasDocument, nodes: [] }, { task: "x" })).toThrow(
      "Unknown input: task\nAvailable inputs: none",
    );
  });
});
