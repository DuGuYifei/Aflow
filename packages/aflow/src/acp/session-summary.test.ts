import { describe, expect, test } from "bun:test";
import type { CanvasDoc } from "@specflow/server";
import type { AgentSessionRecord, RunLogEvent, RunRecordDetail } from "../server/specflow-client";
import {
  buildNodeDisplayMap,
  extractRecentConversationSnippets,
  formatRunSummary,
  sessionsForRun,
} from "./session-summary";

describe("Aflow session summary helpers", () => {
  test("formats run nodes with user-facing titles", () => {
    const nodes = buildNodeDisplayMap(sampleCanvas());
    const run: RunRecordDetail = {
      id: "run-1",
      workflowId: "workflow-1",
      status: "success",
      nodeStates: {
        plan: "success",
        review: "paused",
      },
    };

    expect(formatRunSummary(run, nodes)).toContain("01 Plan the change (plan): success");
    expect(formatRunSummary(run, nodes)).toContain("02 Review implementation (review): paused");
  });

  test("filters sessions for a run and extracts the latest two prompt/output pairs", () => {
    const session = sampleSession();
    const snippets = extractRecentConversationSnippets(sampleLogs(), session, 2);

    expect(sessionsForRun([session], "run-1")).toHaveLength(1);
    expect(snippets).toEqual([
      { user: "second prompt", assistant: "second answer" },
      { user: "third prompt", assistant: "third answer" },
    ]);
  });
});

function sampleCanvas(): CanvasDoc {
  return {
    id: "workflow-1",
    name: "Workflow",
    sessions: [{ id: "builder", name: "Builder", agentServerId: "codex-acp" }],
    nodes: [
      {
        kind: "step",
        id: "plan",
        alias: "01",
        x: 0,
        y: 0,
        w: 220,
        title: "Plan the change",
        prompt: "plan",
        sessionId: "builder",
      },
      {
        kind: "step",
        id: "review",
        alias: "02",
        x: 0,
        y: 0,
        w: 220,
        title: "Review implementation",
        prompt: "review",
        sessionId: "builder",
      },
    ],
    edges: [],
  };
}

function sampleSession(): AgentSessionRecord {
  return {
    id: "session-record-1",
    workflowId: "workflow-1",
    specflowSessionId: "builder",
    agentId: "agent-1",
    agentServerId: "codex-acp",
    acpSessionId: "acp-session-1",
    acpSupportsLoadSession: true,
    acpSupportsResumeSession: true,
    acpSupportsForkSession: false,
    acpSessionForked: false,
    firstSeenAt: "2026-06-02T00:00:00.000Z",
    lastSeenAt: "2026-06-02T00:03:00.000Z",
    latestRunId: "run-1",
    latestInvocationId: "inv-3",
    latestStatus: "done",
    runIds: ["run-1"],
    invocationIds: ["inv-1", "inv-2", "inv-3"],
    invocations: [
      {
        runId: "run-1",
        invocationId: "inv-1",
        nodeId: "plan",
        status: "done",
        startedAt: "2026-06-02T00:00:00.000Z",
      },
      {
        runId: "run-1",
        invocationId: "inv-2",
        nodeId: "plan",
        status: "done",
        startedAt: "2026-06-02T00:01:00.000Z",
      },
      {
        runId: "run-1",
        invocationId: "inv-3",
        nodeId: "review",
        status: "done",
        startedAt: "2026-06-02T00:02:00.000Z",
      },
    ],
    restoreAttempts: [],
  };
}

function sampleLogs(): RunLogEvent[] {
  return [
    prompt("inv-1", "first prompt"),
    chunk("inv-1", "first answer"),
    prompt("inv-2", "second prompt"),
    chunk("inv-2", "second answer"),
    prompt("inv-3", "third prompt"),
    chunk("inv-3", "third answer"),
  ];
}

function prompt(agentInvocationId: string, value: string): RunLogEvent {
  return {
    type: "agent_prompt",
    runId: "run-1",
    agentInvocationId,
    prompt: value,
  };
}

function chunk(agentInvocationId: string, value: string): RunLogEvent {
  return {
    type: "session_update",
    runId: "run-1",
    agentInvocationId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: value },
    },
  };
}
