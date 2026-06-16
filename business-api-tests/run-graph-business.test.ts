import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "../packages/bridge/src/index";
import { createApiHandler } from "../packages/server/src/api";
import type { CanvasDoc } from "../packages/server/src/agentflow/canvas-doc";
import { loadRun, saveRun, type RunRecord } from "../packages/server/src/agentflow/run-store";

describe("business API: dynamic run graph editing", () => {
  test("the UI can ask which parts of a paused run are current, future, historical, or inactive", async () => {
    const root = await tempProject();
    await saveRun(pausedAfterFirstStep(), root);
    const handle = createApiHandler(testBridge(), root);

    const response = await handle(new Request("http://specflow.test/api/runs/run1/reachability"));

    expect(response?.status).toBe(200);
    const body = await response!.json() as { nodes: Record<string, string> };
    expect(body.nodes.draft).toBe("current");
    expect(body.nodes.publish).toBe("future");
    expect(body.nodes.archived).toBe("history_only");
    expect(body.nodes.unused).toBe("inactive");
  });

  test("a reviewer can insert a correction step after the paused output before the future workflow continues", async () => {
    const root = await tempProject();
    await saveRun(pausedAfterFirstStep(), root);
    const handle = createApiHandler(testBridge(), root);

    const response = await patchRunGraph(handle, "run1", {
      summary: "insert a correction before publishing",
      operations: [{
        op: "insert_node_between",
        sourceNodeId: "draft",
        targetNodeId: "publish",
        node: {
          kind: "step",
          id: "correct",
          alias: "FIX",
          title: "Correct the draft",
          prompt: "Correct the previous draft before publishing.",
          sessionId: "writer",
        },
      }],
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      migrationPreview: {
        queueRebuild: {
          discardedFutureQueueEntries: Array<{ nodeId: string }>;
          frontier: string[];
        };
      };
      topologyCapabilities: { canAddFutureNode: boolean; canReconnectFutureEdge: boolean };
    };
    expect(body.topologyCapabilities).toMatchObject({
      canAddFutureNode: true,
      canReconnectFutureEdge: true,
    });
    expect(body.migrationPreview.queueRebuild.discardedFutureQueueEntries).toEqual([{ nodeId: "publish", traversal: 0 }]);
    expect(body.migrationPreview.queueRebuild.frontier).toEqual(["draft"]);

    const run = await loadRun("run1", root);
    expect(run.agentflowSnapshot.nodes.map((node) => node.id)).toContain("correct");
    expect(run.agentflowSnapshot.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "draft", to: "correct" }),
      expect.objectContaining({ from: "correct", to: "publish" }),
    ]));
    expect(run.checkpoint?.pendingCompletion).toMatchObject({
      nodeId: "draft",
      output: "The draft needs a factual correction.",
    });
  });

  test("a reviewer cannot rewrite an output that is already history-only for this run", async () => {
    const root = await tempProject();
    await saveRun(pausedAfterFirstStep(), root);
    const handle = createApiHandler(testBridge(), root);

    const response = await patchRunGraph(handle, "run1", {
      summary: "rewrite old archived notes",
      operations: [{ op: "update_node", nodeId: "archived", patch: { prompt: "pretend this old step said something else" } }],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      rejectedOperations: [expect.objectContaining({
        code: "SNAPSHOT_EDIT_UNREACHABLE_NODE",
        nodeId: "archived",
      })],
    });
  });

  test("after interrupting a running node, the reviewer can adjust that current node before it is re-entered", async () => {
    const root = await tempProject();
    await saveRun(interruptedDraftStep(), root);
    const handle = createApiHandler(testBridge(), root);

    const response = await patchRunGraph(handle, "run1", {
      summary: "make the interrupted instruction more specific",
      operations: [{
        op: "update_node",
        nodeId: "draft",
        patch: { prompt: "Draft the answer again, but explicitly cite the latest user constraint." },
      }],
    });

    expect(response.status).toBe(200);
    const run = await loadRun("run1", root);
    expect(run.agentflowSnapshot.nodes.find((node) => node.id === "draft" && node.kind === "step")).toMatchObject({
      prompt: "Draft the answer again, but explicitly cite the latest user constraint.",
    });
    expect(run.checkpoint).toMatchObject({
      interruptedNodeId: "draft",
      interruptedExecutionKey: "draft:0",
    });
  });
});

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "specflow-business-api-"));
}

