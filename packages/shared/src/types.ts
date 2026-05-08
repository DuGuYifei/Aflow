export type AgentProvider = "mock" | "claude-code" | "codex";

export type WorkflowNodeKind = "agent" | "gate";

export type NodeStatus = "queued" | "running" | "done" | "failed" | "skipped";
