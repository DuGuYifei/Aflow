import { afterEach, describe, expect, test } from "bun:test";
import { RUN_SSE_EVENTS } from "@specflow/shared";
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
      if (url.endsWith("/api/runs/run-1/best-practice")) return jsonResponse({ ok: true, workflow: { id: "saved", name: "Saved", local: true } });
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
    await client.saveRunBestPractice("run-1", { name: "Saved" });

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
      ["POST", "/api/runs/run-1/best-practice", { name: "Saved" }],
    ]);
  });

  test("streams run interaction events", async () => {
    globalThis.fetch = (async (input) => {
      const url = input instanceof URL ? input.href : String(input);
      expect(url).toBe("http://specflow.test/api/runs/run-1/events?replay=false");
      return new Response(sseStream([
        {
          event: RUN_SSE_EVENTS.hello,
          data: { type: RUN_SSE_EVENTS.hello, runId: "run-1" },
        },
        {
          event: RUN_SSE_EVENTS.interactionRequested,
          data: {
            type: RUN_SSE_EVENTS.interactionRequested,
            interaction: {
              id: "interaction-1",
              kind: "permission",
              status: "pending",
              runId: "run-1",
              agentInvocationId: "invoke-1",
              agentId: "agent-1",
              agentServerId: "codex-acp",
              createdAt: "2026-06-21T00:00:00.000Z",
              toolCall: { title: "Edit file" },
              options: [{ optionId: "allow", name: "Allow" }],
            },
          },
        },
      ]), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const client = new SpecflowClient("http://specflow.test");
    const events: string[] = [];
    await client.streamRunEvents("run-1", (event) => {
      events.push(event.type);
      if (event.type === RUN_SSE_EVENTS.interactionRequested) {
        expect(event.interaction.id).toBe("interaction-1");
      }
    }, { replay: false });

    expect(events).toEqual([RUN_SSE_EVENTS.hello, RUN_SSE_EVENTS.interactionRequested]);
  });

  test("ignores aborts while streaming run events", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      init?.signal?.addEventListener("abort", () => undefined, { once: true });
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;

    const client = new SpecflowClient("http://specflow.test");
    await expect(client.streamRunEvents("run-1", () => undefined, { signal: controller.signal })).resolves.toBeUndefined();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseStream(events: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`));
      }
      controller.close();
    },
  });
}
