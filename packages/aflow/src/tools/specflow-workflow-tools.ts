import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  assertServerRunnableAgentFlow,
  listAgentServers,
  parseAgentFlowSource,
  prepareCanvasRun,
  stringifyAgentFlowSource,
  type AgentFlowDoc,
  type CanvasDoc,
  type RunInputVariable,
} from "@specflow/server";
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
import type { AgentSessionRecord, PausedNodeSession, RunLogEvent, RunReachability, RunRecordDetail, RuntimeEditClass, SpecflowClient } from "../server/specflow-client";
import { getServerCanvasOrExplainLocal, loadWorkflowDoc } from "../workflows/workflow-resolver";
import {
  offerRunSessionResume,
  resumeAgentSessionForRun,
} from "../resume/session-resume";

type NativeHandoffUi = Parameters<typeof handoffToNativeTerminalFromTui>[1];
type WorkflowUi = AflowCustomUi & NativeHandoffUi;

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

const PlayRunParams = Type.Object({
  runId: Type.String({ description: "Specflow run id." }),
  pauseAfterNextActivation: Type.Optional(Type.Boolean({ description: "Pause again after the next step/gate activation. Defaults to true for dynamic review." })),
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
});

const PatchRunSnapshotParams = Type.Object({
  runId: Type.String({ description: "Paused or interrupted Specflow run id." }),
  agentflowYaml: Type.String({ description: "Complete replacement YAML for this run snapshot's Agentflow semantics. Does not update the saved workflow file." }),
  summary: Type.String({ description: "Brief reason for this run snapshot edit." }),
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
        if (isTerminalStatus(checkpoint.run.status)) {
          const sessionResume = await offerRunSessionResume({
            client: connection.client,
            run: checkpoint.run,
            nodeDisplay,
            hasUI: ctx.hasUI,
            ui: ctx.hasUI ? ctx.ui : undefined,
          });
          return textResult([formatRunSummary(checkpoint.run, nodeDisplay), sessionResume.text].filter(Boolean).join("\n\n"), {
            ...checkpoint.details,
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
    description: "Inspect a paused/interrupted Specflow run checkpoint for dynamic review. Returns completedNodeText and editable snapshot guidance.",
    promptSnippet: "Inspect the current dynamic run checkpoint before deciding whether to patch the run snapshot.",
    promptGuidelines: [
      "Use for paused or interrupted dynamic runs before patching or playing.",
      "Base normal dynamic decisions on completedNodeText, which is the assistant-text-only node output passed to downstream workflow logic.",
      "Do not assume tool call details are included in completedNodeText.",
    ],
    parameters: RunIdParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const checkpoint = await buildDynamicCheckpointResult(connection.client, params.runId);
      return textResult(checkpoint.text, {
        ...checkpoint.details,
        serverUrl: connection.url,
      });
    },
  });

  pi.registerTool({
    name: "specflow_patch_run_snapshot",
    label: "Patch Run Snapshot",
    description: "Patch only a paused/interrupted run snapshot from Agentflow YAML. Does not edit the saved workflow.",
    promptSnippet: "Patch a dynamic run snapshot after reviewing completedNodeText and reachability.",
    promptGuidelines: [
      "Only patch current, future, or history_future nodes.",
      "Do not add/delete nodes or change edge endpoints during runtime snapshot editing.",
      "Remember non-gate fan-out is queued fan-out: all outgoing targets run unless a gate selects a branch.",
    ],
    parameters: PatchRunSnapshotParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const run = await connection.client.getRun(params.runId);
      if (!run.canvasSnapshot) {
        return textResult("Run snapshot layout is missing; cannot patch this run snapshot.", {
          runId: params.runId,
          status: run.status,
          cancelled: true,
        });
      }
      const parsed = parseAgentFlowSource(params.agentflowYaml, run.workflowId);
      const patched = await connection.client.patchRunSnapshot(params.runId, {
        agentflowSnapshot: parsed,
        canvasSnapshot: run.canvasSnapshot,
        summary: params.summary,
      });
      return textResult([
        `Run snapshot patched: ${params.runId}`,
        `Snapshot revision: ${patched.snapshotRevision}`,
        "",
        "Dynamic review guidance:",
        "- Base decisions on completedNodeText unless tool/timeline details are explicitly needed.",
        "- Editable runtime classes are current, future, and history_future.",
        "- history_only, inactive, and topology edits are rejected by the server.",
        "- Non-gate fan-out is queued fan-out; all outgoing targets run unless a gate controls selection.",
      ].join("\n"), {
        runId: params.runId,
        status: run.status,
        snapshotRevision: patched.snapshotRevision,
        reachability: patched.reachability,
        serverUrl: connection.url,
      });
    },
  });

  pi.registerTool({
    name: "specflow_play_run",
    label: "Play Run",
    description: "Continue the same paused/interrupted Specflow run, optionally pausing after the next activation for dynamic review.",
    promptSnippet: "Play a dynamic run after inspecting or patching its run snapshot.",
    promptGuidelines: [
      "Use pauseAfterNextActivation: true for the dynamic review loop.",
      "This continues the same run id; it does not create a continuation run.",
    ],
    parameters: PlayRunParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const runBeforePlay = await connection.client.getRun(params.runId);
      const nodeDisplay = await buildRunNodeDisplay(connection.client, runBeforePlay);
      await connection.client.playRun(params.runId, {
        pauseAfterNextActivation: params.pauseAfterNextActivation ?? true,
      });
      const checkpoint = await monitorDynamicRun(connection.client, params.runId, {
        signal,
        onUpdate,
        hasUI: ctx.hasUI,
        ui: ctx.ui,
        nodeDisplay,
      });
      if (isTerminalStatus(checkpoint.run.status)) {
        const sessionResume = await offerRunSessionResume({
          client: connection.client,
          run: checkpoint.run,
          nodeDisplay,
          hasUI: ctx.hasUI,
          ui: ctx.hasUI ? ctx.ui : undefined,
        });
        return textResult([formatRunSummary(checkpoint.run, nodeDisplay), sessionResume.text].filter(Boolean).join("\n\n"), {
          ...checkpoint.details,
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
    name: "specflow_resume_workflow",
    label: "Resume Workflow",
    description: "Resume a cancelled or failed Specflow workflow run.",
    promptSnippet: "Resume a cancelled or failed Specflow workflow run.",
    promptGuidelines: ["Use after extracting a run id from /specflow-resume context."],
    parameters: RunIdParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const run = await connection.client.resumeWorkflowRun(params.runId);
      return textResult(`Workflow resume started: ${run.id}`, {
        runId: run.id,
        resumedFromRunId: run.resumedFromRunId ?? params.runId,
        status: run.status,
      });
    },
  });

}

type DynamicCheckpointDetails = {
  dynamicReview: true;
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
  agentflowYaml?: string;
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
    "Dynamic run pauses after each node so Aflow can review completed node text and optionally adjust only this run snapshot.",
    "The saved agentflow will not be changed.",
  ].join("\n"), suggested === true ? [dynamicLabel, normalLabel] : [dynamicLabel, normalLabel]);
  if (!selected) return undefined;
  return selected === dynamicLabel ? "dynamic" : "normal";
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
): Promise<{ run: RunRecordDetail; text: string; details: DynamicCheckpointDetails }> {
  let lastRendered = "";
  for (;;) {
    if (context.signal?.aborted) throw new Error("Workflow run monitoring cancelled.");
    let run = await client.getRun(runId);
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

    if (run.status !== "running") return buildDynamicCheckpointResult(client, runId, context.nodeDisplay);
    await sleep(750, context.signal);
  }
}

