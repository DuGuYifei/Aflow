import { apiRunLogsToTimelineEvents, type ApiRunLogEvent } from "./api";

declare function describe(name: string, callback: () => void): void;
declare function test(name: string, callback: () => void): void;
declare const expect: {
  (value: unknown): { toEqual(expected: unknown): void };
};

describe("apiRunLogsToTimelineEvents", () => {
  test("renders agent prompts as user timeline messages", () => {
    const events: ApiRunLogEvent[] = [{
      type: "agent_prompt",
      runId: "run1",
      nodeId: "node-1",
      purpose: "node",
      agentInvocationId: "inv1",
      agentId: "agent-server-codex-acp",
      agentServerId: "codex-acp",
      specflowSessionId: "main",
      prompt: "从1数到200",
      at: "2026-05-19T10:00:00.000Z",
    }];

    expect(apiRunLogsToTimelineEvents(events)).toEqual([{
      type: "display-message",
      role: "user",
      text: "从1数到200",
      nodeId: "node-1",
      agentInvocationId: "inv1",
      specflowSessionId: "main",
    }]);
  });

  test("renders fork lifecycle events as system timeline messages", () => {
    const events: ApiRunLogEvent[] = [{
      type: "agent_lifecycle",
      runId: "run1",
      edgeId: "edge-handoff",
      purpose: "handoff",
      sourceNodeId: "review",
      targetNodeId: "implement",
      specflowSessionId: "review-fork-01",
      parentSpecflowSessionId: "review",
      agentInvocationId: "inv1",
      agentId: "agent-server-codex-acp",
      agentServerId: "codex-acp",
      lifecycle: { type: "session_forked", sessionId: "acp-fork", parentSessionId: "acp-parent" },
    }];

    expect(apiRunLogsToTimelineEvents(events)).toEqual([{
      type: "display-message",
      role: "system",
      text: "fork · handoff · review -> implement · review -> review-fork-01",
      specflowSessionId: "review",
      fork: {
        specflowSessionId: "review-fork-01",
        parentSpecflowSessionId: "review",
        purpose: "handoff",
        sourceNodeId: "review",
        targetNodeId: "implement",
        nodeId: undefined,
        agentInvocationId: "inv1",
      },
    }]);
  });

  test("keeps gate decisions attributed to their workflow session", () => {
    const events: ApiRunLogEvent[] = [{
      type: "node_status",
      runId: "run1",
      nodeId: "gate",
      specflowSessionId: "main",
      status: "done",
      gateDecision: { branchId: "pass", reason: "approved" },
      gateBranches: [
        { branchId: "pass", label: "pass", traversalsUsed: 1, maxTraversals: 1, available: false },
      ],
    }];

    expect(apiRunLogsToTimelineEvents(events)).toEqual([{
      type: "gate-decision",
      nodeId: "gate",
      specflowSessionId: "main",
      branchId: "pass",
      reason: "approved",
      branches: [
        { branchId: "pass", label: "pass", traversalsUsed: 1, maxTraversals: 1, available: false },
      ],
    }]);
  });

  test("skips timeline snapshots by default for run log display", () => {
    const events: ApiRunLogEvent[] = [{
      type: "acp_timeline",
      id: "snapshot-1",
      at: "2026-05-19T10:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "timeline_snapshot",
      status: "success",
      rawEventCount: 1,
      blocks: [{
        id: "message-1",
        at: "2026-05-19T10:00:00.000Z",
        source: "agentflow",
        scopeId: "run1",
        runId: "run1",
        kind: "message",
        role: "assistant",
        text: "already rendered raw logs",
      }],
    }, {
      type: "node_status",
      runId: "run1",
      nodeId: "gate",
      status: "done",
      gateDecision: { branchId: "pass", reason: "approved" },
    }];

    expect(apiRunLogsToTimelineEvents(events)).toEqual([{
      type: "gate-decision",
      nodeId: "gate",
      branchId: "pass",
      reason: "approved",
      branches: undefined,
    }]);
  });

  test("can keep timeline snapshots for compact restore context", () => {
    const events: ApiRunLogEvent[] = [{
      type: "acp_timeline",
      id: "snapshot-1",
      at: "2026-05-19T10:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "timeline_snapshot",
      status: "success",
      rawEventCount: 1,
      blocks: [],
    }];

    expect(apiRunLogsToTimelineEvents(events, { includeTimelineSnapshots: true })).toEqual(events);
  });
});
