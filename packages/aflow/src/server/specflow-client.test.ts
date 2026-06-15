import { afterEach, describe, expect, test } from "bun:test";
import { SpecflowClient } from "./specflow-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SpecflowClient", () => {
  test("normalizes run start responses that only contain runId", async () => {
    globalThis.fetch = (async (input) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.endsWith("/api/canvases/workflow-1/run")) {
        return jsonResponse({ runId: "run-1" });
      }
      if (url.endsWith("/api/runs/run-1")) {
        return jsonResponse({
          id: "run-1",
          workflowId: "workflow-1",
          status: "running",
        });
      }
      return jsonResponse({ error: `Unexpected URL: ${url}` }, 404);
    }) as typeof fetch;

    const client = new SpecflowClient("http://specflow.test");
    await expect(client.runCanvas("workflow-1", {})).resolves.toEqual({
      id: "run-1",
      runId: "run-1",
      workflowId: "workflow-1",
      status: "running",
      resumedFromRunId: undefined,
      resumedByRunId: undefined,
      errorMsg: undefined,
    });
  });

  test("sends run control and graph patch request bodies", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = input instanceof URL ? input.href : String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/api/runs/run-1/reachability")) return jsonResponse({ nodes: {} });
      if (url.endsWith("/api/runs/run-1/graph")) return jsonResponse({ ok: true, snapshotRevision: 2, snapshot: {}, reachability: { nodes: {} } });
      if (url.endsWith("/api/runs/run-1/continue")) return jsonResponse({ runId: "run-continued" });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const client = new SpecflowClient("http://specflow.test");
    await client.playRun("run-1", { pauseAfterNextActivation: true });
    await client.continueWorkflowRun("run-1");
    await client.continuePausedNode("run-1", "node-1", { play: false });
    await client.getRunReachability("run-1");
    await client.patchRunGraph("run-1", {
      operations: [{ op: "update_node", nodeId: "node-1", patch: { title: "Updated" } }],
      summary: "graph edit",
    });

    expect(requests.map((request) => [request.method, new URL(request.url).pathname, request.body])).toEqual([
      ["POST", "/api/runs/run-1/play", { pauseAfterNextActivation: true }],
      ["POST", "/api/runs/run-1/continue", undefined],
      ["GET", "/api/runs/run-continued", undefined],
      ["POST", "/api/runs/run-1/paused-nodes/node-1/continue", { play: false }],
      ["GET", "/api/runs/run-1/reachability", undefined],
      ["PATCH", "/api/runs/run-1/graph", {
        operations: [{ op: "update_node", nodeId: "node-1", patch: { title: "Updated" } }],
        summary: "graph edit",
      }],
    ]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
