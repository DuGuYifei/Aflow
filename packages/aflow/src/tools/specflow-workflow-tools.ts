import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  assertServerRunnableAgentFlow,
  listAgentServers,
  prepareCanvasRun,
  type AgentFlowDoc,
  type CanvasDoc,
  type RunInputVariable,
  type RunGraphOperation,
} from "@specflow/server";
import { RUN_SSE_EVENTS } from "@specflow/shared";
import { Type } from "typebox";
import { openPausedNodeAcpView, type AflowCustomUi } from "../acp/acp-session-view";
import {
  buildNodeDisplayMap,
  extractRecentConversationSnippets,
  formatNodeRef,
  formatRunSummary,
  latestInvocation,
  sessionsForRun,
  type NodeDisplayInfo,
} from "../acp/session-summary";
import { handoffToNativeTerminalFromTui } from "../native/terminal-handoff";
import { connectOrStartSpecflowServer } from "../server/connect-or-start";
import type { AgentSessionRecord, PausedNodeSession, RunInteraction, RunLogEvent, RunReachability, RunRecordDetail, RuntimeEditClass, SpecflowClient } from "../server/specflow-client";
import { getServerCanvasOrExplainLocal, loadWorkflowDoc } from "../workflows/workflow-resolver";
import {
  offerRunSessionResume,
  resumeAgentSessionForRun,
} from "../resume/session-resume";

type NativeHandoffUi = Parameters<typeof handoffToNativeTerminalFromTui>[1];
type WorkflowUi = AflowCustomUi & NativeHandoffUi & {
  input(title: string, placeholder?: string): Promise<string | undefined>;
};

interface WaitingForInteractionResult {
  waitingForInteraction: true;
  run: RunRecordDetail;
  interaction: RunInteraction;
  text: string;
  details: Record<string, unknown>;
}

const WorkflowTargetParams = Type.Object({
  target: Type.String({ description: "Workflow id or path to a workflow YAML file." }),
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
});

const RunWorkflowParams = Type.Object({
  workflowId: Type.String({ description: "Saved workflow id to run." }),
  initialInput: Type.Optional(Type.String({ description: "Optional freeform run context. Use variableValues for declared specflow_* workflow variables." })),
  variableValues: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Known specflow_* variable values." })),
  waitForCompletion: Type.Optional(Type.Boolean({ description: "Wait and show node status until the run completes or pauses. Defaults to true." })),
  dynamicReview: Type.Optional(Type.Boolean({ description: "Pause after each activation so Aflow can review completedNodeText and optionally patch this run snapshot. Does not edit the saved workflow." })),
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
});

const RunIdParams = Type.Object({
  runId: Type.String({ description: "Specflow run id." }),
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
});

const AgentFlowNodeSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("step"),
    id: Type.String(),
    alias: Type.String(),
    title: Type.String(),
    prompt: Type.String(),
    sessionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    pauseAfterRun: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    kind: Type.Literal("gate"),
    id: Type.String(),
    alias: Type.String(),
    title: Type.String(),
    decisionCriteria: Type.String(),
    branches: Type.Array(Type.Object({
      id: Type.String(),
      label: Type.String(),
      description: Type.Optional(Type.String()),
      maxTraversals: Type.Optional(Type.Number()),
    })),
  }),
  Type.Object({
    kind: Type.Literal("end"),
    id: Type.String(),
    alias: Type.String(),
    title: Type.String(),
    sessionId: Type.Optional(Type.Null()),
  }),
]);

const EdgeSchema = Type.Object({
  id: Type.String(),
  from: Type.String(),
  to: Type.String(),
  branch: Type.Optional(Type.String()),
  transmit: Type.Optional(Type.Boolean()),
  outputTag: Type.Optional(Type.String()),
  handoffPrompt: Type.Optional(Type.String()),
});

const RunGraphOperationSchema = Type.Union([
  Type.Object({ op: Type.Literal("update_node"), nodeId: Type.String(), patch: Type.Record(Type.String(), Type.Any()) }),
  Type.Object({ op: Type.Literal("update_edge"), edgeId: Type.String(), patch: Type.Record(Type.String(), Type.Any()) }),
  Type.Object({ op: Type.Literal("add_node"), node: AgentFlowNodeSchema, position: Type.Optional(Type.Object({ x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), w: Type.Optional(Type.Number()) })) }),
  Type.Object({ op: Type.Literal("remove_node"), nodeId: Type.String() }),
  Type.Object({ op: Type.Literal("add_edge"), edge: EdgeSchema }),
  Type.Object({ op: Type.Literal("remove_edge"), edgeId: Type.String() }),
  Type.Object({ op: Type.Literal("replace_edge_endpoint"), edgeId: Type.String(), from: Type.Optional(Type.String()), to: Type.Optional(Type.String()) }),
  Type.Object({
    op: Type.Literal("insert_node_between"),
    sourceNodeId: Type.String(),
    targetNodeId: Type.String(),
    node: AgentFlowNodeSchema,
    position: Type.Optional(Type.Object({ x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), w: Type.Optional(Type.Number()) })),
    incomingEdge: Type.Optional(Type.Record(Type.String(), Type.Any())),
    outgoingEdge: Type.Optional(Type.Record(Type.String(), Type.Any())),
  }),
]);

const RUN_GRAPH_INSERT_EXAMPLE = JSON.stringify({
  op: "insert_node_between",
  sourceNodeId: "incremennt",
  targetNodeId: "check",
  node: {
    kind: "step",
    id: "add-10086",
    alias: "02",
    title: "Add 10086",
    prompt: "Add 10086 to the current number.",
    sessionId: "calculator",
  },
  position: { x: 520, y: 160, w: 220 },
}, null, 2);

