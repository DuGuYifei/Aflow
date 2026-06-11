import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  appendRunLogEvent,
  deleteRunLog,
  listRunLogEvents,
  listRunTimelineRestoreEvents,
  runLogPath,
} from "./agentflow/run-log-store";

describe("run log store", () => {
  test("appends, lists, skips malformed lines, and deletes run logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-logs-"));
    await appendRunLogEvent(root, {
      type: "terminal",
      id: "terminal-1",
      runId: "run1",
      nodeId: "node-1",
      nodeRunId: "node-run-1",
      agentInvocationId: "invocation-1",
      stream: "stdout",
      sequence: 1,
      chunk: "hello",
      createdAt: "2026-05-19T00:00:00.000Z",
    });
    await appendRunLogEvent(root, {
      type: "run_status",
      runId: "run1",
      workflowId: "wf",
      status: "done",
      at: "2026-05-19T00:00:01.000Z",
    });
    await appendRunLogEvent(root, {
      type: "agent_lifecycle",
      runId: "run1",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      agentId: "agent-1",
      agentServerId: "codex-acp",
      lifecycle: {
        type: "prompt_started",
        sessionId: "acp-session",
        at: "2026-05-19T00:00:02.000Z",
      },
    });
    await appendRunLogEvent(root, {
      type: "restore_attempt",
      runId: "run1",
      agentSessionId: "session-index-entry",
      agentServerId: "codex-acp",
      acpSessionId: "acp-session",
      requestedMode: "inspect",
      selectedPrimitive: "load",
      status: "success",
      at: "2026-05-19T00:00:03.000Z",
    });
    await appendRunLogEvent(root, {
      type: "session_update",
      runId: "run1",
      nodeId: "node-1",
      nodeRunId: "node-run-1",
      agentInvocationId: "invocation-1",
      agentId: "agent-1",
      agentServerId: "codex-acp",
      sessionId: "acp-session",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "structured" } },
      at: "2026-05-19T00:00:04.000Z",
    });

    await writeFile(runLogPath(root, "run1"), "not-json\n", { flag: "a" });

    const events = await listRunLogEvents(root, "run1");
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ type: "terminal", chunk: "hello" });
    expect(events[1]).toMatchObject({ type: "run_status", status: "done" });
    expect(events[2]).toMatchObject({ type: "agent_lifecycle", lifecycle: { type: "prompt_started" } });
    expect(events[3]).toMatchObject({ type: "restore_attempt", selectedPrimitive: "load", status: "success" });
    expect(events[4]).toMatchObject({ type: "session_update", update: { sessionUpdate: "agent_message_chunk" } });

    await deleteRunLog(root, "run1");
    await expect(readFile(runLogPath(root, "run1"), "utf8")).rejects.toThrow();
    expect(await listRunLogEvents(root, "run1")).toEqual([]);
  });

  test("compacts timeline restore logs from the latest snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-logs-"));
    await appendRunLogEvent(root, {
      type: "acp_timeline",
      id: "user-1",
      at: "2026-05-19T00:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "user_message",
      text: "old prompt",
    });
    await appendRunLogEvent(root, {
      type: "acp_timeline",
      id: "snapshot-1",
      at: "2026-05-19T00:00:01.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "timeline_snapshot",
      status: "success",
      rawEventCount: 1,
      blocks: [{
        id: "block-user-1",
        at: "2026-05-19T00:00:00.000Z",
        source: "agentflow",
        scopeId: "run1",
        runId: "run1",
        kind: "message",
        role: "user",
        text: "old prompt",
      }],
    });
    await appendRunLogEvent(root, {
      type: "acp_timeline",
      id: "assistant-2",
      at: "2026-05-19T00:00:02.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "assistant_delta",
      text: "new chunk",
    });

    const events = await listRunTimelineRestoreEvents(root, "run1");
    expect(events.map((event) => event.type === "acp_timeline" ? event.id : event.type)).toEqual(["snapshot-1", "assistant-2"]);
  });
});
