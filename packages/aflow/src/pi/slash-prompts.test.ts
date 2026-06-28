import { describe, expect, test } from "bun:test";
import { buildContinueWorkflowPrompt, buildRunWorkflowPrompt } from "./slash-prompts";

describe("slash prompts", () => {
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
