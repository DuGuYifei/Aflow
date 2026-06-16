import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSpecflowWorkflowTools } from "./specflow-workflow-tools";

describe("specflow workflow tools", () => {
  test("registers dynamic next-checkpoint tool without the old run-and-pause alias", () => {
    const tools: Array<{ name: string; promptGuidelines?: string[] }> = [];
    registerSpecflowWorkflowTools({
      registerTool(tool) {
        tools.push(tool as { name: string; promptGuidelines?: string[] });
      },
    } as ExtensionAPI);

    const names = tools.map((tool) => tool.name);
    expect(names).toContain("specflow_run_to_next_checkpoint");
    expect(names).not.toContain("specflow_run_and_pause");
  });

  test("documents runtime graph insert operations on the patch tool", () => {
    const tools: Array<{ name: string; promptGuidelines?: string[] }> = [];
    registerSpecflowWorkflowTools({
      registerTool(tool) {
        tools.push(tool as { name: string; promptGuidelines?: string[] });
      },
    } as ExtensionAPI);

    const patchTool = tools.find((tool) => tool.name === "specflow_patch_run_graph");
    expect(patchTool?.promptGuidelines?.join("\n")).toContain("insert_node_between");
    expect(patchTool?.promptGuidelines?.join("\n")).toContain("sourceNodeId");
    expect(patchTool?.promptGuidelines?.join("\n")).toContain("targetNodeId");
  });
});
