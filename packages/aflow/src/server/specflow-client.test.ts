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
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