function testBridge() {
  return {
    ...createSpecflowBridge(),
    listAgentServers: async () => [{
      id: "test-agent",
      settings: { type: "headless" as const, command: process.execPath, argsTemplate: ["-e", ""] },
    }],
  };
}

async function patchRunGraph(
  handle: ReturnType<typeof createApiHandler>,
  runId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await handle(new Request(`http://specflow.test/api/runs/${runId}/graph`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  if (!response) throw new Error("API handler did not return a response");
  return response;
}

function pausedAfterFirstStep(): RunRecord {
  const canvas = sampleCanvas();
  return {
    id: "run1",
    workflowId: "wf",
    label: "Run #1",
    status: "paused",
    startedAt: "2026-06-16T10:00:00.000Z",
    agent: "test-agent",
    nodeStates: {
      draft: "paused",
      publish: "pending",
      archived: "success",
      unused: "pending",
    },
    nodeOutputs: {
      draft: "The draft needs a factual correction.",
      archived: "Historical note.",
    },
    agentInvocations: [],
    agentSessions: [],
    agentflowSnapshot: {
      id: canvas.id,
      version: 2,
      name: canvas.name,
      sessions: canvas.sessions,
      nodes: canvas.nodes.map(({ x: _x, y: _y, w: _w, ...node }) => node),
      edges: canvas.edges,
    },
    canvasSnapshot: {
      workflowId: canvas.id,
      version: 1,
      nodes: canvas.nodes.map((node) => ({ nodeId: node.id, x: node.x, y: node.y, w: node.w })),
    },
    initialInput: "",
    variableValues: {},
    checkpoint: {
      queue: [{ nodeId: "publish", traversal: 0 }],
      pendingInputs: {
        "publish:0": { input: ["The draft needs a factual correction."], edgeValues: {} },
      },
      completedNodeIds: ["draft", "archived"],
      completedExecutionKeys: ["draft:0", "archived:0"],
      skippedNodeIds: [],
      inactiveEdgeIds: [],
      branchTraversals: {},
      activeNodeId: "draft",
      pendingCompletion: {
        nodeId: "draft",
        traversal: 0,
        executionKey: "draft:0",
        output: "The draft needs a factual correction.",
        origin: { agentId: "test-agent", sessionId: "writer", output: "The draft needs a factual correction." },
      },
      createdAt: "2026-06-16T10:00:01.000Z",
    },
  };
}

function interruptedDraftStep(): RunRecord {
  const run = pausedAfterFirstStep();
  return {
    ...run,
    status: "interrupted",
    nodeStates: {
      draft: "interrupted",
      publish: "pending",
      archived: "success",
      unused: "pending",
    },
    checkpoint: {
      queue: [],
      pendingInputs: {
        "draft:0": { input: ["User changed the requirement."], edgeValues: {} },
      },
      completedNodeIds: ["archived"],
      completedExecutionKeys: ["archived:0"],
      skippedNodeIds: [],
      inactiveEdgeIds: [],
      branchTraversals: {},
      activeNodeId: "draft",
      interruptedNodeId: "draft",
      interruptedExecutionKey: "draft:0",
      createdAt: "2026-06-16T10:00:01.000Z",
    },
  };
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf",
    version: 2,
    name: "Business Review Flow",
    sessions: [{ id: "writer", name: "Writer", agentServerId: "test-agent" }],
    nodes: [
      { kind: "start", id: "start", alias: "START", x: 40, y: 100, w: 140, title: "Start", sessionId: null },
      { kind: "step", id: "draft", alias: "01", x: 220, y: 100, w: 220, title: "Draft", prompt: "Draft an answer.", sessionId: "writer" },
      { kind: "step", id: "publish", alias: "02", x: 500, y: 100, w: 220, title: "Publish", prompt: "Publish the answer.", sessionId: "writer" },
      { kind: "end", id: "done", alias: "END", x: 780, y: 100, w: 80, title: "Done", sessionId: null },
      { kind: "step", id: "archived", alias: "99", x: 220, y: 300, w: 220, title: "Archived", prompt: "Already done earlier.", sessionId: "writer" },
      { kind: "step", id: "unused", alias: "04", x: 500, y: 300, w: 220, title: "Unused", prompt: "Not reached.", sessionId: "writer" },
    ],
    edges: [
      { id: "start-draft", from: "start", to: "draft", transmit: false },
      { id: "draft-publish", from: "draft", to: "publish", transmit: false },
      { id: "publish-done", from: "publish", to: "done", transmit: false },
    ],
  };
}
