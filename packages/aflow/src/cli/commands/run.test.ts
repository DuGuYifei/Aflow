import { describe, expect, test } from "bun:test";
import { parseRunCommandArgs, specflowRunCommand } from "./run";

describe("specflow run direct command args", () => {
  test("parses workflow variables and freeform run context", () => {
    expect(parseRunCommandArgs([
      "example-flow",
      "--context",
      "Run with the June dataset",
      "-Dspecflow_customer=Acme",
      "--server",
      "http://127.0.0.1:3210",
    ])).toEqual({
      workflowId: "example-flow",
      initialInput: "Run with the June dataset",
      variableValues: { specflow_customer: "Acme" },
      serverUrl: "http://127.0.0.1:3210",
    });
  });

  test("keeps --input as a deprecated alias for context", () => {
    expect(parseRunCommandArgs(["example-flow", "--input=legacy context"]).initialInput).toBe("legacy context");
  });

  test("reports the v2-oriented usage when the workflow id is missing", async () => {
    await expect(specflowRunCommand([], {
      cwd: process.cwd(),
      io: { info() {}, warn() {}, success() {}, error() {} },
    })).rejects.toThrow("Usage: /specflow-run <workflow-id> [--context TEXT] [-Dspecflow_name=value] [--server URL]");
  });
});
