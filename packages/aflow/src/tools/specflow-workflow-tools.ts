import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  assertServerRunnableAgentFlow,
  listAgentServers,
  prepareCanvasRun,
  type AgentFlowDoc,
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
import type { AgentSessionRecord, PausedNodeSession, RunLogEvent, RunRecordDetail, SpecflowClient } from "../server/specflow-client";
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
  initialInput: Type.Optional(Type.String({ description: "Initial workflow input." })),
  variableValues: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Known specflow_* variable values." })),
  waitForCompletion: Type.Optional(Type.Boolean({ description: "Wait and show node status until the run completes or pauses. Defaults to true." })),
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
});

const RunIdParams = Type.Object({
  runId: Type.String({ description: "Specflow run id." }),
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
    description: "Run a saved Specflow workflow. Missing required input variables are asked one by one in the TUI.",
    promptSnippet: "Run a saved Specflow workflow and collect missing input variables interactively.",
    promptGuidelines: [
      "Use after extracting the workflow id from /specflow-run context.",
      "Pass any already-known specflow_* variables in variableValues.",
      "Let this tool ask missing input variables one by one instead of asking them all at once.",
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
            return textResult("Run cancelled while collecting input variables.", { cancelled: true });
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
      const run = await connection.client.runCanvas(params.workflowId, {
        initialInput: params.initialInput,
        variableValues,
      });

      if (params.waitForCompletion === false) {
        return textResult(`Run started: ${run.id}`, {
          runId: run.id,
          workflowId: run.workflowId,
          status: run.status,
          serverUrl: connection.url,
        });
      }

      const finalRun = await monitorRun(connection.client, run.id, {
        signal,
        onUpdate,
        hasUI: ctx.hasUI,
        ui: ctx.ui,
        nodeDisplay,
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

async function monitorRun(
  client: SpecflowClient,
  runId: string,
  context: {
    signal?: AbortSignal;
    onUpdate?: (result: ReturnType<typeof textResult>) => void;
    hasUI: boolean;
    ui: WorkflowUi;
    nodeDisplay: Map<string, NodeDisplayInfo>;
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
    `Input ${variable.name}`,
    variable.description ? `\n${variable.description}` : "",
  ].join("");
}

function formatMissingVariables(variables: RunInputVariable[]): string {
  return [
    "Missing required variables:",
    ...variables.map((variable) => `- ${variable.name}${variable.description ? ` (${variable.description})` : ""}`),
  ].join("\n");
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}
