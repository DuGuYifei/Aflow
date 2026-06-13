import {
  AgentProxySessionPool,
  type AgentCommandRequest,
  type AgentCommandResult,
  type AgentLifecycleEvent,
  type AgentSessionUpdateEvent,
  type AgentTerminalEvent,
} from "@specflow/agent-proxy";
import { uuidv7, type NodeStatus } from "@specflow/shared";
import {
  assertValidAgentNodeSession,
  type AgentDefinition,
  type AgentInvocation,
  type AgentInvocationPurpose,
  type AgentNode,
  type GateDecision,
  type NodeRun,
  type TerminalStream,
  type Workflow,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@specflow/workflow";
import {
  createTaggedEdgeVariable,
  renderGatePrompt,
  renderGateRepairPrompt,
  renderHandoffPrompt,
  renderNodePrompt,
} from "./prompt-renderer";
import { buildPromptBlocksForNode } from "./prompt-blocks";
import { parseGateDecision } from "./gate-evaluator";
import { TerminalEventStore } from "./terminal-store";
import { RunInteractionStore, type RunInteractionContext } from "./interaction-store";
import { RunPauseStore } from "./pause-store";
import {
  RunControlStore,
  WorkflowInterruptedError,
  type PendingCompletionCheckpoint,
  type WorkflowExecutionCheckpoint,
} from "./run-control-store";

export interface NodeStatusEvent {
  runId: string;
  nodeId: string;
  status: NodeStatus;
  at: string;
  output?: string;
  gateDecision?: GateDecision;
  gateBranches?: GateBranchStatus[];
}

export interface GateBranchStatus {
  branchId: string;
  label: string;
  traversalsUsed: number;
  maxTraversals: number;
  available: boolean;
}

export interface RunStatusEvent {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  at: string;
  error?: string;
}

export type AgentLifecycleStatusEvent = AgentLifecycleEvent & {
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  purpose?: AgentInvocationPurpose;
  sourceNodeId?: string;
  targetNodeId?: string;
  agentInvocationId: string;
  agentId: string;
  /** Specflow session id this invocation belongs to (covers edge-handoff invocations that have no nodeId). */
  specflowSessionId?: string;
  /** Parent Specflow session id when this invocation successfully forks. */
  parentSpecflowSessionId?: string;
};

export type AgentSessionUpdateStatusEvent = AgentSessionUpdateEvent & {
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  purpose?: AgentInvocationPurpose;
  sourceNodeId?: string;
  targetNodeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  at: string;
  /** Specflow session id this invocation belongs to (covers edge-handoff invocations that have no nodeId). */
  specflowSessionId?: string;
};

export interface AgentPromptStatusEvent {
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  purpose?: AgentInvocationPurpose;
  sourceNodeId?: string;
  targetNodeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  prompt: string;
  at: string;
}

export interface WorkflowExecutorOptions {
  cwd?: string;
  terminalEvents?: TerminalEventStore;
  interactions?: RunInteractionStore;
  pauses?: RunPauseStore;
  runControls?: RunControlStore;
  agentRunner?: AgentRunner;
  onNodeStatus?: (event: NodeStatusEvent) => void;
  onRunStatus?: (event: RunStatusEvent) => void;
  onCheckpoint?: (event: WorkflowCheckpointEvent) => void | Promise<void>;
  onAgentLifecycle?: (event: AgentLifecycleStatusEvent) => void;
  onAgentSessionUpdate?: (event: AgentSessionUpdateStatusEvent) => void;
  onAgentPrompt?: (event: AgentPromptStatusEvent) => void;
  /**
   * Optional pre-flight on each prompt. Receives the rendered node prompt
   * plus the agent server id; returns the text that should actually be sent
   * to the agent. Used by the server to apply slash command / skill body
   * injection without coupling the executor to the skills module.
   */
  promptTransformer?: PromptTransformer;
}

export interface PromptTransformContext {
  agentServerId: string;
  /** Workflow node the prompt originates from (or `undefined` for handoff edges). */
  nodeId?: string;
  /** Workflow edge id when the prompt is a handoff between sessions. */
  edgeId?: string;
}

export type PromptTransformer = (prompt: string, context: PromptTransformContext) => Promise<string> | string;

export type AgentRunner = (request: AgentCommandRequest) => Promise<AgentCommandResult>;

export interface WorkflowRunOptions {
  runId?: string;
  signal?: AbortSignal;
  resumeFrom?: WorkflowResumeState;
  checkpoint?: WorkflowExecutionCheckpoint;
  reloadWorkflow?: () => Workflow | Promise<Workflow>;
}

export interface WorkflowCheckpointEvent {
  runId: string;
  workflowId: string;
  status: "paused" | "interrupted";
  checkpoint: WorkflowExecutionCheckpoint;
  at: string;
  nodeId?: string;
  reason?: string;
}

/**
 * Snapshot of a previous run that lets a new executor pick up where it left off.
 * Built from a persisted RunRecord plus the JSONL run log.
 */
export interface WorkflowResumeState {
  /** Node-id → status as recorded by the prior run. */
  nodeStates: Record<string, "done" | "success" | "running" | "paused" | "failed" | "error" | "cancelled" | "pending">;
  /** Node-id → output text (for nodes that finished cleanly). */
  nodeOutputs: Record<string, string>;
  /** Gate-node-id → which branch was chosen previously. */
  gateDecisions?: Record<string, { branchId: string }>;
  /** Workflow sessionId → existing ACP sessionId. The executor uses load/resume on first prompt. */
  acpSessionByWorkflowSession: Record<string, string>;
  /** `${gateNodeId}:${branchId}` → traversal count, to honor loop bounds across resumes. */
  branchTraversals?: Record<string, number>;
}

interface TransferOrigin {
  agentId: string;
  sessionId: string;
  output: string;
}

interface NodeExecutionResult {
  output: string;
  origin: TransferOrigin;
  chosenBranchId?: string;
  nodeRunId?: string;
  gateDecision?: GateDecision;
  gateBranches?: GateBranchStatus[];
  alreadyCommitted?: boolean;
}

interface PendingNodeInput {
  input: string[];
  edgeValues: Record<string, string>;
  origin?: TransferOrigin;
}

interface QueuedNode {
  nodeId: string;
  traversal: number;
}

class WorkflowCancelledError extends Error {
  constructor() {
    super("Workflow run cancelled.");
    this.name = "WorkflowCancelledError";
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new WorkflowCancelledError();
}

function combineAbortSignals(left: AbortSignal | undefined, right: AbortSignal | undefined): AbortSignal | undefined {
  if (!left) return right;
  if (!right) return left;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (left.aborted || right.aborted) {
    abort();
    return controller.signal;
  }
  left.addEventListener("abort", abort, { once: true });
  right.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function createExecutionCheckpoint(input: {
  queue: QueuedNode[];
  pendingInputs: Map<string, PendingNodeInput>;
  completedNodes: Set<string>;
  completedExecutions: Set<string>;
  skippedNodes: Set<string>;
  inactiveEdges: Set<string>;
  branchTraversals: Map<string, number>;
  activeNodeId?: string;
  interruptedNodeId?: string;
  interruptedExecutionKey?: string;
  suspension?: WorkflowExecutionCheckpoint["suspension"];
  pendingCompletion?: PendingCompletionCheckpoint;
  reason?: string;
}): WorkflowExecutionCheckpoint {
  return {
    queue: input.queue.map((queued) => ({ ...queued })),
    pendingInputs: Object.fromEntries([...input.pendingInputs.entries()].map(([key, value]) => [
      key,
      {
        input: [...value.input],
        edgeValues: { ...value.edgeValues },
        ...(value.origin ? { origin: { ...value.origin } } : {}),
      },
    ])),
    completedNodeIds: [...input.completedNodes],
    completedExecutionKeys: [...input.completedExecutions],
    skippedNodeIds: [...input.skippedNodes],
    inactiveEdgeIds: [...input.inactiveEdges],
    branchTraversals: Object.fromEntries(input.branchTraversals),
    ...(input.activeNodeId ? { activeNodeId: input.activeNodeId } : {}),
    ...(input.interruptedNodeId ? { interruptedNodeId: input.interruptedNodeId } : {}),
    ...(input.interruptedExecutionKey ? { interruptedExecutionKey: input.interruptedExecutionKey } : {}),
    ...(input.suspension ? { suspension: input.suspension } : {}),
    ...(input.pendingCompletion ? { pendingCompletion: input.pendingCompletion } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    createdAt: new Date().toISOString(),
  };
}

export class WorkflowExecutor {
  readonly #cwd: string;
  readonly #terminalEvents: TerminalEventStore;
  readonly #interactions: RunInteractionStore;
  readonly #pauses: RunPauseStore | undefined;
  readonly #runControls: RunControlStore | undefined;
  readonly #agentRunnerOverride: AgentRunner | undefined;
  readonly #onNodeStatus: ((event: NodeStatusEvent) => void) | undefined;
  readonly #onRunStatus: ((event: RunStatusEvent) => void) | undefined;
  readonly #onCheckpoint: ((event: WorkflowCheckpointEvent) => void | Promise<void>) | undefined;
  readonly #onAgentLifecycle: ((event: AgentLifecycleStatusEvent) => void) | undefined;
  readonly #onAgentSessionUpdate: ((event: AgentSessionUpdateStatusEvent) => void) | undefined;
  readonly #onAgentPrompt: ((event: AgentPromptStatusEvent) => void) | undefined;
  readonly #promptTransformer: PromptTransformer | undefined;
  readonly #forkCounts = new Map<string, number>();

  constructor(options: WorkflowExecutorOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#terminalEvents = options.terminalEvents ?? new TerminalEventStore();
    this.#interactions = options.interactions ?? new RunInteractionStore();
    this.#pauses = options.pauses;
    this.#runControls = options.runControls;
    this.#agentRunnerOverride = options.agentRunner;
    this.#onNodeStatus = options.onNodeStatus;
    this.#onRunStatus = options.onRunStatus;
    this.#onCheckpoint = options.onCheckpoint;
    this.#onAgentLifecycle = options.onAgentLifecycle;
    this.#onAgentSessionUpdate = options.onAgentSessionUpdate;
    this.#onAgentPrompt = options.onAgentPrompt;
    this.#promptTransformer = options.promptTransformer;
  }

  get terminalEvents(): TerminalEventStore {
    return this.#terminalEvents;
  }

  get interactions(): RunInteractionStore {
    return this.#interactions;
  }

  async run(workflow: Workflow, initialInput = "", options: WorkflowRunOptions = {}): Promise<WorkflowRun> {
    const sessionPool = this.#agentRunnerOverride ? undefined : new AgentProxySessionPool({ root: this.#cwd });
    const baseAgentRunner = this.#agentRunnerOverride ?? ((request: AgentCommandRequest) => sessionPool!.run(request));
    // Inject restoreFromAcpSessionId on the first prompt for any workflow session
    // that already has a recorded ACP session from a prior run.
    const sessionRestoreMap = new Map<string, string>(
      Object.entries(options.resumeFrom?.acpSessionByWorkflowSession ?? {}),
    );
    const restoredSessions = new Set<string>();
    const agentRunner: AgentRunner = async (request) => {
      const wsid = request.workflowSessionId;
      if (wsid && !restoredSessions.has(wsid)) {
        const acpSessionId = sessionRestoreMap.get(wsid);
        if (acpSessionId) {
          restoredSessions.add(wsid);
          return baseAgentRunner({ ...request, restoreFromAcpSessionId: acpSessionId });
        }
      }
      return baseAgentRunner(request);
    };
    const run: WorkflowRun = {
      id: options.runId ?? uuidv7(),
      workflowId: workflow.id,
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: [],
      agentInvocations: [],
    };
    this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "running", at: run.startedAt! });

    try {
      throwIfCancelled(options.signal);
      let activeWorkflow = workflow;
      let nodesById = new Map(activeWorkflow.nodes.map((node) => [node.id, node]));
      let incomingEdgesByTarget = groupEdgesByTarget(activeWorkflow.edges);
      let outgoingEdgesBySource = groupEdgesBySource(activeWorkflow.edges);
      let rerunnableGateIds = findRerunnableGateIds(activeWorkflow);
      let recurringBranchEdgeIds = findRecurringBranchEdgeIds(activeWorkflow);
      const reloadWorkflow = async () => {
        if (!options.reloadWorkflow) return;
        activeWorkflow = await options.reloadWorkflow();
        nodesById = new Map(activeWorkflow.nodes.map((node) => [node.id, node]));
        incomingEdgesByTarget = groupEdgesByTarget(activeWorkflow.edges);
        outgoingEdgesBySource = groupEdgesBySource(activeWorkflow.edges);
        rerunnableGateIds = findRerunnableGateIds(activeWorkflow);
        recurringBranchEdgeIds = findRecurringBranchEdgeIds(activeWorkflow);
      };
      const checkpoint = options.checkpoint;
      const pendingInputs = new Map<string, PendingNodeInput>(
        checkpoint
          ? Object.entries(checkpoint.pendingInputs).map(([key, value]) => [key, {
              input: [...value.input],
              edgeValues: { ...value.edgeValues },
              ...(value.origin ? { origin: { ...value.origin } } : {}),
            }])
          : [],
      );
      const queue: QueuedNode[] = checkpoint
        ? checkpoint.queue.map((queued) => ({ ...queued }))
        : findEntryNodes(activeWorkflow).map((node) => ({ nodeId: node.id, traversal: 0 }));
      const completedNodes = new Set<string>(checkpoint?.completedNodeIds ?? []);
      const completedExecutions = new Set<string>(checkpoint?.completedExecutionKeys ?? []);
      const skippedNodes = new Set<string>(checkpoint?.skippedNodeIds ?? []);
      const inactiveEdges = new Set<string>(checkpoint?.inactiveEdgeIds ?? []);
      const branchTraversals = new Map<string, number>(Object.entries(checkpoint?.branchTraversals ?? {}));
      const interruptedExecutions = new Set<string>(checkpoint?.interruptedExecutionKey ? [checkpoint.interruptedExecutionKey] : []);

      // Resume bootstrap: classify each node by its prior status.
      //   - "done"/"success"   → use persisted output, fire downstream edges without re-invoking agent
      //   - "running"/"paused"/"failed"/"error"/"cancelled" → re-invoke with continuation prompt
      //   - anything else      → execute normally
      const resumeFrom = options.resumeFrom;
      const completedFromResume = new Set<string>();
      const interruptedFromResume = new Set<string>();
      const resumeOutputs = new Map<string, string>(Object.entries(resumeFrom?.nodeOutputs ?? {}));
      const resumeGateDecisions = new Map<string, { branchId: string }>(Object.entries(resumeFrom?.gateDecisions ?? {}));
      if (resumeFrom) {
        for (const [nodeId, state] of Object.entries(resumeFrom.nodeStates)) {
          if (state === "done" || state === "success") {
            if (resumeOutputs.has(nodeId)) {
              completedFromResume.add(nodeId);
            } else {
              interruptedFromResume.add(nodeId);
            }
          } else if (state === "running" || state === "paused" || state === "failed" || state === "error" || state === "cancelled") {
            interruptedFromResume.add(nodeId);
          }
          // "pending" / unknown → fall through to normal execution
        }
        // Re-seed already-used branch traversal counts so gate loop bounds carry across resumes.
        for (const [key, count] of Object.entries(resumeFrom.branchTraversals ?? {})) {
          branchTraversals.set(key, count);
        }
      }

      if (!checkpoint) {
        for (const entryNode of findEntryNodes(activeWorkflow)) {
          pendingInputs.set(executionKey(entryNode.id, 0), { input: [initialInput], edgeValues: {} });
        }
      }

      const commitNodeResult = async (input: {
        queued: QueuedNode;
        node: WorkflowNode;
        nodeResult: NodeExecutionResult;
      }) => {
        const key = executionKey(input.queued.nodeId, input.queued.traversal);
        if (!input.nodeResult.alreadyCommitted) {
          const nodeRun = input.nodeResult.nodeRunId
            ? run.nodeRuns.find((candidate) => candidate.id === input.nodeResult.nodeRunId)
            : [...run.nodeRuns].reverse().find((candidate) => candidate.nodeId === input.node.id);
          const completedAt = new Date().toISOString();
          if (nodeRun) {
            nodeRun.status = "done";
            nodeRun.output = input.nodeResult.output;
            nodeRun.completedAt = completedAt;
            if (input.nodeResult.gateDecision) nodeRun.gateDecision = input.nodeResult.gateDecision;
          }
          this.#onNodeStatus?.({
            runId: run.id,
            nodeId: input.node.id,
            status: "done",
            at: completedAt,
            output: input.nodeResult.output,
            ...(input.nodeResult.gateDecision ? { gateDecision: input.nodeResult.gateDecision } : {}),
            ...(input.nodeResult.gateBranches ? { gateBranches: input.nodeResult.gateBranches } : {}),
          });
        }

        completedExecutions.add(key);
        if (input.queued.traversal === 0) completedNodes.add(input.node.id);

        const outgoingEdges = outgoingEdgesBySource.get(input.node.id) ?? [];
        let selectedEdges = outgoingEdges;
        if (input.node.kind === "gate") {
          const branchKey = `${input.node.id}:${input.nodeResult.chosenBranchId}`;
          branchTraversals.set(branchKey, (branchTraversals.get(branchKey) ?? 0) + 1);
          selectedEdges = outgoingEdges.filter((edge) => edge.sourcePortId === input.nodeResult.chosenBranchId);
          const supportsRerun = rerunnableGateIds.has(input.node.id);
          const continuesLoop = selectedEdges.some((edge) => recurringBranchEdgeIds.has(edge.id));
          if ((!supportsRerun || !continuesLoop) && input.queued.traversal === 0) {
            for (const edge of outgoingEdges) {
              if (edge.sourcePortId === input.nodeResult.chosenBranchId) continue;
              deactivateEdgeAndDependents({
                edge,
                inactiveEdges,
                skippedNodes,
                incomingEdgesByTarget,
                outgoingEdgesBySource,
                queue,
              });
            }
          }
        }
        for (const edge of selectedEdges) {
          if (inactiveEdges.has(edge.id)) continue;
          const targetTraversal = edge.loopback ? input.queued.traversal + 1 : input.queued.traversal;
          const targetKey = executionKey(edge.targetNodeId, targetTraversal);
          const target = pendingInputs.get(targetKey) ?? { input: [], edgeValues: {} };
          if (edge.kind === "gate-input") {
            target.input.push(input.nodeResult.origin.output);
            target.origin = input.nodeResult.origin;
          } else if (edge.kind === "tagged-output") {
            const taggedContent = await this.#resolveTaggedEdgeContent({
              workflow,
              agentRunner,
              run,
              edge,
              origin: input.nodeResult.origin,
              signal: options.signal,
            });
            Object.assign(target.edgeValues, createTaggedEdgeVariable(edge, taggedContent));
          }
          pendingInputs.set(targetKey, target);
          queue.push({ nodeId: edge.targetNodeId, traversal: targetTraversal });
        }
      };

      const pendingCompletionToResult = (pendingCompletion: PendingCompletionCheckpoint): NodeExecutionResult => ({
        output: pendingCompletion.output,
        origin: pendingCompletion.origin ?? { agentId: "checkpoint", sessionId: pendingCompletion.nodeId, output: pendingCompletion.output },
        chosenBranchId: pendingCompletion.chosenBranchId,
        nodeRunId: pendingCompletion.nodeRunId,
        gateDecision: pendingCompletion.gateDecision,
        gateBranches: pendingCompletion.gateBranches,
      });

      const buildPendingCompletion = (input: {
        queued: QueuedNode;
        key: string;
        nodeResult: NodeExecutionResult;
      }): PendingCompletionCheckpoint => ({
        nodeId: input.queued.nodeId,
        traversal: input.queued.traversal,
        executionKey: input.key,
        ...(input.nodeResult.nodeRunId ? { nodeRunId: input.nodeResult.nodeRunId } : {}),
        output: input.nodeResult.output,
        origin: { ...input.nodeResult.origin },
        ...(input.nodeResult.chosenBranchId ? { chosenBranchId: input.nodeResult.chosenBranchId } : {}),
        ...(input.nodeResult.gateDecision ? { gateDecision: input.nodeResult.gateDecision } : {}),
        ...(input.nodeResult.gateBranches ? { gateBranches: input.nodeResult.gateBranches.map((branch) => ({ ...branch })) } : {}),
      });

      if (checkpoint?.pendingCompletion) {
        const node = nodesById.get(checkpoint.pendingCompletion.nodeId);
        if (!node) throw new Error(`Checkpoint references missing node "${checkpoint.pendingCompletion.nodeId}".`);
        await commitNodeResult({
          queued: {
            nodeId: checkpoint.pendingCompletion.nodeId,
            traversal: checkpoint.pendingCompletion.traversal,
          },
          node,
          nodeResult: pendingCompletionToResult(checkpoint.pendingCompletion),
        });
        await reloadWorkflow();
      }

      while (queue.length > 0) {
        throwIfCancelled(options.signal);
        if (this.#runControls?.isPauseAtSafePointRequested(run.id)) {
          const checkpoint = createExecutionCheckpoint({
            queue,
            pendingInputs,
            completedNodes,
            completedExecutions,
            skippedNodes,
            inactiveEdges,
            branchTraversals,
            suspension: {
              kind: "safe_point_pause",
              source: "player",
            },
          });
          await this.#waitForRunPlay({
            run,
            workflow: activeWorkflow,
            status: "paused",
            checkpoint,
            signal: options.signal,
          });
          await reloadWorkflow();
          continue;
        }
        const queued = queue.shift();
        if (!queued) continue;
        const key = executionKey(queued.nodeId, queued.traversal);
        if (completedExecutions.has(key) || (queued.traversal === 0 && skippedNodes.has(queued.nodeId))) continue;
        const node = nodesById.get(queued.nodeId);
        if (!node) throw new Error(`Workflow references missing node "${queued.nodeId}".`);

        const incomingEdges = incomingEdgesByTarget.get(node.id) ?? [];
        if (queued.traversal === 0 && !isNodeReady(incomingEdges, completedNodes, inactiveEdges)) {
          queue.push(queued);
          continue;
        }

        const executableNode = node.kind === "gate"
          ? gateWithAvailableBranches(node, branchTraversals)
          : node;
        const pending = pendingInputs.get(key) ?? { input: [], edgeValues: {} };
        // Resume short-circuit: if this node finished successfully in a prior
        // run AND we have its persisted output, skip the agent invocation and
        // synthesize the result from the recorded data. Only applies to the
        // first traversal — gate loopbacks must re-execute against the live
        // branch state.
        const useResumeShortcut = queued.traversal === 0
          && completedFromResume.has(node.id)
          && resumeOutputs.has(node.id);
        const isInterrupted = queued.traversal === 0 && interruptedFromResume.has(node.id);
        let nodeResult: NodeExecutionResult;
        const activationControl = this.#runControls?.registerActivation({
          runId: run.id,
          nodeId: node.id,
          nodeKind: executableNode.kind,
          traversal: queued.traversal,
          executionKey: key,
          phase: "executing",
        });
        try {
          if (useResumeShortcut) {
            nodeResult = this.#synthesizeResumeResult({
              run,
              node,
              output: resumeOutputs.get(node.id)!,
              chosenBranchId: node.kind === "gate" ? resumeGateDecisions.get(node.id)?.branchId : undefined,
              origin: pending.origin,
            });
          } else {
            nodeResult = await this.#executeNode({
              agentRunner,
              workflow: activeWorkflow,
              run,
              node: executableNode,
              gateBranches: node.kind === "gate" ? gateBranchStatuses(node, branchTraversals) : undefined,
              input: pending.input.filter(Boolean).join("\n\n"),
              edgeValues: pending.edgeValues,
              origin: pending.origin,
              signal: options.signal,
              resumeMode: isInterrupted || interruptedExecutions.has(key) ? "continuation" : undefined,
            });
            interruptedExecutions.delete(key);
          }
        } catch (error) {
          activationControl?.unregister();
          if (!(error instanceof WorkflowInterruptedError)) throw error;
          interruptedExecutions.add(key);
          queue.unshift(queued);
          const checkpoint = createExecutionCheckpoint({
            queue,
            pendingInputs,
            completedNodes,
            completedExecutions,
            skippedNodes,
            inactiveEdges,
            branchTraversals,
            activeNodeId: node.id,
            interruptedNodeId: node.id,
            interruptedExecutionKey: key,
            suspension: {
              kind: "interrupt",
              source: "interrupt",
              nodeId: node.id,
              traversal: queued.traversal,
              executionKey: key,
              agentInvocationId: error.agentInvocationId,
              reason: error.message,
            },
            reason: error.message,
          });
          await this.#waitForRunPlay({
            run,
            workflow: activeWorkflow,
            status: "interrupted",
            checkpoint,
            signal: options.signal,
            nodeId: node.id,
            reason: error.message,
          });
          await reloadWorkflow();
          continue;
        }
        try {
          activationControl?.setPhase("completing");
          if (nodeResult.nodeRunId) activationControl?.setNodeRunId(nodeResult.nodeRunId);
          const authoredPause = Boolean((executableNode as WorkflowNode & { pauseAfterRun?: boolean }).pauseAfterRun);
          const requestedPause = this.#runControls?.consumePauseAfterActivation(run.id, key) === true;
          if (!useResumeShortcut && (authoredPause || requestedPause)) {
            const pendingCompletion = buildPendingCompletion({ queued, key, nodeResult });
            const checkpoint = createExecutionCheckpoint({
              queue,
              pendingInputs,
              completedNodes,
              completedExecutions,
              skippedNodes,
              inactiveEdges,
              branchTraversals,
              activeNodeId: node.id,
              suspension: {
                kind: "pause_after_activation",
                source: requestedPause ? "player" : "node_property",
                nodeId: node.id,
                traversal: queued.traversal,
                executionKey: key,
              },
              pendingCompletion,
            });
            const pausedAt = new Date().toISOString();
            const nodeRun = nodeResult.nodeRunId
              ? run.nodeRuns.find((candidate) => candidate.id === nodeResult.nodeRunId)
              : undefined;
            let pauseContinuation: Promise<string | undefined> | undefined;
            if (nodeRun) {
              nodeRun.status = "paused";
              nodeRun.output = nodeResult.output;
            }
            if (this.#pauses && executableNode.kind === "agent" && nodeRun) {
              pauseContinuation = this.#pauses.waitForContinuation({
                runId: run.id,
                nodeId: executableNode.id,
                specflowSessionId: executableNode.sessionId,
                agentServerId: resolveAgentServerId(activeWorkflow.agents.find((agent) => agent.id === executableNode.agentId)!),
                pausedAt,
              }, async (prompt, signal) => {
                const invocation = this.#createInvocation({
                  run,
                  agentId: executableNode.agentId,
                  sessionId: executableNode.sessionId,
                  nodeRun,
                  prompt,
                });
                const output = await this.#invokeAgent({
                  workflow: activeWorkflow,
                  agentRunner,
                  run,
                  invocation,
                  agentId: executableNode.agentId,
                  prompt,
                  signal: combineAbortSignals(options.signal, signal),
                });
                pendingCompletion.output = output;
                pendingCompletion.origin = { agentId: executableNode.agentId, sessionId: executableNode.sessionId, output };
                return output;
              }, options.signal).catch(() => undefined);
            }
            this.#onNodeStatus?.({
              runId: run.id,
              nodeId: node.id,
              status: "paused",
              at: pausedAt,
              output: nodeResult.output,
              ...(nodeResult.gateDecision ? { gateDecision: nodeResult.gateDecision } : {}),
              ...(nodeResult.gateBranches ? { gateBranches: nodeResult.gateBranches } : {}),
            });
            await this.#waitForRunPlay({
              run,
              workflow: activeWorkflow,
              status: "paused",
              checkpoint,
              signal: options.signal,
              nodeId: node.id,
            });
            if (!this.#runControls && pauseContinuation) {
              await pauseContinuation;
            }
            await reloadWorkflow();
            nodeResult = pendingCompletionToResult(pendingCompletion);
          }
          await commitNodeResult({ queued, node, nodeResult });
        } finally {
          activationControl?.unregister();
        }
      }

      run.status = "done";
      run.completedAt = new Date().toISOString();
      this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "done", at: run.completedAt });
      return run;
    } catch (error) {
      const cancelled = error instanceof WorkflowCancelledError || options.signal?.aborted;
      run.status = cancelled ? "cancelled" : "failed";
      run.completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.#terminalEvents.append({ runId: run.id, stream: "system", chunk: message });
      this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: run.status, at: run.completedAt, error: message });
      return run;
    } finally {
      await sessionPool?.closeAll();
    }
  }

  async #waitForRunPlay(input: {
    run: WorkflowRun;
    workflow: Workflow;
    status: "paused" | "interrupted";
    checkpoint: WorkflowExecutionCheckpoint;
    signal?: AbortSignal;
    nodeId?: string;
    reason?: string;
  }): Promise<void> {
    if (!this.#runControls) return;
    const at = new Date().toISOString();
    await this.#onCheckpoint?.({
      runId: input.run.id,
      workflowId: input.workflow.id,
      status: input.status,
      checkpoint: input.checkpoint,
      at,
      nodeId: input.nodeId,
      reason: input.reason,
    });
    this.#onRunStatus?.({
      runId: input.run.id,
      workflowId: input.workflow.id,
      status: input.status,
      at,
      error: input.reason,
    });
    await this.#runControls.waitForPlay(input.run.id, input.status, input.checkpoint, input.signal);
    const resumedAt = new Date().toISOString();
    this.#onRunStatus?.({
      runId: input.run.id,
      workflowId: input.workflow.id,
      status: "running",
      at: resumedAt,
    });
  }

  #synthesizeResumeResult(input: {
    run: WorkflowRun;
    node: WorkflowNode;
    output: string;
    chosenBranchId?: string;
    origin?: TransferOrigin;
  }): NodeExecutionResult {
    // Record a synthetic nodeRun so downstream consumers (saveRun, logs) see
    // the resumed node in the same shape as a freshly-executed one.
    const occurredAt = new Date().toISOString();
    input.run.nodeRuns.push({
      id: uuidv7(),
      nodeId: input.node.id,
      status: "done",
      startedAt: occurredAt,
      completedAt: occurredAt,
      output: input.output,
      ...(input.chosenBranchId ? { gateDecision: { branchId: input.chosenBranchId } } : {}),
    });
    this.#onNodeStatus?.({
      runId: input.run.id,
      nodeId: input.node.id,
      status: "running",
      at: occurredAt,
    });
    this.#onNodeStatus?.({
      runId: input.run.id,
      nodeId: input.node.id,
      status: "done",
      at: occurredAt,
      output: input.output,
      ...(input.chosenBranchId ? { gateDecision: { branchId: input.chosenBranchId } } : {}),
    });
    if (input.node.kind === "agent") {
      return {
        output: input.output,
        origin: { agentId: input.node.agentId, sessionId: input.node.sessionId, output: input.output },
        alreadyCommitted: true,
      };
    }
    if (!input.origin) {
      // Resume of a gate without a preceding origin (e.g. first run lost the
      // chain context): fall back to a synthetic origin from the gate itself.
      return {
        output: input.output,
        origin: { agentId: "gate", sessionId: input.node.id, output: input.output },
        chosenBranchId: input.chosenBranchId,
        gateDecision: input.chosenBranchId ? { branchId: input.chosenBranchId } : undefined,
        alreadyCommitted: true,
      };
    }
    return {
      output: input.output,
      origin: input.origin,
      chosenBranchId: input.chosenBranchId,
      gateDecision: input.chosenBranchId ? { branchId: input.chosenBranchId } : undefined,
      alreadyCommitted: true,
    };
  }

  async #executeNode(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    node: WorkflowNode;
    gateBranches?: GateBranchStatus[];
    input: string;
    edgeValues: Record<string, string>;
    origin?: TransferOrigin;
    signal?: AbortSignal;
    resumeMode?: "continuation";
  }): Promise<NodeExecutionResult> {
    throwIfCancelled(input.signal);
    const nodeRun: NodeRun = {
      id: uuidv7(),
      nodeId: input.node.id,
      status: "running",
      startedAt: new Date().toISOString(),
      input: input.input,
    };
    input.run.nodeRuns.push(nodeRun);
    this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "running", at: nodeRun.startedAt! });

    try {
      if (input.node.kind === "agent") {
        const output = await this.#executeAgentNode({ ...input, node: input.node, nodeRun, resumeMode: input.resumeMode });
        nodeRun.output = output;
        return {
          output,
          origin: { agentId: input.node.agentId, sessionId: input.node.sessionId, output },
          nodeRunId: nodeRun.id,
        };
      }
      if (!input.origin) throw new Error(`Gate node "${input.node.id}" requires one upstream step output.`);
      const origin = input.origin;
      const prompt = renderGatePrompt(input.node, origin.output);
      let { output, invocation } = await this.#invokeForkableFromOrigin({
        workflow: input.workflow,
        agentRunner: input.agentRunner,
        run: input.run,
        nodeRun,
        origin,
        prompt,
        purpose: "gate",
        signal: input.signal,
        configOptions: input.node.configOptions,
      });
      let decision: GateDecision;
      try {
        decision = parseGateDecision(input.node, output);
      } catch (error) {
        const repaired = await this.#repairGateDecision({
          workflow: input.workflow,
          agentRunner: input.agentRunner,
          run: input.run,
          nodeRun,
          node: input.node,
          origin,
          previousInvocation: invocation,
          invalidOutput: output,
          error,
          signal: input.signal,
        });
        output = repaired.output;
        invocation = repaired.invocation;
        decision = repaired.decision;
      }
      const gateBranches = input.gateBranches?.map((branch) => {
        if (branch.branchId !== decision.branchId) return branch;
        const traversalsUsed = branch.traversalsUsed + 1;
        return { ...branch, traversalsUsed, available: traversalsUsed < branch.maxTraversals };
      });
      nodeRun.output = output;
      nodeRun.gateDecision = decision;
      nodeRun.sessionId = invocation.sessionId;
      nodeRun.agentInvocationId = invocation.id;
      return {
        output,
        origin: input.origin,
        chosenBranchId: decision.branchId,
        nodeRunId: nodeRun.id,
        gateDecision: decision,
        gateBranches,
      };
    } catch (error) {
      if (error instanceof WorkflowInterruptedError) {
        nodeRun.status = "interrupted";
        nodeRun.error = error.message;
        nodeRun.completedAt = new Date().toISOString();
        this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "interrupted", at: nodeRun.completedAt });
        throw error;
      }
      nodeRun.status = "failed";
      nodeRun.error = error instanceof Error ? error.message : String(error);
      nodeRun.completedAt = new Date().toISOString();
      this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "failed", at: nodeRun.completedAt });
      throw error;
    }
  }

  async #executeAgentNode(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun: NodeRun;
    node: AgentNode;
    input: string;
    edgeValues: Record<string, string>;
    signal?: AbortSignal;
    resumeMode?: "continuation";
  }): Promise<string> {
    assertValidAgentNodeSession(input.workflow, input.node);
    const originalPrompt = renderNodePrompt({ node: input.node, input: input.input, edgeValues: input.edgeValues });
    const prompt = input.resumeMode === "continuation"
      ? buildWorkflowContinuationPrompt({ nodeTitle: input.node.title, originalTask: originalPrompt })
      : originalPrompt;
    const promptBlocks = await buildPromptBlocksForNode({ node: input.node, prompt, cwd: this.#cwd });
    const invocation = this.#createInvocation({
      run: input.run,
      nodeRun: input.nodeRun,
      agentId: input.node.agentId,
      sessionId: input.node.sessionId,
      prompt,
    });
    input.nodeRun.sessionId = input.node.sessionId;
    input.nodeRun.agentInvocationId = invocation.id;
    const sessionDef = input.workflow.sessions.find((candidate) => candidate.id === input.node.sessionId);
    const mcpServers = parseMcpServersField(sessionDef?.mcpServers, sessionDef?.id ?? input.node.sessionId);
    return this.#invokeAgent({
      workflow: input.workflow,
      agentRunner: input.agentRunner,
      run: input.run,
      nodeRun: input.nodeRun,
      invocation,
      agentId: input.node.agentId,
      prompt,
      promptBlocks,
      signal: input.signal,
      modeId: input.node.modeId,
      configOptions: input.node.configOptions,
      mcpServers,
    });
  }

  async #resolveTaggedEdgeContent(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    edge: WorkflowEdge;
    origin: TransferOrigin;
    signal?: AbortSignal;
  }): Promise<string> {
    if (input.edge.kind !== "tagged-output" || !input.edge.handoff) return input.origin.output;
    const prompt = renderHandoffPrompt(input.edge.handoff.promptTemplate, input.origin.output);
    const { output } = await this.#invokeForkableFromOrigin({
      workflow: input.workflow,
      agentRunner: input.agentRunner,
      run: input.run,
      origin: input.origin,
      edge: input.edge,
      edgeId: input.edge.id,
      prompt,
      purpose: "handoff",
      signal: input.signal,
    });
    return output;
  }

  async #repairGateDecision(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun: NodeRun;
    node: Extract<WorkflowNode, { kind: "gate" }>;
    origin: TransferOrigin;
    previousInvocation: AgentInvocation;
    invalidOutput: string;
    error: unknown;
    signal?: AbortSignal;
  }): Promise<{ output: string; invocation: AgentInvocation; decision: GateDecision }> {
    const firstError = input.error instanceof Error ? input.error.message : String(input.error);
    const prompt = renderGateRepairPrompt(input.node, input.invalidOutput, firstError);
    const invocation = this.#createInvocation({
      run: input.run,
      nodeRun: input.nodeRun,
      agentId: input.origin.agentId,
      sessionId: input.previousInvocation.sessionId,
      parentSessionId: input.previousInvocation.parentSessionId,
      purpose: "gate",
      prompt,
    });
    const sessionDef = input.workflow.sessions.find((candidate) => candidate.id === input.origin.sessionId);
    const mcpServers = parseMcpServersField(sessionDef?.mcpServers, sessionDef?.id ?? input.origin.sessionId);
    const output = await this.#invokeAgent({
      workflow: input.workflow,
      agentRunner: input.agentRunner,
      run: input.run,
      nodeRun: input.nodeRun,
      invocation,
      agentId: input.origin.agentId,
      prompt,
      signal: input.signal,
      configOptions: input.node.configOptions,
      mcpServers,
    });
    try {
      return { output, invocation, decision: parseGateDecision(input.node, output) };
    } catch (error) {
      const secondError = error instanceof Error ? error.message : String(error);
      throw new Error(`${firstError} Gate repair failed: ${secondError}`);
    }
  }

  async #invokeForkableFromOrigin(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun?: NodeRun;
    origin: TransferOrigin;
    edge?: WorkflowEdge;
    edgeId?: string;
    prompt: string;
    purpose: "gate" | "handoff";
    signal?: AbortSignal;
    configOptions?: Record<string, string | boolean>;
    mcpServers?: AgentCommandRequest["mcpServers"];
  }): Promise<{ output: string; invocation: AgentInvocation }> {
    const forkSessionId = this.#nextForkSessionId(input.origin.sessionId);
    const invocation = this.#createInvocation({
      run: input.run,
      nodeRun: input.nodeRun,
      agentId: input.origin.agentId,
      sessionId: forkSessionId,
      parentSessionId: input.origin.sessionId,
      edgeId: input.edgeId,
      purpose: input.purpose,
      sourceNodeId: input.edge?.sourceNodeId,
      targetNodeId: input.edge?.targetNodeId,
      prompt: input.prompt,
    });
    const sessionDef = input.workflow.sessions.find((candidate) => candidate.id === input.origin.sessionId);
    const mcpServers = parseMcpServersField(sessionDef?.mcpServers, sessionDef?.id ?? input.origin.sessionId);
    const output = await this.#invokeAgent({
      workflow: input.workflow,
      agentRunner: input.agentRunner,
      run: input.run,
      invocation,
      agentId: input.origin.agentId,
      prompt: input.prompt,
      signal: input.signal,
      forkFromSessionId: input.origin.sessionId,
      configOptions: input.configOptions,
      mcpServers: input.mcpServers ?? mcpServers,
    });
    return { output, invocation };
  }

  #nextForkSessionId(sourceSessionId: string): string {
    const next = (this.#forkCounts.get(sourceSessionId) ?? 0) + 1;
    this.#forkCounts.set(sourceSessionId, next);
    return `${sourceSessionId}-fork-${String(next).padStart(2, "0")}`;
  }

  #createInvocation(input: {
    run: WorkflowRun;
    nodeRun?: NodeRun;
    agentId: string;
    sessionId?: string;
    parentSessionId?: string;
    edgeId?: string;
    purpose?: AgentInvocationPurpose;
    sourceNodeId?: string;
    targetNodeId?: string;
    prompt: string;
  }): AgentInvocation {
    const invocation: AgentInvocation = {
      id: uuidv7(),
      runId: input.run.id,
      nodeRunId: input.nodeRun?.id,
      nodeId: input.nodeRun?.nodeId,
      edgeId: input.edgeId,
      purpose: input.purpose ?? (input.edgeId ? "handoff" : input.nodeRun?.nodeId ? "node" : undefined),
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      prompt: input.prompt,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    input.run.agentInvocations.push(invocation);
    return invocation;
  }

  async #invokeAgent(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun?: NodeRun;
    invocation: AgentInvocation;
    agentId: string;
    prompt: string;
    promptBlocks?: AgentCommandRequest["promptBlocks"];
    forkFromSessionId?: string;
    signal?: AbortSignal;
    modeId?: string;
    configOptions?: Record<string, string | boolean>;
    mcpServers?: AgentCommandRequest["mcpServers"];
  }): Promise<string> {
    throwIfCancelled(input.signal);
    const agent = input.workflow.agents.find((candidate) => candidate.id === input.agentId);
    if (!agent) throw new Error(`Missing agent "${input.agentId}".`);
    const agentServerId = resolveAgentServerId(agent);
    let promptToSend = input.prompt;
    if (this.#promptTransformer) {
      promptToSend = await this.#promptTransformer(promptToSend, {
        agentServerId,
        nodeId: input.invocation.nodeId,
        edgeId: input.invocation.edgeId,
      });
      // Keep the invocation record in sync with what we actually sent so
      // downstream UI / logs can show the resolved skill body.
      input.invocation.prompt = promptToSend;
    }
    this.#onAgentPrompt?.({
      runId: input.run.id,
      nodeRunId: input.nodeRun?.id,
      nodeId: input.invocation.nodeId,
      edgeId: input.invocation.edgeId,
      purpose: input.invocation.purpose,
      sourceNodeId: input.invocation.sourceNodeId,
      targetNodeId: input.invocation.targetNodeId,
      agentInvocationId: input.invocation.id,
      agentId: input.agentId,
      agentServerId,
      specflowSessionId: input.invocation.sessionId,
      prompt: promptToSend,
      at: new Date().toISOString(),
    });
    let result: AgentCommandResult;
    const invocationControl = this.#runControls?.registerInvocation({
      runId: input.run.id,
      nodeId: input.invocation.nodeId,
      agentInvocationId: input.invocation.id,
    });
    const effectiveSignal = invocationControl
      ? combineAbortSignals(input.signal, invocationControl.signal)
      : input.signal;
    try {
      result = await input.agentRunner({
        agentServerId,
        prompt: promptToSend,
        promptBlocks: input.promptBlocks,
        cwd: this.#cwd,
        runId: input.run.id,
        workflowSessionId: input.invocation.sessionId,
        forkFromWorkflowSessionId: input.forkFromSessionId,
        signal: effectiveSignal,
        ...(input.modeId ? { modeId: input.modeId } : {}),
        ...(input.configOptions && Object.keys(input.configOptions).length > 0 ? { configOptions: input.configOptions } : {}),
        ...(input.mcpServers && input.mcpServers.length > 0 ? { mcpServers: input.mcpServers } : {}),
        onTerminalEvent: (event) => this.#appendAgentTerminalEvent({
          runId: input.run.id,
          nodeRunId: input.nodeRun?.id,
          agentInvocationId: input.invocation.id,
          event,
        }),
        onLifecycleEvent: (event) => this.#onAgentLifecycle?.({
          ...event,
          runId: input.run.id,
          nodeRunId: input.nodeRun?.id,
          nodeId: input.invocation.nodeId,
          edgeId: input.invocation.edgeId,
          purpose: input.invocation.purpose,
          sourceNodeId: input.invocation.sourceNodeId,
          targetNodeId: input.invocation.targetNodeId,
          agentInvocationId: input.invocation.id,
          agentId: input.agentId,
          specflowSessionId: input.invocation.sessionId,
          parentSpecflowSessionId: input.forkFromSessionId,
        }),
        onSessionUpdate: (event) => this.#onAgentSessionUpdate?.({
          ...event,
          runId: input.run.id,
          nodeRunId: input.nodeRun?.id,
          nodeId: input.invocation.nodeId,
          edgeId: input.invocation.edgeId,
          purpose: input.invocation.purpose,
          sourceNodeId: input.invocation.sourceNodeId,
          targetNodeId: input.invocation.targetNodeId,
          agentInvocationId: input.invocation.id,
          agentId: input.agentId,
          agentServerId,
          at: new Date().toISOString(),
          specflowSessionId: input.invocation.sessionId,
        }),
        onPermissionRequest: async (request) => this.#interactions.requestPermission(
          this.#interactionContext(input, agentServerId),
          request,
        ),
        onElicitationRequest: (request) => this.#interactions.requestElicitation(
          this.#interactionContext(input, agentServerId),
          request,
        ),
        onElicitationComplete: (notification) => this.#interactions.recordElicitationComplete(
          this.#interactionContext(input, agentServerId),
          notification,
        ),
      });
    } catch (error) {
      const interrupted = invocationControl?.signal.aborted && !input.signal?.aborted;
      input.invocation.status = input.signal?.aborted || interrupted || error instanceof WorkflowCancelledError
        ? "cancelled"
        : "failed";
      input.invocation.error = error instanceof Error ? error.message : String(error);
      input.invocation.completedAt = new Date().toISOString();
      invocationControl?.unregister();
      if (interrupted) {
        throw new WorkflowInterruptedError(input.invocation.nodeId, input.invocation.id);
      }
      throw error;
    }
    invocationControl?.unregister();
    if (invocationControl?.signal.aborted && !input.signal?.aborted) {
      input.invocation.status = "cancelled";
      input.invocation.completedAt = new Date().toISOString();
      throw new WorkflowInterruptedError(input.invocation.nodeId, input.invocation.id);
    }
    if (input.signal?.aborted) throw new WorkflowCancelledError();
    input.invocation.agentServerId = result.agentServerId;
    input.invocation.acpSessionId = result.sessionId;
    input.invocation.sessionId = result.workflowSessionId
      ?? (input.forkFromSessionId && result.sessionForked !== true
        ? input.forkFromSessionId
        : input.invocation.sessionId);
    input.invocation.parentSessionId = result.sessionForked === true
      ? result.parentWorkflowSessionId ?? input.forkFromSessionId
      : undefined;
    input.invocation.acpSessionForked = result.sessionForked;
    input.invocation.acpSupportsLoadSession = Boolean(result.initializeResponse?.agentCapabilities?.loadSession);
    input.invocation.acpSupportsResumeSession = Boolean(result.initializeResponse?.agentCapabilities?.sessionCapabilities?.resume);
    input.invocation.acpSupportsForkSession = Boolean(result.initializeResponse?.agentCapabilities?.sessionCapabilities?.fork);
    if (result.exitCode !== 0) {
      input.invocation.status = "failed";
      input.invocation.error = result.output;
      input.invocation.completedAt = new Date().toISOString();
      throw new Error(`Agent "${input.agentId}" failed with exit code ${result.exitCode}.`);
    }
    input.invocation.status = "done";
    input.invocation.output = result.output;
    input.invocation.completedAt = new Date().toISOString();
    return result.output;
  }

  #appendAgentTerminalEvent(input: {
    runId: string;
    nodeRunId?: string;
    agentInvocationId: string;
    event: AgentTerminalEvent;
  }): void {
    this.#terminalEvents.append({
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      agentInvocationId: input.agentInvocationId,
      stream: input.event.stream as TerminalStream,
      chunk: input.event.chunk,
    });
  }

  #interactionContext(input: {
    run: WorkflowRun;
    nodeRun?: NodeRun;
    invocation: AgentInvocation;
    agentId: string;
  }, agentServerId: string): RunInteractionContext {
    return {
      runId: input.run.id,
      nodeRunId: input.nodeRun?.id,
      nodeId: input.invocation.nodeId,
      edgeId: input.invocation.edgeId,
      agentInvocationId: input.invocation.id,
      agentId: input.agentId,
      agentServerId,
      specflowSessionId: input.invocation.sessionId,
      acpSessionId: input.invocation.acpSessionId,
    };
  }
}

