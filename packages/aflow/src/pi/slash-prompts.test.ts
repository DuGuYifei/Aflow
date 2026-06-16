import { describe, expect, test } from "bun:test";
import { buildContinueWorkflowPrompt, buildMigrateV2WorkflowPrompt, buildRunWorkflowPrompt } from "./slash-prompts";

describe("slash prompts", () => {
  test("builds a focused v2 migration prompt without teaching v1 authoring", () => {
    const prompt = buildMigrateV2WorkflowPrompt("legacy-flow");

    expect(prompt).toContain("Target workflow:\nlegacy-flow");
    expect(prompt).toContain("Set `version: 2`.");
    expect(prompt).toContain("Replace v1 `kind: input` nodes with top-level `variables:` entries.");
    expect(prompt).toContain("Remove authored edge `loopback`.");
    expect(prompt).toContain("Move gate branch traversal limits from edge `maxTraversals`");
    expect(prompt).toContain("Do not teach or reintroduce v1 input nodes");
    expect(prompt).toContain("At the very end, print exactly: Finished");
  });

  test("run prompt uses dynamic next-checkpoint terminology instead of old play tool", () => {
    const prompt = buildRunWorkflowPrompt("workflow-1");

    expect(prompt).toContain("call `specflow_run_workflow`");
    expect(prompt).toContain("later checkpoints are reached with `specflow_run_to_next_checkpoint`");
    expect(prompt).not.toContain("specflow_run_and_pause");
    expect(prompt).not.toContain("specflow_play_run");
    expect(prompt).not.toContain("specflow_patch_run_snapshot");
  });

  test("continue prompt uses workflow continuation terminology", () => {
    const prompt = buildContinueWorkflowPrompt("run-1");

    expect(prompt).toContain("specflow_continue_workflow");
    expect(prompt).toContain("continuation run");
    expect(prompt).not.toContain("specflow_resume_workflow");
  });
});
