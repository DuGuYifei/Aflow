import type { WorkflowNodeKind } from "@specflow/shared";
import type { PromptTemplate } from "../schema/prompt";
import type { WorkflowResourceRef } from "../schema/resource";

export interface NodePosition {
  x: number;
  y: number;
}

export interface BaseWorkflowNode<TKind extends WorkflowNodeKind = WorkflowNodeKind> {
  id: string;
  kind: TKind;
  title: string;
  promptTemplate: PromptTemplate;
  position?: NodePosition;
}

export interface AgentNode extends BaseWorkflowNode<"agent"> {
  agentId: string;
  sessionId: string;
  pauseAfterRun?: boolean;
  images: WorkflowResourceRef[];
  relatedResources: WorkflowResourceRef[];
  /**
   * ACP session mode id to apply before this node's prompt turn (e.g. "plan").
   * When omitted, the session's current mode is kept (so cross-node
   * "stickiness" matches what the user would expect when re-entering a session).
   */
  modeId?: string;
  /**
   * ACP session config option overrides applied before this node's prompt turn.
   * Common keys: `model`, `thought_level` — see the agent's advertised
   * SessionConfigOption list.
   */
  configOptions?: Record<string, string | boolean>;
}

export interface FunctionalNode<TKind extends WorkflowNodeKind = WorkflowNodeKind>
  extends BaseWorkflowNode<TKind> {
  behavior: "functional";
}

export interface GateBranch {
  id: string;
  label: string;
  color?: string;
  description?: string;
  maxTraversals?: number;
}

export interface GateNode extends FunctionalNode<"gate"> {
  decisionCriteria: string;
  branches: GateBranch[];
  pauseAfterRun?: boolean;
  /**
   * ACP session config option overrides applied before the gate's decision
   * prompt. Mode is intentionally excluded — gates evaluate routing logic,
   * not user-facing work, so per-gate mode switching has no useful semantics.
   */
  configOptions?: Record<string, string | boolean>;
}

export type WorkflowNode = AgentNode | GateNode;
