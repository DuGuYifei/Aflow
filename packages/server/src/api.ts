import { WorkflowExecutor } from "@specflow/bridge";
import type { SpecflowBridge } from "@specflow/bridge";
import type { NodeStatusEvent, RunStatusEvent } from "@specflow/bridge";
import { canvasToWorkflow } from "./canvas-to-workflow";
import { listCanvases, loadCanvas, saveCanvas } from "./canvas-store";
import { formatDuration, listRuns, loadRun, saveRun, type RunRecord, type RunState } from "./run-store";

// ── simple in-process event bus ───────────────────────────────────────────────

type BusHandler = (payload: unknown) => void;

class EventBus {
  readonly #listeners = new Map<string, Set<BusHandler>>();

  on(channel: string, handler: BusHandler): () => void {
    let set = this.#listeners.get(channel);
    if (!set) {
      set = new Set();
      this.#listeners.set(channel, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(channel: string, payload: unknown): void {
    for (const handler of this.#listeners.get(channel) ?? []) {
      handler(payload);
    }
  }
}

// ── API handler factory ───────────────────────────────────────────────────────

export function createApiHandler(bridge: SpecflowBridge, root: string) {
  const bus = new EventBus();
  let runCount = 0;

  function sseResponse(runId: string): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (type: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

        enqueue("hello", { runId });

        const offNode = bus.on(`${runId}:node`, (e) => enqueue("node-status", e));
        const offRun  = bus.on(`${runId}:run`,  (e) => {
          enqueue("run-status", e);
          const ev = e as { status: string };
          if (ev.status !== "running") {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
        const offTerm = bus.on(`${runId}:term`, (e) => enqueue("terminal", e));

        // Unsubscribe when the client disconnects
        void (async () => {
          await stream.cancel;
          offNode(); offRun(); offTerm();
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  async function handleRun(workflowId: string, initialInput: string): Promise<Response> {
    let doc;
    try {
      doc = await loadCanvas(workflowId, root);
    } catch {
      return Response.json({ error: "Canvas not found" }, { status: 404 });
    }

    const workflow = canvasToWorkflow(doc);
    runCount += 1;
    const runId = crypto.randomUUID();
    const existingCount = (await listRuns(workflowId, root)).length;
    const label = `Run #${existingCount + 1}`;

    const initialNodeStates: Record<string, RunState> = {};
    for (const n of doc.nodes) {
      initialNodeStates[n.id] = "pending";
    }

    const record: RunRecord = {
      id: runId,
      workflowId,
      label,
      status: "running",
      startedAt: new Date().toISOString(),
      agent: doc.sessions[0]?.agent ?? "mock",
      nodeStates: initialNodeStates,
      canvasSnapshot: doc,
    };

    await saveRun(record, root);

    let lastTermSeq = 0;
    const flushTerminalEvents = () => {
      const all = bridge.terminalEvents.list({ runId });
      for (const te of all) {
        if (te.sequence > lastTermSeq) {
          lastTermSeq = te.sequence;
          bus.emit(`${runId}:term`, { chunk: te.chunk, stream: te.stream });
        }
      }
    };

    const onNodeStatus = (e: NodeStatusEvent) => {
      const uiStatus: RunState =
        e.status === "done" ? "success" :
        e.status === "failed" ? "error" :
        e.status === "running" ? "running" : "pending";

      record.nodeStates[e.nodeId] = uiStatus;
      if (uiStatus === "running") record.activeNode = e.nodeId;
      void saveRun(record, root);
      bus.emit(`${runId}:node`, { nodeId: e.nodeId, status: uiStatus, runId });
      flushTerminalEvents();
    };

    const onRunStatus = (e: RunStatusEvent) => {
      const completedAt = new Date().toISOString();
      record.completedAt = completedAt;
      record.duration = formatDuration(record.startedAt, completedAt);

      if (e.status === "done") {
        record.status = "success";
      } else if (e.status === "failed") {
        record.status = "error";
        record.errorMsg = e.error;
      }
      flushTerminalEvents();
      void saveRun(record, root);
      bus.emit(`${runId}:run`, { runId, status: record.status, workflowId });
    };

    const executor = new WorkflowExecutor({
      terminalEvents: bridge.terminalEvents,
      onNodeStatus,
      onRunStatus,
    });

    // Forward terminal events as they arrive by tailing new ones per node event
    // (terminal events are appended synchronously during node execution)
    void executor.run(workflow, initialInput).catch(() => { /* handled via onRunStatus */ });

    return Response.json({ runId });
  }

  return async function handleApiRequest(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const { pathname } = url;

    // GET /api/canvases
    if (request.method === "GET" && pathname === "/api/canvases") {
      const list = await listCanvases(root);
      const runs = await listRuns(undefined, root);
      const runsByWorkflow = new Map<string, number>();
      for (const r of runs) {
        runsByWorkflow.set(r.workflowId, (runsByWorkflow.get(r.workflowId) ?? 0) + 1);
      }
      return Response.json(list.map((c) => ({ ...c, runs: runsByWorkflow.get(c.id) ?? 0 })));
    }

    // GET /api/canvases/:id
    const canvasMatch = pathname.match(/^\/api\/canvases\/([^/]+)$/);
    if (canvasMatch) {
      const id = canvasMatch[1];
      if (request.method === "GET") {
        try {
          const doc = await loadCanvas(id, root);
          return Response.json(doc);
        } catch {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (request.method === "PUT") {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        await saveCanvas(id, body, root);
        return Response.json({ ok: true });
      }
    }

    // POST /api/canvases/:id/run
    const runMatch = pathname.match(/^\/api\/canvases\/([^/]+)\/run$/);
    if (runMatch && request.method === "POST") {
      const id = runMatch[1];
      let body: { initialInput?: string } = {};
      try { body = await request.json(); } catch { /* ok */ }
      return handleRun(id, body.initialInput ?? "");
    }

    // GET /api/runs  (optional ?workflowId=)
    if (request.method === "GET" && pathname === "/api/runs") {
      const workflowId = url.searchParams.get("workflowId") ?? undefined;
      const runs = await listRuns(workflowId, root);
      return Response.json(runs);
    }

    // GET /api/runs/:id
    const runIdMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runIdMatch && request.method === "GET") {
      try {
        const rec = await loadRun(runIdMatch[1], root);
        return Response.json(rec);
      } catch {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    }

    // GET /api/runs/:id/events  (SSE)
    const eventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (eventsMatch && request.method === "GET") {
      return sseResponse(eventsMatch[1]);
    }

    return null; // not handled
  };
}
