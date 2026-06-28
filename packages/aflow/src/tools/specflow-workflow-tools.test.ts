import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { __testing, registerSpecflowWorkflowTools } from "./specflow-workflow-tools";

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

  test("registers operator run tools with existing-run guidance", () => {
    const tools: Array<{ name: string; description?: string; promptGuidelines?: string[] }> = [];
    registerSpecflowWorkflowTools({
      registerTool(tool) {
        tools.push(tool as { name: string; description?: string; promptGuidelines?: string[] });
      },
    } as ExtensionAPI);

    for (const name of [
      "specflow_get_run",
      "specflow_get_run_logs",
      "specflow_pause_run",
      "specflow_play_run",
      "specflow_stop_run",
    ]) {
      expect(tools.map((tool) => tool.name)).toContain(name);
      const tool = tools.find((candidate) => candidate.name === name);
      const visibleText = [tool?.description, ...(tool?.promptGuidelines ?? [])].join("\n");
      expect(visibleText).toContain("existing");
      expect(visibleText).toContain("external");
    }

    const stopTool = tools.find((tool) => tool.name === "specflow_stop_run");
    expect([stopTool?.description, ...(stopTool?.promptGuidelines ?? [])].join("\n")).toContain("terminal");

    const playTool = tools.find((tool) => tool.name === "specflow_play_run");
    expect([playTool?.description, ...(playTool?.promptGuidelines ?? [])].join("\n")).toContain("Stopped runs cannot be played");
  });

  test("registers agent server and native resume tools with conservative guidance", () => {
    const tools: Array<{ name: string; description?: string; promptSnippet?: string; promptGuidelines?: string[] }> = [];
    registerSpecflowWorkflowTools({
      registerTool(tool) {
        tools.push(tool as { name: string; description?: string; promptSnippet?: string; promptGuidelines?: string[] });
      },
    } as ExtensionAPI);

    for (const name of [
      "specflow_list_agent_servers",
      "specflow_list_agent_registry",
      "specflow_install_registry_agent",
      "specflow_update_registry_agent",
      "specflow_remove_agent_server",
      "specflow_get_agent_capabilities",
      "specflow_refresh_agent_capabilities",
      "specflow_get_native_resume_commands",
    ]) {
      expect(tools.map((tool) => tool.name)).toContain(name);
    }
    expect(tools.map((tool) => tool.name)).not.toContain("specflow_save_agent_server");

    const installTool = tools.find((tool) => tool.name === "specflow_install_registry_agent");
    const installText = [installTool?.description, installTool?.promptSnippet, ...(installTool?.promptGuidelines ?? [])].join("\n");
    expect(installText).toContain("explicitly");
    expect(installText).toContain("Specflow UI");
    expect(installText).toContain("custom/headless");

    const nativeTool = tools.find((tool) => tool.name === "specflow_get_native_resume_commands");
    expect([nativeTool?.description, nativeTool?.promptSnippet, ...(nativeTool?.promptGuidelines ?? [])].join("\n")).toContain("do not guess");
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

  test("builds a non-TUI waiting result for pending run interactions", () => {
    const result = __testing.waitingForInteractionResult({
      id: "run-1",
      workflowId: "workflow-1",
      status: "running",
    }, {
      id: "interaction-1",
      kind: "permission",
      status: "pending",
      runId: "run-1",
      nodeId: "node-1",
      agentInvocationId: "invoke-1",
      agentId: "agent-1",
      agentServerId: "codex-acp",
      createdAt: "2026-06-21T00:00:00.000Z",
      toolCall: { title: "Edit file" },
      options: [{ optionId: "allow", name: "Allow" }],
    });

    expect(result.waitingForInteraction).toBe(true);
    expect(result.text).toContain("Workflow run is waiting");
    expect(result.text).toContain("/api/runs/run-1/interactions/interaction-1/respond");
    expect(result.details).toMatchObject({
      waitingForInteraction: true,
      runId: "run-1",
      interactionId: "interaction-1",
      nodeId: "node-1",
      agentServerId: "codex-acp",
    });
  });

  test("resolves permission and elicitation interactions from TUI choices", async () => {
    const selections = ["1. Allow", "Decline"];
    const ui = {
      notify() {},
      async select() {
        return selections.shift();
      },
      async custom() {
        throw new Error("not used");
      },
      async input() {
        return undefined;
      },
      async confirm() {
        return false;
      },
    };

    await expect(__testing.askRunInteractionResolution(ui, {
      id: "permission-1",
      kind: "permission",
      status: "pending",
      runId: "run-1",
      agentInvocationId: "invoke-1",
      agentId: "agent-1",
      agentServerId: "codex-acp",
      createdAt: "2026-06-21T00:00:00.000Z",
      toolCall: { title: "Edit file" },
      options: [{ optionId: "allow", name: "Allow" }],
    })).resolves.toEqual({ outcome: "selected", optionId: "allow" });

    await expect(__testing.askRunInteractionResolution(ui, {
      id: "elicitation-1",
      kind: "elicitation",
      status: "pending",
      runId: "run-1",
      agentInvocationId: "invoke-1",
      agentId: "agent-1",
      agentServerId: "codex-acp",
      createdAt: "2026-06-21T00:00:00.000Z",
      request: { message: "Need input" },
    })).resolves.toEqual({ action: "decline" });
  });
});