const PatchRunGraphParams = Type.Object({
  runId: Type.String({ description: "Paused or interrupted Specflow run id." }),
  operations: Type.Array(RunGraphOperationSchema, { description: "Structured runtime graph operations for this run snapshot." }),
  summary: Type.String({ description: "Brief reason for this run graph edit." }),
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
});

export function registerSpecflowWorkflowTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "specflow_validate_workflow",
    label: "Validate Workflow",
    description: "Validate a Specflow workflow by saved workflow id or local YAML path.",
    promptSnippet: "Validate a Specflow workflow before running it.",
    promptGuidelines: ["Use after extracting a workflow id or YAML path from /specflow-validate context."],
    parameters: WorkflowTargetParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const doc = await loadWorkflow(params.target, ctx.cwd, params.serverUrl);
      const agentServers = new Map((await listAgentServers(ctx.cwd)).map((entry) => [entry.id, entry]));
      assertServerRunnableAgentFlow(doc, agentServers);
      return textResult(`OK workflow "${doc.id}" (${doc.name})`, {
        workflowId: doc.id,
        name: doc.name,
        sessions: doc.sessions.length,
        nodes: doc.nodes.length,
        edges: doc.edges.length,
      });
    },
  });

  pi.registerTool({
    name: "specflow_run_workflow",
    label: "Run Workflow",
    description: "Run a saved Specflow workflow. Missing required workflow variables are asked one by one in the TUI.",
    promptSnippet: "Run a saved Specflow workflow and collect missing workflow variables interactively.",
    promptGuidelines: [
      "Use after extracting the workflow id from /specflow-run context.",
      "Pass any already-known specflow_* variables in variableValues.",
      "Use initialInput only for optional freeform run context; do not use it as a substitute for declared workflow variables.",
      "Let this tool ask missing workflow variables one by one instead of asking them all at once.",
    ],
    parameters: RunWorkflowParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const canvas = await getServerCanvasOrExplainLocal(
        params.workflowId,
        ctx.cwd,
        (workflowId) => connection.client.getCanvas(workflowId),
      );
      const nodeDisplay = buildNodeDisplayMap(canvas);
      const variableValues = { ...(params.variableValues ?? {}) };
      let prepared = prepareCanvasRun(canvas, {
        initialInput: params.initialInput,
        variableValues,
      });

      if (prepared.missingVariables.length > 0) {
        if (!ctx.hasUI) {
          return textResult(formatMissingVariables(prepared.missingVariables), {
            missingVariables: prepared.missingVariables.map((variable) => variable.name),
            cancelled: true,
          });
        }
        for (const variable of prepared.missingVariables) {
          const answer = await ctx.ui.input(inputQuestion(variable), variable.defaultValue);
          if (answer === undefined) {
            return textResult("Run cancelled while collecting workflow variables.", { cancelled: true });
          }
          variableValues[variable.name] = answer;
        }
        prepared = prepareCanvasRun(canvas, {
          initialInput: params.initialInput,
          variableValues,
        });
      }

      const validationAgentServers = new Map((await listAgentServers(ctx.cwd)).map((entry) => [entry.id, entry]));
      assertServerRunnableAgentFlow(prepared.doc, validationAgentServers);
      const shouldMonitor = params.waitForCompletion !== false;
      const runMode = shouldMonitor
        ? await chooseDynamicReviewMode(ctx.hasUI, ctx.ui, params.dynamicReview)
        : params.dynamicReview === true ? "dynamic" : "normal";
      if (!runMode) return textResult("Run cancelled while choosing run mode.", { cancelled: true });
      const dynamicReview = runMode === "dynamic";
      const run = await connection.client.runCanvas(params.workflowId, {
        initialInput: params.initialInput,
        variableValues,
        ...(dynamicReview ? { pauseAfterFirstActivation: true } : {}),
      });

      if (params.waitForCompletion === false) {
        return textResult(`${dynamicReview ? "Dynamic review run" : "Run"} started: ${run.id}`, {
          runId: run.id,
          workflowId: run.workflowId,
          status: run.status,
          serverUrl: connection.url,
          dynamicReview,
        });
      }

      if (dynamicReview) {
        const checkpoint = await monitorDynamicRun(connection.client, run.id, {
          signal,
          onUpdate,
          hasUI: ctx.hasUI,
          ui: ctx.ui,
          nodeDisplay,
        });
        if (isWaitingForInteractionResult(checkpoint)) {
          return textResult(checkpoint.text, {
            ...checkpoint.details,
            serverUrl: connection.url,
          });
        }
        if (isTerminalStatus(checkpoint.run.status)) {
          const bestPractice = await offerDynamicSnapshotSave({
            client: connection.client,
            run: checkpoint.run,
            hasUI: ctx.hasUI,
            ui: ctx.hasUI ? ctx.ui : undefined,
          });
          const sessionResume = await offerRunSessionResume({
            client: connection.client,
            run: checkpoint.run,
            nodeDisplay,
            hasUI: ctx.hasUI,
            ui: ctx.hasUI ? ctx.ui : undefined,
          });
          return textResult([formatRunSummary(checkpoint.run, nodeDisplay), bestPractice.text, sessionResume.text].filter(Boolean).join("\n\n"), {
            ...checkpoint.details,
            bestPractice: bestPractice.details,
            agentSessions: sessionResume.sessions,
            sessionResume: sessionResume.details,
            serverUrl: connection.url,
          });
        }
        return textResult(checkpoint.text, {
          ...checkpoint.details,
          serverUrl: connection.url,
        });
      }

      const finalRun = await monitorRun(connection.client, run.id, {
        signal,
        onUpdate,
        hasUI: ctx.hasUI,
        ui: ctx.ui,
        nodeDisplay,
        mode: "normal",
      });
      if (isWaitingForInteractionResult(finalRun)) {
        return textResult(finalRun.text, {
          ...finalRun.details,
          serverUrl: connection.url,
        });
      }
      const sessionResume = await offerRunSessionResume({
        client: connection.client,
        run: finalRun,
        nodeDisplay,
        hasUI: ctx.hasUI,
        ui: ctx.hasUI ? ctx.ui : undefined,
      });
      return textResult([formatRunSummary(finalRun, nodeDisplay), sessionResume.text].filter(Boolean).join("\n\n"), {
        runId: run.id,
        workflowId: finalRun.workflowId,
        status: finalRun.status,
        nodeStates: finalRun.nodeStates,
        pausedNodeId: finalRun.pausedNodeId,
        errorMsg: finalRun.errorMsg,
        serverUrl: connection.url,
        agentSessions: sessionResume.sessions,
        sessionResume: sessionResume.details,
      });
    },
  });

  pi.registerTool({
    name: "specflow_resume_session",
    label: "Resume Agent Session",
    description: "Open the Aflow session resume picker for a completed Specflow run.",
    promptSnippet: "Resume or inspect a recorded agent session from a Specflow run.",
    promptGuidelines: [
      "Use for explicit agent session resume after a run.",
      "This tool offers ACP Resume, ACP Inspect, Native CLI in Aflow terminal, Show native resume command, and Skip when TUI is available.",
      "Do not guess native commands; use the tool result.",
    ],
    parameters: RunIdParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const sessionResume = await resumeAgentSessionForRun({
        client: connection.client,
        runId: params.runId,
        hasUI: ctx.hasUI,
        ui: ctx.hasUI ? ctx.ui : undefined,
      });
      return textResult(sessionResume.text, {
        runId: params.runId,
        agentSessions: sessionResume.sessions,
        sessionResume: sessionResume.details,
      });
    },
  });

  pi.registerTool({
    name: "specflow_get_run_checkpoint",
    label: "Get Run Checkpoint",
    description: "Inspect a paused/interrupted Specflow run checkpoint for dynamic review. Returns checkpointReady:false when the run is still running.",
    promptSnippet: "Refresh an existing Dynamic run checkpoint only when the current checkpoint context may be stale or incomplete.",
    promptGuidelines: [
      "Use only after a Dynamic checkpoint result explicitly indicates the run is in Dynamic mode.",
      "Base normal dynamic decisions on completedNodeText, which is the assistant-text-only node output passed to downstream workflow logic.",
      "If checkpointReady is false, do not patch and do not play; wait with specflow_run_to_next_checkpoint.",
      "Do not assume tool call details are included in completedNodeText.",
    ],
    parameters: RunIdParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const checkpoint = await buildDynamicCheckpointResultOrExplainNotReady(connection.client, params.runId);
      return textResult(checkpoint.text, {
        ...checkpoint.details,
        serverUrl: connection.url,
      });
    },
  });

  pi.registerTool({
    name: "specflow_patch_run_graph",
    label: "Patch Run Graph",
    description: "Patch only the current Dynamic run snapshot with structured graph operations. Does not edit the saved workflow.",
    promptSnippet: "Patch a Dynamic run snapshot with structured graph operations only after checkpoint context shows a clear future-workflow issue.",
    promptGuidelines: [
      "Use only after a Dynamic checkpoint result identifies a clear need to change reachable future workflow.",
      "Submit structured graph operations, not a full YAML or full canvas snapshot.",
      "To insert a repair node between existing nodes, prefer insert_node_between with sourceNodeId, targetNodeId, node, and optional position.",
      "Node ids and kinds are stable runtime anchors. Do not change them; create new future nodes instead.",
      `Example insert operation: ${RUN_GRAPH_INSERT_EXAMPLE}`,
      "The server response is authoritative editability and migration feedback.",
      "Remember non-gate fan-out is queued fan-out: all outgoing targets run unless a gate selects a branch.",
    ],
    parameters: PatchRunGraphParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const run = await getRunOrThrowHelpfulError(connection.client, params.runId, connection.url);
      const patched = await connection.client.patchRunGraph(params.runId, {
        operations: params.operations as RunGraphOperation[],
        summary: params.summary,
      });
      return textResult([
        `Run graph patched: ${params.runId}`,
        `Snapshot revision: ${patched.snapshotRevision ?? "(unchanged)"}`,
        `Applied operations: ${patched.appliedOperations?.length ?? 0}`,
        `Rejected operations: ${patched.rejectedOperations?.length ?? 0}`,
        "",
        "Migration preview:",
        formatJsonBlock(patched.migrationPreview ?? {}),
        "",
        "Topology capabilities:",
        formatJsonBlock(patched.topologyCapabilities ?? {}),
        "",
        "Dynamic review guidance:",
        "- Base decisions on completedNodeText unless tool/timeline details are explicitly needed.",
        "- The patch affected only this run snapshot; the saved agentflow is unchanged.",
        "- Server validation/migration feedback is authoritative. Do not retry rejected operations unchanged.",
        "- Non-gate fan-out is queued fan-out; all outgoing targets run unless a gate controls selection.",
        "",
        "Common operation example:",
        "```json",
        RUN_GRAPH_INSERT_EXAMPLE,
        "```",
      ].join("\n"), {
        runId: params.runId,
        status: run.status,
        snapshotRevision: patched.snapshotRevision,
        reachability: patched.reachability,
        appliedOperations: patched.appliedOperations,
        rejectedOperations: patched.rejectedOperations,
        migrationPreview: patched.migrationPreview,
        topologyCapabilities: patched.topologyCapabilities,
        serverUrl: connection.url,
      });
    },
  });

  pi.registerTool({
    name: "specflow_run_to_next_checkpoint",
    label: "Run To Next Checkpoint",
    description: "Advance an existing Dynamic run to the next checkpoint or terminal status. If the run is already running, waits instead of playing again.",
    promptSnippet: "Advance an existing Dynamic run to its next checkpoint only after a Dynamic checkpoint result instructs you to continue.",
    promptGuidelines: [
      "Use only after a Dynamic checkpoint result explicitly indicates the run is in Dynamic mode.",
      "If the run is paused or interrupted, this tool plays once and arms pauseAfterNextActivation.",
      "If the run is already running, this tool does not play again; it only waits for the next checkpoint.",
      "This continues the same run id; it does not create a continuation run.",
    ],
    parameters: RunIdParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const runBeforePlay = await getRunOrThrowHelpfulError(connection.client, params.runId, connection.url);
      const nodeDisplay = await buildRunNodeDisplay(connection.client, runBeforePlay);
      if (runBeforePlay.status === "paused" || runBeforePlay.status === "interrupted") {
        await connection.client.playRun(params.runId, {
          pauseAfterNextActivation: true,
        });
      }
      const checkpoint = await monitorDynamicRun(connection.client, params.runId, {
        signal,
        onUpdate,
        hasUI: ctx.hasUI,
        ui: ctx.ui,
        nodeDisplay,
      });
      if (isWaitingForInteractionResult(checkpoint)) {
        return textResult(checkpoint.text, {
          ...checkpoint.details,
          serverUrl: connection.url,
        });
      }
      if (isTerminalStatus(checkpoint.run.status)) {
        const bestPractice = await offerDynamicSnapshotSave({
          client: connection.client,
          run: checkpoint.run,
          hasUI: ctx.hasUI,
          ui: ctx.hasUI ? ctx.ui : undefined,
        });
        const sessionResume = await offerRunSessionResume({
          client: connection.client,
          run: checkpoint.run,
          nodeDisplay,
          hasUI: ctx.hasUI,
          ui: ctx.hasUI ? ctx.ui : undefined,
        });
        return textResult([formatRunSummary(checkpoint.run, nodeDisplay), bestPractice.text, sessionResume.text].filter(Boolean).join("\n\n"), {
          ...checkpoint.details,
          bestPractice: bestPractice.details,
          agentSessions: sessionResume.sessions,
          sessionResume: sessionResume.details,
          serverUrl: connection.url,
        });
      }
      return textResult(checkpoint.text, {
        ...checkpoint.details,
        serverUrl: connection.url,
      });
    },
  });

  pi.registerTool({
    name: "specflow_interrupt_run",
    label: "Interrupt Run",
    description: "Interrupt the current active ACP prompt turn for a running Specflow run without closing the ACP session.",
    promptSnippet: "Interrupt a running dynamic workflow turn only when explicitly needed.",
    promptGuidelines: [
      "This sends ACP session/cancel for the active turn; it does not close or delete the session.",
      "The default dynamic loop should prefer pause/play checkpoints rather than interrupting.",
    ],
    parameters: RunIdParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const result = await connection.client.interruptRun(params.runId);
      return textResult(`Run interrupt requested: ${params.runId}`, {
        runId: params.runId,
        result,
        serverUrl: connection.url,
      });
    },
  });

  pi.registerTool({
    name: "specflow_continue_workflow",
    label: "Continue Workflow",
    description: "Continue a stopped or failed Specflow workflow run by creating a continuation run.",
    promptSnippet: "Continue a stopped or failed Specflow workflow run.",
    promptGuidelines: ["Use after extracting a run id from /specflow-continue context."],
    parameters: RunIdParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const run = await connection.client.continueWorkflowRun(params.runId);
      return textResult(`Workflow continuation started: ${run.id}`, {
        runId: run.id,
        resumedFromRunId: run.resumedFromRunId ?? params.runId,
        status: run.status,
      });
    },
  });

}

