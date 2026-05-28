import { describe, expect, test } from "bun:test";
import type { AgentCommandRequest, AgentCommandResult } from "@specflow/agent-proxy";
import type { AgentNode, GateNode, Workflow, WorkflowEdge, WorkflowNode } from "@specflow/workflow";
import { WorkflowExecutor, type AgentRunner } from "./executor";

const agentId = "agent-server-codex-acp";
const sessionId = "session-codex";

describe("WorkflowExecutor ACP per-node overrides", () => {
  test("forwards node.modeId and node.configOptions to the agent runner", async () => {
    let seen: AgentCommandRequest | undefined;
    const executor = new WorkflowExecutor({
      agentRunner: capture((request) => { seen = request; }),
    });
    const node = agentNode("n1", "do it");
    node.modeId = "plan";
    node.configOptions = { model: "claude-sonnet-4-5", thought_level: "high" };

    const run = await executor.run(createWorkflow({ nodes: [node], edges: [] }), "");
    expect(run.status).toBe("done");
    expect(seen?.modeId).toBe("plan");
    expect(seen?.configOptions).toEqual({ model: "claude-sonnet-4-5", thought_level: "high" });
  });

  test("omits modeId/configOptions when the node has none (preserve-previous semantics)", async () => {
    let seen: AgentCommandRequest | undefined;
    const executor = new WorkflowExecutor({ agentRunner: capture((r) => { seen = r; }) });
    await executor.run(createWorkflow({ nodes: [agentNode("n1", "do it")], edges: [] }), "");
    expect(seen?.modeId).toBeUndefined();
    expect(seen?.configOptions).toBeUndefined();
  });

  test("parses session.mcpServers JSON and forwards it to the agent runner", async () => {
    let seen: AgentCommandRequest | undefined;
    const executor = new WorkflowExecutor({ agentRunner: capture((r) => { seen = r; }) });
    const workflow = createWorkflow({ nodes: [agentNode("n1", "do it")], edges: [] });
    // Stdio is the default McpServer variant (no `type` discriminator).
    workflow.sessions[0].mcpServers = '[{"name":"fs","command":"uvx","args":["x"],"env":[]}]';

    await executor.run(workflow, "");
    expect(seen?.mcpServers).toEqual([{ name: "fs", command: "uvx", args: ["x"], env: [] }]);
  });

  test("throws a clear error for malformed session.mcpServers JSON", async () => {
    const executor = new WorkflowExecutor({ agentRunner: capture(() => {}) });
    const workflow = createWorkflow({ nodes: [agentNode("n1", "do it")], edges: [] });
    workflow.sessions[0].mcpServers = "not json {";
    const run = await executor.run(workflow, "");
    expect(run.status).toBe("failed");
    expect(run.nodeRuns[0]?.error).toContain("invalid mcpServers JSON");
  });

  test("applies the prompt transformer before sending and records the transformed prompt", async () => {
    let seenPrompt: string | undefined;
    const executor = new WorkflowExecutor({
      promptTransformer: (prompt, ctx) => `[${ctx.agentServerId}] ${prompt.toUpperCase()}`,
      agentRunner: capture((r) => { seenPrompt = r.prompt; }),
    });
    const run = await executor.run(createWorkflow({ nodes: [agentNode("n1", "hello")], edges: [] }), "");
    expect(seenPrompt).toBe("[codex-acp] HELLO");
    expect(run.agentInvocations[0]?.prompt).toBe("[codex-acp] HELLO");
  });

  test("gate nodes forward configOptions but never a modeId", async () => {
    const seen: AgentCommandRequest[] = [];
    const executor = new WorkflowExecutor({
      agentRunner: async (request): Promise<AgentCommandResult> => {
        seen.push(request);
        request.onTerminalEvent?.({ stream: "stdout", chunk: "x" });
        if (request.forkFromWorkflowSessionId) {
          return { agentServerId: request.agentServerId, exitCode: 0, output: '{"branchId":"a","reason":"ok"}' };
        }
        return { agentServerId: request.agentServerId, exitCode: 0, output: "needs gate" };
      },
    });
    const gate = gateNode("g1", ["a", "b"]);
    gate.configOptions = { model: "claude-haiku-4-5" };
    const workflow = createWorkflow({
      nodes: [agentNode("src", "src"), gate, agentNode("a", "branch a"), agentNode("b", "branch b")],
      edges: [
        { id: "e1", kind: "gate-input", sourceNodeId: "src", targetNodeId: "g1" },
        { id: "e2", kind: "trigger", sourceNodeId: "g1", targetNodeId: "a", sourcePortId: "a" },
        { id: "e3", kind: "trigger", sourceNodeId: "g1", targetNodeId: "b", sourcePortId: "b" },
      ],
    });

    await executor.run(workflow, "");
    const gateRequest = seen.find((r) => r.forkFromWorkflowSessionId);
    expect(gateRequest?.configOptions).toEqual({ model: "claude-haiku-4-5" });
    expect(gateRequest?.modeId).toBeUndefined();
  });
});

function capture(observe: (request: AgentCommandRequest) => void): AgentRunner {
  return async (request): Promise<AgentCommandResult> => {
    observe(request);
    request.onTerminalEvent?.({ stream: "stdout", chunk: "done" });
    return { agentServerId: request.agentServerId, exitCode: 0, output: "done" };
  };
}

function createWorkflow(input: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }): Workflow {
  return {
    id: "workflow",
    name: "Workflow",
    agents: [{ id: agentId, kind: "external", name: "Codex ACP", agentServerId: "codex-acp" }],
    sessions: [{ id: sessionId, name: "Mock session", agentId, createdAt: "2026-05-07T00:00:00.000Z" }],
    nodes: input.nodes,
    edges: input.edges,
  };
}

function agentNode(id: string, template: string): AgentNode {
  return {
    id,
    kind: "agent",
    title: id,
    promptTemplate: { template },
    agentId,
    sessionId,
    images: [],
    relatedResources: [],
  };
}

function gateNode(id: string, branches: string[]): GateNode {
  return {
    id,
    kind: "gate",
    title: id,
    behavior: "functional",
    promptTemplate: { template: "gate <specflow_input> <specflow_branches>" },
    decisionCriteria: "choose a branch",
    branches: branches.map((branch) => ({ id: branch, label: branch })),
  };
}
