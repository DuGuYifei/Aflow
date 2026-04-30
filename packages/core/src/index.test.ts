import { describe, expect, it } from "vitest";
import type {
  AgentCliConfig,
  EdgeType,
  NodeSessionPolicy,
  NodeExecutionStatus,
  NodeType,
  WorkflowControlDecision,
  WorkflowArtifactKind,
  WorkflowRunStatus
} from "./index.js";

describe("core domain types", () => {
  it("allows default workflow node and edge concepts", () => {
    const nodeType: NodeType = "workflow_director";
    const edgeType: EdgeType = "control_scope";

    expect(nodeType).toBe("workflow_director");
    expect(edgeType).toBe("control_scope");
  });

  it("allows Phase 1 run, artifact, execution, and agent concepts", () => {
    const runStatus: WorkflowRunStatus = "running";
    const executionStatus: NodeExecutionStatus = "completed";
    const artifactKind: WorkflowArtifactKind = "spec-context";
    const agentCli: AgentCliConfig = { cli: "codex", args: [] };

    expect(runStatus).toBe("running");
    expect(executionStatus).toBe("completed");
    expect(artifactKind).toBe("spec-context");
    expect(agentCli.cli).toBe("codex");
  });

  it("allows session policy and director decisions", () => {
    const session: NodeSessionPolicy = {
      mode: "ai_decides",
      groupId: "implementation",
      controllerNodeId: "session-director",
      newSessionOnLoop: true
    };
    const decision: WorkflowControlDecision = {
      id: "decision_1",
      runId: "run_1",
      controllerNodeId: "session-director",
      kind: "session",
      targetNodeIds: ["plan", "code-draft"],
      summary: "Reuse one implementation session.",
      sessionDecisions: [
        {
          targetNodeId: "plan",
          sessionGroupId: "implementation",
          openNewSession: true,
          reason: "Start the implementation thread."
        }
      ],
      createdAt: "2026-01-01T00:00:00.000Z"
    };

    expect(session.mode).toBe("ai_decides");
    expect(decision.kind).toBe("session");
  });
});
