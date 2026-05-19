import { describe, expect, test } from "bun:test";
import { RunInteractionStore } from "./interaction-store";

describe("RunInteractionStore", () => {
  test("resolves permission requests with selected option", async () => {
    const store = new RunInteractionStore();
    const seen: string[] = [];
    store.subscribe("run1", (interaction) => seen.push(`${interaction.kind}:${interaction.status}`));

    const resultPromise = store.requestPermission(context(), {
      sessionId: "acp-session",
      toolCall: { toolCallId: "tool-1", title: "Edit file" },
      options: [{ optionId: "allow", name: "Allow" }],
      raw: {},
    });

    const pending = store.list({ runId: "run1", status: "pending" })[0]!;
    expect(pending.kind).toBe("permission");

    store.resolve(pending.id, { outcome: "selected", optionId: "allow" });

    await expect(resultPromise).resolves.toEqual({ outcome: "selected", optionId: "allow" });
    expect(seen).toEqual(["permission:pending", "permission:resolved"]);
  });

  test("cancels all pending interactions for a completed run", async () => {
    const store = new RunInteractionStore();
    const permission = store.requestPermission(context(), {
      sessionId: "acp-session",
      toolCall: {},
      options: [],
      raw: {},
    });
    const elicitation = store.requestElicitation(context(), {
      mode: "form",
      message: "Need input",
      requestedSchema: { type: "object" },
    });

    store.cancelPendingForRun("run1", "run done");

    await expect(permission).resolves.toEqual({ outcome: "cancelled" });
    await expect(elicitation).resolves.toEqual({ action: "cancel" });
    expect(store.list({ runId: "run1", status: "pending" })).toEqual([]);
  });

  test("copies ACP session ids from elicitation requests", () => {
    const store = new RunInteractionStore();
    void store.requestElicitation(context(), {
      mode: "form",
      sessionId: "acp-session-from-request",
      message: "Need input",
      requestedSchema: { type: "object" },
    });

    expect(store.list({ runId: "run1", status: "pending" })[0]).toMatchObject({
      kind: "elicitation",
      acpSessionId: "acp-session-from-request",
    });
  });
});

function context() {
  return {
    runId: "run1",
    nodeRunId: "node-run-1",
    nodeId: "node-1",
    agentInvocationId: "invocation-1",
    agentId: "agent-1",
    agentServerId: "codex-acp",
    specflowSessionId: "s1",
  };
}