type DynamicCheckpointDetails = {
  dynamicReview: true;
  checkpointReady?: boolean;
  runId: string;
  workflowId: string;
  status: string;
  completedNodeId?: string;
  completedNodeTitle?: string;
  completedNodeText?: string;
  snapshotRevision?: number;
  reachability?: RunReachability;
  editableNodes?: Array<{ nodeId: string; title: string; editClass: RuntimeEditClass }>;
  nonEditableNodes?: Array<{ nodeId: string; title: string; editClass: RuntimeEditClass }>;
  graph?: {
    nodes: Array<{ id: string; kind: string; title: string; editClass?: RuntimeEditClass }>;
    edges: Array<{ id: string; from: string; to: string; branch?: string }>;
  };
  nodeStates?: Record<string, string>;
  pausedNodeId?: string;
  errorMsg?: string;
};

async function chooseDynamicReviewMode(
  hasUI: boolean,
  ui: WorkflowUi,
  suggested: boolean | undefined,
): Promise<"dynamic" | "normal" | undefined> {
  if (!hasUI) return suggested === true ? "dynamic" : "normal";
  const dynamicLabel = "Dynamic run";
  const normalLabel = "Normal run";
  const selected = await ui.select([
    "Choose Specflow run mode",
    "",
    "Normal run uses the saved workflow behavior.",
    "Dynamic run pauses after each node so Aflow can review completed node text and optionally adjust only this run snapshot.",
    "The saved agentflow will not be changed.",
  ].join("\n"), suggested === true ? [normalLabel, dynamicLabel] : [normalLabel, dynamicLabel]);
  if (!selected) return undefined;
  return selected === dynamicLabel ? "dynamic" : "normal";
}