function resolveAgentServerId(agent: AgentDefinition): string {
  return agent.kind === "external" ? agent.agentServerId : "unconfigured";
}

function findEntryNodes(workflow: Workflow): WorkflowNode[] {
  const targetNodeIds = new Set(workflow.edges.filter((edge) => !edge.loopback).map((edge) => edge.targetNodeId));
  return workflow.nodes.filter((node) => !targetNodeIds.has(node.id));
}

function groupEdgesByTarget(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) grouped.set(edge.targetNodeId, [...(grouped.get(edge.targetNodeId) ?? []), edge]);
  return grouped;
}

function groupEdgesBySource(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) grouped.set(edge.sourceNodeId, [...(grouped.get(edge.sourceNodeId) ?? []), edge]);
  return grouped;
}

function findRerunnableGateIds(workflow: Workflow): Set<string> {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const outgoing = groupEdgesBySource(workflow.edges.filter((edge) => !edge.loopback));
  const result = new Set<string>();
  for (const loopback of workflow.edges.filter((edge) => edge.loopback)) {
    const pending: Array<{ nodeId: string; gates: Set<string> }> = [{
      nodeId: loopback.targetNodeId,
      gates: new Set(),
    }];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.nodeId}:${[...current.gates].sort().join(",")}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const gates = new Set(current.gates);
      if (nodesById.get(current.nodeId)?.kind === "gate") gates.add(current.nodeId);
      if (current.nodeId === loopback.sourceNodeId) {
        for (const gateId of gates) result.add(gateId);
        continue;
      }
      for (const edge of outgoing.get(current.nodeId) ?? []) {
        pending.push({ nodeId: edge.targetNodeId, gates });
      }
    }
    if (nodesById.get(loopback.sourceNodeId)?.kind === "gate") {
      result.add(loopback.sourceNodeId);
    }
  }
  return result;
}

