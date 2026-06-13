import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { saveCanvas } from "./agentflow/canvas-store";
import { upsertLocalAgentServer } from "./agent-server-config";
import { loadRun } from "./agentflow/run-store";
import type { CanvasDoc } from "./agentflow/canvas-doc";

describe("run control API", () => {
  test("pause records a pending control intent and blocks interrupt until suspended", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-control-"));
    await upsertLocalAgentServer(root, "slow-headless", {
      type: "headless",
      command: process.execPath,
      argsTemplate: ["-e", "setTimeout(() => {}, 30000)"],
    });
    await saveCanvas("wf-control", sampleCanvas(), root);

    const bridge = createSpecflowBridge();
    const handle = createApiHandler(bridge, root);
    const start = await handle(new Request("http://specflow.test/api/canvases/wf-control/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(start?.status).toBe(200);
    const { runId } = await start!.json() as { runId: string };

    await eventuallyActiveActivation(bridge, runId);

    const pause = await handle(new Request(`http://specflow.test/api/runs/${runId}/pause`, { method: "POST" }));
    expect(pause?.status).toBe(200);
    expect(await pause!.json()).toMatchObject({
      status: "pause_after_requested",
      nodeId: "node-1",
      nodeKind: "step",
    });

    const pausedRecord = await loadRun(runId, root);
    expect(pausedRecord.control?.intent).toMatchObject({
      kind: "pause_after_activation",
      nodeId: "node-1",
    });
    expect(pausedRecord.agentflowSnapshot.nodes.find((node) => node.id === "node-1")).toMatchObject({
      pauseAfterRun: true,
    });

    const interrupt = await handle(new Request(`http://specflow.test/api/runs/${runId}/interrupt`, { method: "POST" }));
    expect(interrupt?.status).toBe(409);
    expect(await interrupt!.json()).toMatchObject({
      code: "RUN_CONTROL_ALREADY_PENDING",
    });

    await handle(new Request(`http://specflow.test/api/runs/${runId}/stop`, { method: "POST" }));
  });
});

async function eventuallyActiveActivation(bridge: ReturnType<typeof createSpecflowBridge>, runId: string) {
  for (let index = 0; index < 50; index += 1) {
    const active = bridge.runControls.getActiveActivation(runId);
    if (active) return active;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for active activation.");
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf-control",
    name: "Run control test",
    sessions: [
      {
        id: "s1",
        name: "main",
        agentServerId: "slow-headless",
      },
    ],
    nodes: [
      {
        kind: "step",
        id: "node-1",
        alias: "1",
        x: 80,
        y: 80,
        w: 240,
        title: "Slow",
        prompt: "slow prompt",
        sessionId: "s1",
      },
    ],
    edges: [],
  };
}