async function offerDynamicSnapshotSave(input: {
  client: SpecflowClient;
  run: RunRecordDetail;
  hasUI: boolean;
  ui?: WorkflowUi;
}): Promise<{ text: string; details?: Record<string, unknown> }> {
  if (input.run.status !== "success") {
    return { text: "", details: { eligible: false, reason: `status:${input.run.status}` } };
  }
  if (!input.run.agentflowSnapshot || !input.run.canvasSnapshot) {
    input.ui?.notify("Dynamic run snapshot is missing; cannot save it as a workflow.", "warning");
    return { text: "Dynamic run snapshot was not saved because the run snapshot is missing.", details: { selected: false, reason: "missing-snapshot" } };
  }
  if (!input.hasUI || !input.ui) {
    return { text: "", details: { selected: false, reason: "no-ui" } };
  }

  const saveLabel = "Save snapshot as workflow";
  const skipLabel = "Skip";
  const selected = await input.ui.select([
    "Save this Dynamic run snapshot as a workflow?",
    "",
    "This creates a new local workflow from the final run snapshot.",
    "The original saved agentflow is not changed.",
  ].join("\n"), [saveLabel, skipLabel]);
  if (!selected || selected === skipLabel) {
    return { text: "Dynamic run snapshot was not saved.", details: { selected: false } };
  }

  const defaultName = `${input.run.agentflowSnapshot.name || input.run.workflowId} best practice`;
  const name = await input.ui.input("Workflow name for the saved snapshot", defaultName);
  if (name === undefined) {
    return { text: "Dynamic run snapshot save was cancelled.", details: { selected: true, saved: false, cancelled: true } };
  }

  try {
    const result = await input.client.saveRunBestPractice(input.run.id, { name: name.trim() || defaultName });
    input.ui.notify(`Saved workflow: ${result.workflow.name}`, "info");
    return {
      text: `Saved Dynamic run snapshot as workflow: ${result.workflow.name} (${result.workflow.id}).`,
      details: { selected: true, saved: true, workflow: result.workflow },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.ui.notify(`Failed to save Dynamic run snapshot: ${message}`, "warning");
    return {
      text: `Failed to save Dynamic run snapshot as workflow: ${message}`,
      details: { selected: true, saved: false, error: message },
    };
  }
}

async function monitorDynamicRun(
  client: SpecflowClient,
  runId: string,
  context: {
    signal?: AbortSignal;
    onUpdate?: (result: ReturnType<typeof textResult>) => void;
    hasUI: boolean;
    ui: WorkflowUi;
    nodeDisplay: Map<string, NodeDisplayInfo>;
  },
): Promise<{ run: RunRecordDetail; text: string; details: DynamicCheckpointDetails } | WaitingForInteractionResult> {
  const interactions = startRunInteractionMonitor(client, runId, context.signal);
  let lastRendered = "";
  try {
    for (;;) {
      if (context.signal?.aborted) throw new Error("Workflow run monitoring cancelled.");
      let run = await getRunOrThrowHelpfulError(client, runId);
      const waiting = await handlePendingRunInteractions(client, run, interactions, context);
      if (waiting) return waiting;
      const rendered = formatRunSummary(run, context.nodeDisplay);
      if (rendered !== lastRendered) {
        lastRendered = rendered;
        context.onUpdate?.(textResult(rendered, {
          runId,
          workflowId: run.workflowId,
          status: run.status,
          nodeStates: run.nodeStates,
          pausedNodeId: run.pausedNodeId,
          dynamicReview: true,
        }));
      }

      const paused = await client.listPausedNodes(runId);
      if (paused.length > 0 && shouldOpenAuthoredPausedInteraction(run)) {
        const continued = await handlePausedNodes(client, run, paused, {
          ...context,
          mode: "dynamic",
        });
        if (!continued) return buildDynamicCheckpointResult(client, runId, context.nodeDisplay);
        run = await client.getRun(runId);
      }

      if (!isInFlightStatus(run.status)) return buildDynamicCheckpointResult(client, runId, context.nodeDisplay);
      await sleep(750, context.signal);
    }
  } finally {
    interactions.close();
  }
}

async function buildDynamicCheckpointResultOrExplainNotReady(
  client: SpecflowClient,
  runId: string,
  nodeDisplay?: Map<string, NodeDisplayInfo>,
): Promise<{ run: RunRecordDetail; text: string; details: DynamicCheckpointDetails }> {
  const run = await getRunOrThrowHelpfulError(client, runId);
  if (isInFlightStatus(run.status)) {
    return {
      run,
      details: {
        dynamicReview: true,
        checkpointReady: false,
        runId: run.id,
        workflowId: run.workflowId,
        status: run.status,
        nodeStates: run.nodeStates,
        pausedNodeId: run.pausedNodeId,
        errorMsg: run.errorMsg,
      },
      text: [
        `Dynamic run checkpoint not ready: ${run.id}`,
        `Workflow: ${run.workflowId}`,
        `Status: ${run.status}`,
        "",
        "The run is still executing. This is not a decision checkpoint.",
        "Do not patch the run graph and do not play again. Use specflow_run_to_next_checkpoint to wait for the next paused/interrupted/terminal state.",
      ].join("\n"),
    };
  }
  return buildDynamicCheckpointResult(client, runId, nodeDisplay, run);
}

async function buildDynamicCheckpointResult(
  client: SpecflowClient,
  runId: string,
  nodeDisplay?: Map<string, NodeDisplayInfo>,
  prefetchedRun?: RunRecordDetail,
): Promise<{ run: RunRecordDetail; text: string; details: DynamicCheckpointDetails }> {
  const run = prefetchedRun ?? await getRunOrThrowHelpfulError(client, runId);
  const nodes = nodeDisplay ?? await buildRunNodeDisplay(client, run);
  const reachability = await client.getRunReachability(runId).catch(() => undefined);
  const completed = completedNodeOutput(run, nodes);
  const editableNodes = reachability ? runtimeNodeSummaries(reachability, nodes, ["current", "future", "history_future"]) : undefined;
  const nonEditableNodes = reachability ? runtimeNodeSummaries(reachability, nodes, ["history_only", "inactive"]) : undefined;
  const graph = run.agentflowSnapshot ? runtimeGraphSummary(run.agentflowSnapshot, nodes, reachability) : undefined;
  const details: DynamicCheckpointDetails = {
    dynamicReview: true,
    checkpointReady: run.status === "paused" || run.status === "interrupted",
    runId: run.id,
    workflowId: run.workflowId,
    status: run.status,
    ...(completed.nodeId ? { completedNodeId: completed.nodeId } : {}),
    ...(completed.title ? { completedNodeTitle: completed.title } : {}),
    ...(typeof completed.text === "string" ? { completedNodeText: completed.text } : {}),
    ...(run.snapshotRevision !== undefined ? { snapshotRevision: run.snapshotRevision } : {}),
    ...(reachability ? { reachability } : {}),
    ...(editableNodes ? { editableNodes } : {}),
    ...(nonEditableNodes ? { nonEditableNodes } : {}),
    ...(graph ? { graph } : {}),
    nodeStates: run.nodeStates,
    pausedNodeId: run.pausedNodeId,
    errorMsg: run.errorMsg,
  };
  return {
    run,
    details,
    text: formatDynamicCheckpointText(details),
  };
}

async function buildRunNodeDisplay(client: SpecflowClient, run: RunRecordDetail): Promise<Map<string, NodeDisplayInfo>> {
  if (run.agentflowSnapshot) return buildNodeDisplayMap(run.agentflowSnapshot as unknown as CanvasDoc);
  return buildNodeDisplayMap(await client.getCanvas(run.workflowId));
}

function shouldOpenAuthoredPausedInteraction(run: RunRecordDetail): boolean {
  return run.status === "paused" && run.checkpoint?.suspension?.source === "node_property";
}

function completedNodeOutput(
  run: RunRecordDetail,
  nodes: Map<string, NodeDisplayInfo>,
): { nodeId?: string; title?: string; text?: string } {
  const pending = run.checkpoint?.pendingCompletion;
  const nodeId = pending?.nodeId
    ?? run.checkpoint?.suspension?.nodeId
    ?? run.checkpoint?.activeNodeId
    ?? run.pausedNodeId
    ?? run.activeNode;
  const text = typeof pending?.output === "string"
    ? pending.output
    : nodeId ? run.nodeOutputs?.[nodeId] : undefined;
  return {
    ...(nodeId ? { nodeId } : {}),
    ...(nodeId ? { title: nodes.get(nodeId)?.title ?? nodeId } : {}),
    ...(typeof text === "string" ? { text } : {}),
  };
}

function runtimeNodeSummaries(
  reachability: RunReachability,
  nodes: Map<string, NodeDisplayInfo>,
  classes: RuntimeEditClass[],
): Array<{ nodeId: string; title: string; editClass: RuntimeEditClass }> {
  const allowed = new Set(classes);
  return [...nodes.values()]
    .map((node) => ({ nodeId: node.id, title: node.title, editClass: reachability.nodes[node.id] }))
    .filter((entry): entry is { nodeId: string; title: string; editClass: RuntimeEditClass } => Boolean(entry.editClass && allowed.has(entry.editClass)));
}

function runtimeGraphSummary(
  agentflow: AgentFlowDoc,
  nodes: Map<string, NodeDisplayInfo>,
  reachability: RunReachability | undefined,
): NonNullable<DynamicCheckpointDetails["graph"]> {
  return {
    nodes: agentflow.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: nodes.get(node.id)?.title ?? ("title" in node && typeof node.title === "string" ? node.title : node.id),
      editClass: reachability?.nodes[node.id],
    })),
    edges: agentflow.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.branch ? { branch: edge.branch } : {}),
    })),
  };
}

