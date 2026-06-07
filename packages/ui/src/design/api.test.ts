import {
  branchDesignProjectVersion,
  fetchDesignProjectVersion,
  recordDesignProjectVersion,
  streamDesignMessage,
} from "./api";
import type { DesignLogEntry, DesignSession } from "./types";

declare function describe(name: string, callback: () => void): void;
declare function test(name: string, callback: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
};

describe("design api", () => {
  test("streams design logs and resolves the final session", async () => {
    const log: DesignLogEntry = {
      id: "log-1",
      at: "2026-06-05T00:00:00.000Z",
      kind: "user",
      title: "User message",
      text: "Design it",
    };
    const session: DesignSession = {
      id: "session-1",
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:01.000Z",
      project: { name: "demo", path: "/demo" },
      memoryInjected: true,
      messages: [],
      logs: [log],
    };
    const streamedLogs: DesignLogEntry[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(sse([
      ["ready", { ok: true }],
      ["log", log],
      ["session", session],
    ]), {
      headers: { "content-type": "text/event-stream" },
    });
    try {
      const result = await streamDesignMessage({
        projectName: "demo",
        agentServerId: "codex",
        message: "Design it",
      }, {
        onLog: (entry) => streamedLogs.push(entry),
      });

      expect(streamedLogs).toEqual([log]);
      expect(result.id).toBe("session-1");
      expect(result.logs?.[0]?.text).toBe("Design it");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("uses project version endpoints", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const state = {
      gitAvailable: true,
      initialized: true,
      dirty: false,
      commits: [],
      settings: { versionControl: { authorName: "Designer", authorEmail: "designer@example.com" } },
    };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url;
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
      });
      return Response.json(state);
    };
    try {
      await fetchDesignProjectVersion("Checkout Redesign");
      await recordDesignProjectVersion("Checkout Redesign", {
        authorName: "Designer",
        authorEmail: "designer@example.com",
        note: "baseline",
      });
      await branchDesignProjectVersion("Checkout Redesign", "abc1234", "from-baseline");

      expect(calls).toEqual([
        { url: "/api/design/projects/Checkout%20Redesign/version", method: "GET" },
        {
          url: "/api/design/projects/Checkout%20Redesign/version/commit",
          method: "POST",
          body: { authorName: "Designer", authorEmail: "designer@example.com", note: "baseline" },
        },
        {
          url: "/api/design/projects/Checkout%20Redesign/version/branch-from",
          method: "POST",
          body: { commitHash: "abc1234", branchName: "from-baseline" },
        },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

function sse(events: Array<[string, unknown]>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const [event, data] of events) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  });
}