function findRecurringBranchEdgeIds(workflow: Workflow): Set<string> {
  const outgoing = groupEdgesBySource(workflow.edges);
  const result = new Set<string>();
  for (const edge of workflow.edges.filter((candidate) => candidate.sourcePortId)) {
    const pending = [edge.targetNodeId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const downstream = outgoing.get(nodeId) ?? [];
      if (downstream.some((candidate) => candidate.loopback)) {
        result.add(edge.id);
        break;
      }
      pending.push(...downstream.filter((candidate) => !candidate.loopback).map((candidate) => candidate.targetNodeId));
    }
  }
  return result;
}

function isNodeReady(
  incomingEdges: WorkflowEdge[],
  completedNodes: Set<string>,
  inactiveEdges: Set<string>,
): boolean {
  return incomingEdges.every((edge) => edge.loopback || inactiveEdges.has(edge.id) || completedNodes.has(edge.sourceNodeId));
}

function deactivateEdgeAndDependents(input: {
  edge: WorkflowEdge;
  inactiveEdges: Set<string>;
  skippedNodes: Set<string>;
  incomingEdgesByTarget: Map<string, WorkflowEdge[]>;
  outgoingEdgesBySource: Map<string, WorkflowEdge[]>;
  queue: QueuedNode[];
}): void {
  if (input.inactiveEdges.has(input.edge.id)) return;
  input.inactiveEdges.add(input.edge.id);
  const targetNodeId = input.edge.targetNodeId;
  const incoming = input.incomingEdgesByTarget.get(targetNodeId) ?? [];
  if (incoming.length > 0 && incoming.every((edge) => input.inactiveEdges.has(edge.id))) {
    input.skippedNodes.add(targetNodeId);
    for (const outgoing of input.outgoingEdgesBySource.get(targetNodeId) ?? []) {
      deactivateEdgeAndDependents({ ...input, edge: outgoing });
    }
    return;
  }
  input.queue.push({ nodeId: targetNodeId, traversal: 0 });
}