function formatDynamicCheckpointText(details: DynamicCheckpointDetails): string {
  const lines = [
    `Dynamic run checkpoint: ${details.runId}`,
    `Workflow: ${details.workflowId}`,
    `Status: ${details.status}`,
  ];
  if (details.completedNodeId) {
    lines.push(`Completed node: ${details.completedNodeTitle ?? details.completedNodeId} (${details.completedNodeId})`);
  }
  lines.push(
    "",
    "completedNodeText is the full assistant text output passed to downstream workflow logic. It excludes tool calls, usage updates, terminal output, and lifecycle events.",
    "",
    "Completed node text:",
    "```text",
    details.completedNodeText ?? "(no completed node text available)",
    "```",
    "",
    "Editable nodes:",
    formatRuntimeNodeList(details.editableNodes),
    "",
    "Non-editable nodes:",
    formatRuntimeNodeList(details.nonEditableNodes),
    "",
    "Runtime graph summary:",
    formatRuntimeGraph(details.graph),
    "",
    "Dynamic review guidance:",
    "- Treat this as a lightweight alignment check. In most checkpoints, continue unchanged with specflow_run_to_next_checkpoint.",
    "- Patch only when completedNodeText gives clear evidence that the remaining run will drift from the user's goal, miss required information, choose the wrong branch, use stale assumptions, or hit avoidable downstream failure.",
    "- Patch only this run snapshot with specflow_patch_run_graph structured operations; the saved agentflow is unchanged.",
    "- Allowed edit classes are current, future, and history_future. history_only and inactive edits are rejected unless the server can migrate a future topology operation.",
    "- For paused checkpoints, the current activation output is fixed. If it is wrong, insert a reachable future repair/review node or restructure future flow.",
    "- For interrupted checkpoints, current-node prompt/config edits may affect the re-entered activation, but keep node identity stable.",
    "- Server validation and migration feedback is authoritative.",
    "- Non-gate fan-out is queued fan-out; every outgoing target runs unless a gate controls branch selection.",
  );
  return lines.join("\n");
}

