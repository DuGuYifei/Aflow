import { describe, expect, test } from "bun:test";
import type { AgentFlowDoc } from "./canvas-doc";
import { assertRunnableAgentFlow, collectAgentFlowDiagnostics } from "./agentflow-validation";

describe("agentflow diagnostics", () => {
  test("keeps required variable runtime values as core diagnostics", () => {
    const diagnostics = collectAgentFlowDiagnostics({
      ...baseWorkflow(),
      variables: [{ name: "specflow_task", required: true }],
    }).diagnostics;

    expect(diagnostics.some((diagnostic) => diagnostic.code === "REQUIRED_VARIABLE_NEEDS_RUNTIME_VALUE")).toBe(true);
  });

  test("warns when a step fans out to multiple queued targets", () => {
    const workflow = baseWorkflow({
      sessions: [
        { id: "main", name: "main", agentServerId: "codex-acp" },
        { id: "left", name: "left", agentServerId: "codex-acp" },
        { id: "right", name: "right", agentServerId: "codex-acp" },
      ],
      nodes: [
        startNode(),
        stepNode("split", "main"),
        stepNode("left", "left"),
        stepNode("right", "right"),
      ],
      edges: [
        edge("start", "split"),
        edge("split", "left"),
        edge("split", "right"),
      ],
    });

    const diagnostics = collectAgentFlowDiagnostics(workflow).diagnostics;
    expect(diagnostics.some((diagnostic) => diagnostic.code === "NON_GATE_FANOUT")).toBe(true);
    assertRunnableAgentFlow(workflow);
  });

  test("warns when fan-out branches may reuse a session before joining", () => {
    const workflow = baseWorkflow({
      sessions: [
        { id: "main", name: "main", agentServerId: "codex-acp" },
        { id: "shared", name: "shared", agentServerId: "codex-acp" },
      ],
      nodes: [
        startNode(),
        stepNode("split", "main"),
        stepNode("left", "shared"),
        stepNode("right", "shared"),
      ],
      edges: [
        edge("start", "split"),
        edge("split", "left"),
        edge("split", "right"),
      ],
    });

    const diagnostics = collectAgentFlowDiagnostics(workflow).diagnostics;
    expect(diagnostics.some((diagnostic) => diagnostic.code === "FANOUT_SHARED_SESSION_REVIEW")).toBe(true);
    assertRunnableAgentFlow(workflow);
  });

  test("does not report step fan-out warnings for gate branches", () => {
    const workflow = baseWorkflow({
      nodes: [
        startNode(),
        stepNode("input", "main"),
        {
          kind: "gate",
          id: "decide",
          alias: "G1",
          title: "Decide",
          decisionCriteria: "Choose a branch.",
          branches: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }],
        },
        { kind: "end", id: "done", alias: "END", title: "Done", sessionId: null },
      ],
      edges: [
        edge("start", "input"),
        edge("input", "decide"),
        edge("decide", "done", "yes"),
        edge("decide", "done", "no"),
      ],
    });

    const diagnostics = collectAgentFlowDiagnostics(workflow).diagnostics;
    expect(diagnostics.some((diagnostic) => diagnostic.code === "NON_GATE_FANOUT")).toBe(false);
  });

  test("does not report step fan-out warnings for multiple start targets", () => {
    const workflow = baseWorkflow({
      sessions: [
        { id: "left", name: "left", agentServerId: "codex-acp" },
        { id: "right", name: "right", agentServerId: "codex-acp" },
      ],
      nodes: [
        startNode(),
        stepNode("left", "left"),
        stepNode("right", "right"),
      ],
      edges: [
        edge("start", "left"),
        edge("start", "right"),
      ],
    });

    const diagnostics = collectAgentFlowDiagnostics(workflow).diagnostics;
    expect(diagnostics.some((diagnostic) => diagnostic.code === "NON_GATE_FANOUT")).toBe(false);
    assertRunnableAgentFlow(workflow);
  });
});

function baseWorkflow(overrides: Partial<AgentFlowDoc> = {}): AgentFlowDoc {
  return {
    id: "diagnostics-flow",
    version: 2,
    name: "Diagnostics Flow",
    sessions: [{ id: "main", name: "main", agentServerId: "codex-acp" }],
    nodes: [
      startNode(),
      stepNode("step", "main"),
    ],
    edges: [edge("start", "step")],
    ...overrides,
  };
}

function startNode(): AgentFlowDoc["nodes"][number] {
  return { kind: "start", id: "start", alias: "START", title: "Start", sessionId: null };
}

function stepNode(id: string, sessionId: string): AgentFlowDoc["nodes"][number] {
  return {
    kind: "step",
    id,
    alias: id,
    title: id,
    sessionId,
    prompt: `Run ${id}.`,
  };
}

function edge(from: string, to: string, branch?: string): AgentFlowDoc["edges"][number] {
  return { id: `edge:${from}:${branch ?? ""}->${to}`, from, to, ...(branch ? { branch } : {}) };
}
