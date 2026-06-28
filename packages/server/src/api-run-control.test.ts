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
    expect(pausedRecord.agentflowSnapshot.nodes.find((node) => node.id === "node-1")).not.toHaveProperty("pauseAfterRun");
    expect(pausedRecord.snapshotRevision).toBeUndefined();

    const interrupt = await handle(new Request(`http://specflow.test/api/runs/${runId}/interrupt`, { method: "POST" }));
    expect(interrupt?.status).toBe(409);
    expect(await interrupt!.json()).toMatchObject({
      code: "RUN_CONTROL_ALREADY_PENDING",
    });

    await handle(new Request(`http://specflow.test/api/runs/${runId}/stop`, { method: "POST" }));
  });

  test("start can pause after the first activation without a follow-up pause request", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-control-"));
    await upsertFastAgent(root);
    await saveCanvas("wf-control", sampleCanvas({ agentServerId: "fast-headless" }), root);

    const bridge = createSpecflowBridge();
    const handle = createApiHandler(bridge, root);
    const start = await handle(new Request("http://specflow.test/api/canvases/wf-control/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pauseAfterFirstActivation: true }),
    }));
    expect(start?.status).toBe(200);
    const { runId } = await start!.json() as { runId: string };

    const paused = await eventuallyLoadRun(root, runId, "paused");
    expect(paused.pausedNodeId).toBe("node-1");
    expect(paused.checkpoint?.pendingCompletion).toMatchObject({
      nodeId: "node-1",
      output: expect.stringContaining("fast-output"),
    });
  });

  test("play can arm a pause after the next activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-control-"));
    await upsertFastAgent(root);
    await saveCanvas("wf-control", sampleTwoStepCanvas(), root);

    const bridge = createSpecflowBridge();
    const handle = createApiHandler(bridge, root);
    const start = await handle(new Request("http://specflow.test/api/canvases/wf-control/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pauseAfterFirstActivation: true }),
    }));
    expect(start?.status).toBe(200);
    const { runId } = await start!.json() as { runId: string };
    const paused = await eventuallyLoadRun(root, runId, "paused");
    expect(paused.status).toBe("paused");
    expect(paused.pausedNodeId).toBe("node-1");

    const play = await handle(new Request(`http://specflow.test/api/runs/${runId}/play`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pauseAfterNextActivation: true }),
    }));
    expect(play?.status).toBe(200);

    const pausedAgain = await eventuallyLoadRun(root, runId, "paused", "node-2");
    expect(pausedAgain.pausedNodeId).toBe("node-2");
    expect(pausedAgain.nodeStates["node-1"]).toBe("success");
    expect(pausedAgain.checkpoint?.pendingCompletion).toMatchObject({
      nodeId: "node-2",
    });
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

async function upsertFastAgent(root: string) {
  await upsertLocalAgentServer(root, "fast-headless", {
    type: "headless",
    command: process.execPath,
    argsTemplate: ["-e", "process.stdout.write('fast-output')"],
  });
}

async function eventuallyLoadRun(root: string, runId: string, status: string, pausedNodeId?: string) {
  let last = await loadRun(runId, root);
  for (let index = 0; index < 100; index += 1) {
    if (last.status === status && (!pausedNodeId || last.pausedNodeId === pausedNodeId)) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = await loadRun(runId, root);
  }
  return last;
}

function sampleCanvas(options: { agentServerId?: string } = {}): CanvasDoc {
  return {
    id: "wf-control",
    name: "Run control test",
    sessions: [
      {
        id: "s1",
        name: "main",
        agentServerId: options.agentServerId ?? "slow-headless",
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
      {
        kind: "start",
        id: "start",
        alias: "START",
        x: 0,
        y: 80,
        w: 140,
        title: "Start",
        sessionId: null,
      },
    ],
    edges: [
      {
        id: "edge-start",
        from: "start",
        to: "node-1",
      },
    ],
  };
}

function sampleTwoStepCanvas(): CanvasDoc {
  const canvas = sampleCanvas({ agentServerId: "fast-headless" });
  canvas.nodes.push({
    kind: "step",
    id: "node-2",
    alias: "2",
    x: 380,
    y: 80,
    w: 240,
    title: "Second",
    prompt: "second prompt",
    sessionId: "s1",
  });
  canvas.edges.push({
    id: "edge-1",
    from: "node-1",
    to: "node-2",
  });
  return canvas;
}