async function buildDynamicCheckpointResult(
  client: SpecflowClient,
  runId: string,
  nodeDisplay?: Map<string, NodeDisplayInfo>,
): Promise<{ run: RunRecordDetail; text: string; details: DynamicCheckpointDetails }> {
  const run = await client.getRun(runId);
  const nodes = nodeDisplay ?? await buildRunNodeDisplay(client, run);
  const reachability = await client.getRunReachability(runId).catch(() => undefined);
  const completed = completedNodeOutput(run, nodes);
  const editableNodes = reachability ? runtimeNodeSummaries(reachability, nodes, ["current", "future", "history_future"]) : undefined;
  const nonEditableNodes = reachability ? runtimeNodeSummaries(reachability, nodes, ["history_only", "inactive"]) : undefined;
  const agentflowYaml = run.agentflowSnapshot ? stringifyAgentFlowSource(run.agentflowSnapshot) : undefined;
  const details: DynamicCheckpointDetails = {
    dynamicReview: true,
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
    ...(agentflowYaml ? { agentflowYaml } : {}),
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
    "Dynamic review guidance:",
    "- Patch only this run snapshot; the saved agentflow is unchanged.",
    "- Allowed edit classes are current, future, and history_future.",
    "- history_only, inactive, and topology edits are rejected by the server.",
    "- Non-gate fan-out is queued fan-out; every outgoing target runs unless a gate controls branch selection.",
  );
  if (details.agentflowYaml) {
    lines.push(
      "",
      "Current run snapshot Agentflow YAML:",
      "```yaml",
      details.agentflowYaml,
      "```",
    );
  }
  return lines.join("\n");
}

function formatRuntimeNodeList(nodes: Array<{ nodeId: string; title: string; editClass: RuntimeEditClass }> | undefined): string {
  if (!nodes || nodes.length === 0) return "- (none)";
  return nodes.map((node) => `- ${node.title} (${node.nodeId}): ${node.editClass}`).join("\n");
}

function isTerminalStatus(status: string): boolean {
  return status === "success" || status === "error" || status === "stopped" || status === "cancelled";
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
): Promise<RunRecordDetail> {
  let lastRendered = "";
  for (;;) {
    if (context.signal?.aborted) throw new Error("Workflow run monitoring cancelled.");
    const run = await client.getRun(runId);
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
