import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { agentflowsDir, canvasDir } from "./workspace-paths";
import type { AgentFlowDoc, CanvasLayoutDoc, WorkflowDiagnostic } from "./agentflow/canvas-doc";

describe("canvas save API", () => {
  test("saves agentflow semantics separately from layout and returns diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-canvas-save-"));
    const handle = createApiHandler(createSpecflowBridge(), root);
    const agentflow = sampleAgentFlow();

    const agentflowResponse = await handle(new Request("http://specflow.test/api/canvases/wf-save/agentflow", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(agentflow),
    }));
    expect(agentflowResponse?.status).toBe(200);
    const agentflowBody = await agentflowResponse!.json() as {
      ok: true;
      diagnostics: WorkflowDiagnostic[];
      derived?: { loopClosingEdgeIds?: string[] };
    };
    expect(agentflowBody.ok).toBe(true);
    expect(agentflowBody.diagnostics.some((diagnostic) =>
      diagnostic.code === "REQUIRED_VARIABLE_NEEDS_RUNTIME_VALUE")).toBe(true);
    expect(await readFile(join(agentflowsDir(root), "wf-save.yaml"), "utf8")).toContain("name: Save Split");

    const layout: CanvasLayoutDoc = {
      workflowId: "wrong-id",
      version: 1,
      nodes: [{ nodeId: "start", x: 12, y: 34, w: 140 }],
    };
    const layoutResponse = await handle(new Request("http://specflow.test/api/canvases/wf-save/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    }));
    expect(layoutResponse?.status).toBe(200);
    const savedLayout = JSON.parse(await readFile(join(canvasDir(root), "wf-save.json"), "utf8")) as CanvasLayoutDoc;
    expect(savedLayout.workflowId).toBe("wf-save");
    expect(savedLayout.nodes[0]).toMatchObject({ nodeId: "start", x: 12, y: 34, w: 140 });
  });
});

function sampleAgentFlow(): AgentFlowDoc {
  return {
    id: "wf-save",
    version: 2,
    name: "Save Split",
    sessions: [{ id: "main", name: "main", agentServerId: "codex-acp" }],
    variables: [{ name: "specflow_task", required: true }],
    nodes: [
      { kind: "start", id: "start", alias: "START", title: "Start", sessionId: null },
      { kind: "step", id: "step", alias: "01", title: "Step", prompt: "Use <specflow_task>.", sessionId: "main" },
    ],
    edges: [{ id: "edge:start:->step", from: "start", to: "step" }],
  };
}
