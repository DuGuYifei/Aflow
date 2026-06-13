import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { saveCanvas } from "./agentflow/canvas-store";
import { loadRun, saveRun, type RunRecord } from "./agentflow/run-store";
import type { CanvasDoc } from "./agentflow/canvas-doc";

describe("run snapshot editing API", () => {
  test("patches only paused run snapshots and protects checkpoint nodes", async () => {
    const root = await tempProject();
    await saveCanvas("wf", sampleCanvas(), root);
    await saveRun(samplePausedRun(), root);

    const handle = createApiHandler(testBridge(), root);
    const withoutCheckpointNode = {
      ...sampleCanvas(),
      nodes: sampleCanvas().nodes.filter((node) => node.id !== "step-2"),
      edges: [],
    };
    const rejected = await handle(new Request("http://specflow.test/api/runs/run1/snapshot", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: withoutCheckpointNode }),
    }));
    expect(rejected?.status).toBe(409);

    const patchedCanvas = sampleCanvas();
    patchedCanvas.nodes = patchedCanvas.nodes.map((node) => node.id === "step-2" && node.kind === "step"
      ? { ...node, prompt: "updated future prompt" }
      : node);
    const patched = await handle(new Request("http://specflow.test/api/runs/run1/snapshot", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: patchedCanvas, summary: "update future prompt" }),
    }));
    expect(patched?.status).toBe(200);
    const body = await patched!.json() as { snapshotRevision: number };
    expect(body.snapshotRevision).toBe(1);
    const run = await loadRun("run1", root);
    expect(run.snapshotEditSummary).toBe("update future prompt");
    expect(run.agentflowSnapshot.nodes.find((node) => node.id === "step-2" && node.kind === "step")).toMatchObject({
      prompt: "updated future prompt",
    });
  });

  test("reports runtime reachability classes from the checkpoint frontier", async () => {
    const root = await tempProject();
    await saveRun(samplePausedRun(), root);
    const handle = createApiHandler(testBridge(), root);

    const response = await handle(new Request("http://specflow.test/api/runs/run1/reachability"));
    expect(response?.status).toBe(200);
    const reachability = await response!.json() as { nodes: Record<string, string> };
    expect(reachability.nodes["step-1"]).toBe("history_future");
    expect(reachability.nodes["step-2"]).toBe("future");
    expect(reachability.nodes["done"]).toBe("history_future");
    expect(reachability.nodes["archived"]).toBe("history_only");
    expect(reachability.nodes["inactive"]).toBe("inactive");
  });
});

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "specflow-run-snapshot-"));
}

function testBridge() {
  return {
    ...createSpecflowBridge(),
    listAgentServers: async () => [{
      id: "test-agent",
      settings: { type: "custom" as const, command: process.execPath, args: ["-e", ""] },
    }],
  };
}

function samplePausedRun(): RunRecord {
  return {
    id: "run1",
    workflowId: "wf",
    label: "Run #1",
    status: "paused",
    startedAt: "2026-06-13T10:00:00.000Z",
    agent: "test-agent",
    nodeStates: {
      "step-1": "success",
      "step-2": "pending",
      done: "success",
      archived: "success",
      inactive: "pending",
    },
    nodeOutputs: { "step-1": "done" },
    agentInvocations: [],
    agentSessions: [],
    agentflowSnapshot: {
      id: "wf",
      version: 2,
      name: "Workflow",
      sessions: [{ id: "s1", name: "Main", agentServerId: "test-agent" }],
      nodes: sampleCanvas().nodes.map(({ x: _x, y: _y, w: _w, ...node }) => node),
      edges: sampleCanvas().edges,
    },
    canvasSnapshot: {
      workflowId: "wf",
      version: 1,
      nodes: sampleCanvas().nodes.map((node) => ({ nodeId: node.id, x: node.x, y: node.y, w: node.w })),
    },
    initialInput: "",
    variableValues: {},
    checkpoint: {
      queue: [{ nodeId: "step-1", traversal: 1 }],
      pendingInputs: {},
      completedNodeIds: ["step-1", "done"],
      completedExecutionKeys: ["step-1:0"],
      skippedNodeIds: [],
      inactiveEdgeIds: [],
      branchTraversals: {},
      createdAt: "2026-06-13T10:00:01.000Z",
    },
  };
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf",
    version: 2,
    name: "Workflow",
    sessions: [{ id: "s1", name: "Main", agentServerId: "test-agent" }],
    nodes: [
      { kind: "start", id: "start", alias: "S", x: 40, y: 100, w: 120, title: "Start", sessionId: null },
      { kind: "step", id: "step-1", alias: "01", x: 200, y: 100, w: 220, title: "One", prompt: "first", sessionId: "s1" },
      { kind: "step", id: "step-2", alias: "02", x: 460, y: 100, w: 220, title: "Two", prompt: "second", sessionId: "s1" },
      { kind: "end", id: "done", alias: "END", x: 720, y: 100, w: 140, title: "Done", sessionId: null },
      { kind: "step", id: "archived", alias: "03", x: 460, y: 300, w: 220, title: "Archived", prompt: "archived", sessionId: "s1" },
      { kind: "step", id: "inactive", alias: "04", x: 720, y: 300, w: 220, title: "Inactive", prompt: "inactive", sessionId: "s1" },
    ],
    edges: [
      { id: "e-start-1", from: "start", to: "step-1", transmit: false },
      { id: "e-1-2", from: "step-1", to: "step-2", transmit: false },
      { id: "e-2-done", from: "step-2", to: "done", transmit: false },
    ],
  };
}