function formatRuntimeNodeList(nodes: Array<{ nodeId: string; title: string; editClass: RuntimeEditClass }> | undefined): string {
  if (!nodes || nodes.length === 0) return "- (none)";
  return nodes.map((node) => `- ${node.title} (${node.nodeId}): ${node.editClass}`).join("\n");
}

function formatRuntimeGraph(graph: DynamicCheckpointDetails["graph"] | undefined): string {
  if (!graph) return "- (snapshot graph unavailable)";
  return [
    "Nodes:",
    ...graph.nodes.map((node) => `- ${node.title} (${node.id}, ${node.kind}${node.editClass ? `, ${node.editClass}` : ""})`),
    "Edges:",
    ...(graph.edges.length > 0
      ? graph.edges.map((edge) => `- ${edge.id}: ${edge.from} -> ${edge.to}${edge.branch ? ` [branch ${edge.branch}]` : ""}`)
      : ["- (none)"]),
  ].join("\n");
}

function formatJsonBlock(value: unknown): string {
  return [
    "```json",
    JSON.stringify(value ?? {}, null, 2),
    "```",
  ].join("\n");
}

function isTerminalStatus(status: string): boolean {
  return status === "success" || status === "error" || status === "stopped" || status === "cancelled";
}

function isInFlightStatus(status: string): boolean {
  return status === "running" || status === "pending";
}

