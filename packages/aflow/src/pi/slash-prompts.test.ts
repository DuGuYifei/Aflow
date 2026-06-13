import { describe, expect, test } from "bun:test";
import { buildMigrateV2WorkflowPrompt } from "./slash-prompts";

describe("slash prompts", () => {
  test("builds a focused v2 migration prompt without teaching v1 authoring", () => {
    const prompt = buildMigrateV2WorkflowPrompt("legacy-flow");

    expect(prompt).toContain("Target workflow:\nlegacy-flow");
    expect(prompt).toContain("Set `version: 2`.");
    expect(prompt).toContain("Replace v1 `kind: input` nodes with top-level `variables:` entries.");
    expect(prompt).toContain("Remove authored edge `loopback`.");
    expect(prompt).toContain("Move gate branch traversal limits from edge `maxTraversals`");
    expect(prompt).toContain("Do not teach or reintroduce v1 input nodes");
  });
});
