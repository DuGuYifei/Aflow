export type WorkflowNodeKind = "agent" | "gate";

export type NodeStatus = "queued" | "running" | "paused" | "interrupted" | "done" | "failed" | "skipped" | "cancelled";