async function getRunOrThrowHelpfulError(
  client: SpecflowClient,
  runId: string,
  serverUrl = client.baseUrl,
): Promise<RunRecordDetail> {
  try {
    return await client.getRun(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "Not found" && message !== "Run not found") throw error;
    const recentRuns = await client.listRuns().catch(() => []);
    const recent = recentRuns
      .slice(0, 5)
      .map((run) => `- ${run.id} (${run.workflowId}, ${run.status})`)
      .join("\n");
    throw new Error([
      "Run not found on this Specflow server.",
      `runId: ${runId}`,
      `serverUrl: ${serverUrl}`,
      "Possible causes: the run id was copied incorrectly, Aflow connected to a different Specflow server, or the server workspace is different.",
      recent ? `Recent runs:\n${recent}` : "Recent runs: (none visible)",
    ].join("\n"));
  }
}

async function monitorRun(
  client: SpecflowClient,
  runId: string,
  context: {
    signal?: AbortSignal;
    onUpdate?: (result: ReturnType<typeof textResult>) => void;
    hasUI: boolean;
    ui: WorkflowUi;
    nodeDisplay: Map<string, NodeDisplayInfo>;
    mode: "normal" | "dynamic";
  },
): Promise<RunRecordDetail | WaitingForInteractionResult> {
  const interactions = startRunInteractionMonitor(client, runId, context.signal);
  let lastRendered = "";
  try {
    for (;;) {
      if (context.signal?.aborted) throw new Error("Workflow run monitoring cancelled.");
      const run = await client.getRun(runId);
      const waiting = await handlePendingRunInteractions(client, run, interactions, context);
      if (waiting) return waiting;
      const rendered = formatRunSummary(run, context.nodeDisplay);
      if (rendered !== lastRendered) {
        lastRendered = rendered;
        context.onUpdate?.(textResult(rendered, {
          runId,
          workflowId: run.workflowId,
          status: run.status,
          nodeStates: run.nodeStates,
          pausedNodeId: run.pausedNodeId,
        }));
      }

      const paused = await client.listPausedNodes(runId);
      if (paused.length > 0) {
        const continued = await handlePausedNodes(client, run, paused, context);
        if (!continued) return run;
      }

      if (run.status !== "running") return run;
      await sleep(750, context.signal);
    }
  } finally {
    interactions.close();
  }
}

async function handlePausedNodes(
  client: SpecflowClient,
  run: RunRecordDetail,
  pausedNodes: PausedNodeSession[],
  context: {
    onUpdate?: (result: ReturnType<typeof textResult>) => void;
    hasUI: boolean;
    ui: WorkflowUi;
    nodeDisplay: Map<string, NodeDisplayInfo>;
    mode: "normal" | "dynamic";
  },
): Promise<boolean> {
  if (!context.hasUI) {
    context.onUpdate?.(textResult(formatPausedNodes(pausedNodes, context.nodeDisplay), { pausedNodes }));
    return false;
  }

  for (const paused of pausedNodes) {
    const session = await findPausedAgentSession(client, run, paused);
    const logs = normalizeRunLogs(await client.getRunLogs(paused.runId, { tail: 500 }).catch(() => []));
    const snippets = session ? extractRecentConversationSnippets(logs, session, 2) : [];
    const result = await openPausedNodeAcpView({
      client,
      ui: context.ui,
      paused,
      node: context.nodeDisplay.get(paused.nodeId),
      snippets,
      ...(context.mode === "dynamic" ? { continueOptions: { play: false } } : {}),
    });
    if (!result.continued) {
      context.ui.notify("Workflow is still paused.", "warning");
      return false;
    }
    context.onUpdate?.(textResult(`Continued paused node ${formatNodeRef(paused.nodeId, context.nodeDisplay)}.`, { paused }));
  }
  return true;
}

async function findPausedAgentSession(
  client: SpecflowClient,
  run: RunRecordDetail,
  paused: PausedNodeSession,
): Promise<AgentSessionRecord | undefined> {
  const sessions = sessionsForRun(await client.listAgentSessions({ workflowId: run.workflowId }).catch(() => []), run.id);
  return sessions.find((session) => {
    if (session.specflowSessionId !== paused.specflowSessionId) return false;
    const latest = latestInvocation(session);
    return latest?.nodeId === paused.nodeId || session.invocations.some((invocation) => invocation.nodeId === paused.nodeId);
  });
}

function normalizeRunLogs(result: RunLogEvent[] | { events: RunLogEvent[] }): RunLogEvent[] {
  return Array.isArray(result) ? result : result.events;
}