function executionKey(nodeId: string, traversal: number): string {
  return `${nodeId}:${traversal}`;
}

function gateWithAvailableBranches(node: Extract<WorkflowNode, { kind: "gate" }>, traversals: Map<string, number>): Extract<WorkflowNode, { kind: "gate" }> {
  const branches = node.branches.filter((branch) =>
    (traversals.get(`${node.id}:${branch.id}`) ?? 0) < (branch.maxTraversals ?? Number.MAX_SAFE_INTEGER));
  if (branches.length === 0) {
    throw new Error(`Gate node "${node.id}" has exhausted all branch traversal limits.`);
  }
  return { ...node, branches };
}

function gateBranchStatuses(node: Extract<WorkflowNode, { kind: "gate" }>, traversals: Map<string, number>): GateBranchStatus[] {
  return node.branches.map((branch) => {
    const maxTraversals = branch.maxTraversals ?? Number.MAX_SAFE_INTEGER;
    const traversalsUsed = traversals.get(`${node.id}:${branch.id}`) ?? 0;
    return {
      branchId: branch.id,
      label: branch.label,
      traversalsUsed,
      maxTraversals,
      available: traversalsUsed < maxTraversals,
    };
  });
}

/**
 * Parse a session's `mcpServers` JSON string into the ACP McpServer[] shape.
 * Treats empty / whitespace / invalid JSON as "no MCP servers configured" by
 * returning undefined — the agentflow-source parser has already validated
 * shape at YAML load time, so we only need to be defensive here for cases
 * where the YAML was bypassed (programmatic Workflow construction).
 */
