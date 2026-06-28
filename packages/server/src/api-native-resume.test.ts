import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { listAgentSessions } from "./agentflow/agent-session-store";
import { saveRun, type RunRecord } from "./agentflow/run-store";
import { upsertLocalAgentServer } from "./agent-server-config";

describe("native resume command API", () => {
  test("returns verified native resume commands for sessions in a run", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-native-resume-api-"));
    await upsertLocalAgentServer(root, "codex-acp", {
      type: "registry",
      registryId: "codex-acp",
    });
    await saveRun(sampleRun("run-codex", "codex-acp", "acp-session-1"), root);
    const handle = createApiHandler({
      ...createSpecflowBridge(),
      listAgentRegistry: async () => ({ version: "1", agents: [] }),
    }, root);

    const response = await handle(new Request("http://specflow.test/api/runs/run-codex/native-resume-commands"));
    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      commands: Array<{ agentServerId: string; nodeTitle?: string; nativeResume: { available: boolean; displayCommand?: string; command?: string } }>;
    };
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0]).toMatchObject({
      agentServerId: "codex-acp",
      nodeTitle: "Implement",
      nativeResume: {
        available: true,
        command: "codex",
        displayCommand: "codex resume acp-session-1",
      },
    });

    const [session] = await listAgentSessions(root);
    const sessionResponse = await handle(new Request(`http://specflow.test/api/agent-sessions/${session!.id}/native-resume-command`));
    expect(sessionResponse?.status).toBe(200);
    expect(await sessionResponse!.json()).toMatchObject({
      agentSessionId: session!.id,
      nativeResume: {
        available: true,
        displayCommand: "codex resume acp-session-1",
      },
    });
  });

  test("does not invent native commands for custom agent servers", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-native-resume-custom-"));
    await upsertLocalAgentServer(root, "custom-agent", {
      type: "custom",
      command: "custom-agent",
    });
    await saveRun(sampleRun("run-custom", "custom-agent", "custom-acp-session"), root);
    const handle = createApiHandler(createSpecflowBridge(), root);

    const response = await handle(new Request("http://specflow.test/api/runs/run-custom/native-resume-commands"));
    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      commands: Array<{ nativeResume: { available: boolean; status: string; reason?: string } }>;
    };
    expect(body.commands[0]?.nativeResume).toMatchObject({
      available: false,
      status: "custom-unverified",
    });
    expect(body.commands[0]?.nativeResume.reason).toContain("custom agent server");
  });
});

function sampleRun(id: string, agentServerId: string, acpSessionId: string): RunRecord {
  const startedAt = "2026-06-28T10:00:00.000Z";
  return {
    id,
    workflowId: "wf",
    label: "Run",
    status: "success",
    startedAt,
    completedAt: "2026-06-28T10:01:00.000Z",
    agent: agentServerId,
    nodeStates: { n1: "success" },
    nodeOutputs: { n1: "done" },
    agentInvocations: [{
      id: "inv1",
      runId: id,
      nodeRunId: "node-run-1",
      nodeId: "n1",
      agentId: "agent-main",
      agentServerId,
      sessionId: "s1",
      acpSessionId,
      acpSupportsLoadSession: true,
      acpSupportsResumeSession: true,
      prompt: "prompt",
      status: "done",
      startedAt,
      completedAt: "2026-06-28T10:01:00.000Z",
      output: "done",
    }],
    agentSessions: [],
    agentflowSnapshot: {
      id: "wf",
      name: "Workflow",
      sessions: [{ id: "s1", name: "main", agentServerId }],
      nodes: [{ kind: "step", id: "n1", alias: "01", title: "Implement", prompt: "Do it", sessionId: "s1" }],
      edges: [],
    },
    canvasSnapshot: { workflowId: "wf", version: 1, nodes: [] },
    initialInput: "",
    variableValues: {},
  };
}