function formatPausedNodes(pausedNodes: PausedNodeSession[], nodeDisplay: Map<string, NodeDisplayInfo>): string {
  return [
    "Workflow is paused and needs ACP interaction:",
    ...pausedNodes.map((node) => `- ${formatNodeRef(node.nodeId, nodeDisplay)} (${node.agentServerId}, session ${node.specflowSessionId})`),
    "Open Aflow TUI interaction to send a prompt or continue.",
  ].join("\n");
}

interface RunInteractionMonitor {
  next(): RunInteraction | undefined;
  close(): void;
}

function startRunInteractionMonitor(
  client: SpecflowClient,
  runId: string,
  signal: AbortSignal | undefined,
): RunInteractionMonitor {
  const controller = new AbortController();
  const pending: RunInteraction[] = [];
  const seen = new Set<string>();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  void client.streamRunEvents(runId, (event) => {
    if (event.type !== RUN_SSE_EVENTS.interactionRequested) return;
    if (event.interaction.status !== "pending") return;
    if (seen.has(event.interaction.id)) return;
    seen.add(event.interaction.id);
    pending.push(event.interaction);
  }, { signal: controller.signal, replay: false }).catch(() => undefined);
  return {
    next: () => pending.shift(),
    close: () => {
      signal?.removeEventListener("abort", abort);
      controller.abort();
    },
  };
}

async function handlePendingRunInteractions(
  client: SpecflowClient,
  run: RunRecordDetail,
  monitor: RunInteractionMonitor,
  context: {
    hasUI: boolean;
    ui: WorkflowUi;
  },
): Promise<WaitingForInteractionResult | undefined> {
  for (;;) {
    const interaction = monitor.next();
    if (!interaction) return undefined;
    if (!context.hasUI) return waitingForInteractionResult(run, interaction);
    const resolution = await askRunInteractionResolution(context.ui, interaction);
    if (!resolution) return waitingForInteractionResult(run, interaction);
    await client.respondRunInteraction(interaction.runId, interaction.id, resolution);
    context.ui.notify(`Resolved ${interaction.kind} interaction.`, "info");
  }
}

async function askRunInteractionResolution(
  ui: WorkflowUi,
  interaction: RunInteraction,
): Promise<unknown | undefined> {
  if (interaction.kind === "permission") {
    const options = interaction.options ?? [];
    const labels = options.map((option, index) => `${index + 1}. ${option.name ?? option.optionId}`);
    const cancelLabel = "Cancel interaction";
    const selected = await ui.select([
      "ACP permission requested",
      "",
      `Tool call: ${summarizeUnknown(interaction.toolCall)}`,
    ].join("\n"), [...labels, cancelLabel]);
    if (!selected) return undefined;
    if (selected === cancelLabel) return { outcome: "cancelled" };
    const option = options[labels.indexOf(selected)];
    return option ? { outcome: "selected", optionId: option.optionId } : undefined;
  }

  const acceptLabel = "Accept empty content";
  const declineLabel = "Decline";
  const cancelLabel = "Cancel interaction";
  const selected = await ui.select([
    "ACP elicitation requested",
    "",
    `Request: ${summarizeUnknown(interaction.request)}`,
  ].join("\n"), [acceptLabel, declineLabel, cancelLabel]);
  if (selected === acceptLabel) return { action: "accept", content: {} };
  if (selected === declineLabel) return { action: "decline" };
  if (selected === cancelLabel) return { action: "cancel" };
  return undefined;
}

function waitingForInteractionResult(run: RunRecordDetail, interaction: RunInteraction): WaitingForInteractionResult {
  const text = [
    `Workflow run is waiting for an ACP ${interaction.kind} interaction.`,
    `Run: ${run.id}`,
    `Workflow: ${run.workflowId}`,
    `Interaction: ${interaction.id}`,
    interaction.nodeId ? `Node: ${interaction.nodeId}` : undefined,
    `Agent server: ${interaction.agentServerId}`,
    "",
    "Open the Specflow UI or respond through the API:",
    `POST /api/runs/${encodeURIComponent(interaction.runId)}/interactions/${encodeURIComponent(interaction.id)}/respond`,
  ].filter((line): line is string => Boolean(line)).join("\n");
  return {
    waitingForInteraction: true,
    run,
    interaction,
    text,
    details: {
      waitingForInteraction: true,
      runId: run.id,
      workflowId: run.workflowId,
      status: run.status,
      interactionId: interaction.id,
      interactionKind: interaction.kind,
      nodeId: interaction.nodeId,
      agentServerId: interaction.agentServerId,
    },
  };
}

function isWaitingForInteractionResult(value: unknown): value is WaitingForInteractionResult {
  return Boolean(value && typeof value === "object" && (value as WaitingForInteractionResult).waitingForInteraction === true);
}

function summarizeUnknown(value: unknown): string {
  if (value === undefined || value === null) return "(none)";
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timeout = setTimeout(() => {
      settled = true;
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Workflow run monitoring cancelled."));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function loadWorkflow(target: string, cwd: string, serverUrl: string | undefined): Promise<AgentFlowDoc> {
  return loadWorkflowDoc(target, cwd, serverUrl);
}

function inputQuestion(variable: RunInputVariable): string {
  return [
    `Workflow variable ${variable.name}`,
    variable.description ? `\n${variable.description}` : "",
  ].join("");
}

function formatMissingVariables(variables: RunInputVariable[]): string {
  return [
    "Missing required workflow variables:",
    ...variables.map((variable) => `- ${variable.name}${variable.description ? ` (${variable.description})` : ""}`),
  ].join("\n");
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export const __testing = {
  askRunInteractionResolution,
  waitingForInteractionResult,
  isWaitingForInteractionResult,
};