function parseMcpServersField(
  rawValue: string | undefined,
  sessionId: string,
): AgentCommandRequest["mcpServers"] {
  if (!rawValue || !rawValue.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Session "${sessionId}" has invalid mcpServers JSON: ${detail}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Session "${sessionId}" mcpServers must be a JSON array.`);
  }
  if (parsed.length === 0) return undefined;
  return parsed as AgentCommandRequest["mcpServers"];
}

/**
 * Prompt used when re-entering an ACP session to finish an interrupted step
 * inside a workflow. The agent's original task is already in its session
 * history, so this only nudges it to produce final contract output instead of
 * starting over. There is no live user — the output is consumed automatically.
 */
function buildWorkflowContinuationPrompt(input: { nodeTitle?: string; originalTask: string }): string {
  const node = input.nodeTitle ? `"${input.nodeTitle}"` : "the previous step";
  return [
    `[Workflow resume]`,
    `Specflow is resuming this ACP session to finish step ${node}, which was interrupted before producing its final output.`,
    `Specflow cannot prove exactly where the interruption happened; you may have received none, part, or all of the original task. The fully rendered original task is included below so you can recover even if the ACP session history is incomplete.`,
    `<original_task>`,
    input.originalTask,
    `</original_task>`,
    `Please:`,
    `1. Briefly note what you already completed in this step (one short paragraph; do not redo the work).`,
    `2. If your prior work already satisfies the step's contract, emit the final output now — follow every formatting rule the original task laid out.`,
    `3. If essential work remains, finish it using the same approach you were already taking. Do not start over.`,
    `4. No live user is listening; do not ask clarifying questions. If you genuinely cannot complete the step, emit whatever failure marker the original task defined and explain what is missing.`,
  ].join("\n\n");
}
