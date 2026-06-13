import { AgentServerStore, probeAcpAgentCapabilities, type AgentServerCapabilitiesCache } from "@specflow/agent-proxy";
import { WorkflowExecutor } from "@specflow/bridge";
import type { SpecflowBridge, WorkflowResumeState } from "@specflow/bridge";
import type { AgentAuthenticationStatus, AgentConversation, AgentRestoreMode, AgentRestorePrimitive, AgentServerEntry, AgentServerSettings, NodeStatusEvent, RegistryIndex, RunInteraction, RunInteractionContext, RunStatusEvent, WorkflowCheckpointEvent, WorkflowExecutionCheckpoint } from "@specflow/bridge";
import { SPECFLOW_AGENTFLOW_PATH, uuidv7, type AcpTimelineEvent } from "@specflow/shared";
import { AcpTimelinePipeline } from "./acp-timeline-pipeline";
import { SkillStore } from "./skills";
import { AuthTerminalSessionStore } from "./auth-terminal-sessions";
import { TerminalSessionStore, type TerminalSessionTask } from "./terminal-session-store";
import { canvasToWorkflow } from "./agentflow/canvas-to-workflow";
import {
  listCanvases,
  loadCanvas,
  loadAgentFlow,
  loadOrCreateCanvasLayout,
  saveCanvas,
  saveAgentFlowAndLayout,
  deleteCanvas,
  splitCanvasDoc,
  combineAgentFlowAndLayout,
} from "./agentflow/canvas-store";
import { formatDuration, listRuns, loadRun, reconcileInterruptedRuns, saveRun, deleteRun, type RunControlIntent, type RunRecord, type RunState } from "./agentflow/run-store";
import {
  listAgentSessions,
  loadAgentSession,
  recordAgentSessionRestoreAttempt,
  upsertAgentSessionsFromRun,
} from "./agentflow/agent-session-store";
import { appendRunLogEvent, deleteRunLog, listRunLogEvents, listRunLogEventsRange, listRunTimelineRestoreEvents } from "./agentflow/run-log-store";
import { prepareCanvasRun } from "./agentflow/run-inputs";
import type { AgentFlowDoc, CanvasDoc, CanvasLayoutDoc } from "./agentflow/canvas-doc";
import { computeRunReachability } from "./agentflow/run-reachability";
import { assertServerRunnableAgentFlow } from "./agentflow/agentflow-validation";
import { assertSymbolKey, keyFromLabel } from "./agentflow/agentflow-source";
import {
  loadLocalAgentServerConfig,
  removeLocalAgentServer,
  upsertLocalAgentServer,
} from "./agent-server-config";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInvocationPurpose } from "@specflow/workflow";
import { agentflowAssetsDir } from "./workspace-paths";

// ── simple in-process event bus ───────────────────────────────────────────────

type BusHandler = (payload: unknown) => void;

class EventBus {
  readonly #listeners = new Map<string, Set<BusHandler>>();

  on(channel: string, handler: BusHandler): () => void {
    let channelListeners = this.#listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.#listeners.set(channel, channelListeners);
    }
    channelListeners.add(handler);
    return () => channelListeners!.delete(handler);
  }

  emit(channel: string, payload: unknown): void {
    for (const handler of this.#listeners.get(channel) ?? []) {
      handler(payload);
    }
  }
}

type RestoreStatus = "requested" | "success" | "failure";
const REDACTED_ENV_VALUE = "[redacted]";

type RestoreStreamEvent =
  | {
      type: "restore-status";
      restoreId: string;
      agentSessionId: string;
      runId: string;
      requestedMode: AgentRestoreMode;
      selectedPrimitive?: AgentRestorePrimitive;
      capabilities?: Pick<AgentServerCapabilitiesCache, "modes" | "configOptions">;
      status: RestoreStatus;
      error?: string;
      at: string;
    }
  | {
      type: "session-update";
      restoreId: string;
      agentSessionId: string;
      sessionId: string;
      update: unknown;
      at: string;
    }
  | {
      type: "terminal";
      restoreId: string;
      agentSessionId: string;
      stream: string;
      chunk: string;
      at: string;
    }
  | {
      type: "interaction-requested";
      restoreId: string;
      interaction: RunInteraction;
      at: string;
    };

interface RestoreStreamState {
  events: RestoreStreamEvent[];
  done: boolean;
}

interface ActiveConversation {
  conversation: AgentConversation;
  promptPending: boolean;
  promptController?: AbortController;
  interactionInvocationId: string;
  stopInteractionEvents: () => void;
  waitForLogWrites: () => Promise<void>;
}

function closesRestoreStream(event: RestoreStreamEvent): boolean {
  return event.type === "restore-status"
    && (event.status === "failure" || (event.status === "success" && event.requestedMode === "inspect"));
}

function parseAgentServerSettings(input: unknown): AgentServerSettings | undefined {
  if (!input || typeof input !== "object") return undefined;
  const rawValue = input as Record<string, unknown>;
  const environment = recordOfStrings(rawValue.env);
  const workingDirectory = typeof rawValue.cwd === "string" && rawValue.cwd.trim() ? rawValue.cwd.trim() : undefined;
  const additionalDirectories = arrayOfStrings(rawValue.additionalDirectories ?? rawValue.additional_directories);

  if (rawValue.type === "registry" && typeof rawValue.registryId === "string" && rawValue.registryId.trim()) {
    return {
      type: "registry",
      registryId: rawValue.registryId.trim(),
      installedVersion: typeof rawValue.installedVersion === "string" ? rawValue.installedVersion : undefined,
      cwd: workingDirectory,
      env: environment,
      additionalDirectories,
    };
  }
  if (rawValue.type === "custom" && typeof rawValue.command === "string" && rawValue.command.trim()) {
    return {
      type: "custom",
      command: rawValue.command.trim(),
      args: arrayOfStrings(rawValue.args),
      cwd: workingDirectory,
      env: environment,
      additionalDirectories,
    };
  }
  if (rawValue.type === "headless" && typeof rawValue.command === "string" && rawValue.command.trim()) {
    return {
      type: "headless",
      command: rawValue.command.trim(),
      argsTemplate: arrayOfStrings(rawValue.argsTemplate),
      cwd: workingDirectory,
      env: environment,
      additionalDirectories,
    };
  }
  return undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function redactAgentServerEntries(entries: AgentServerEntry[]): AgentServerEntry[] {
  return entries.map((entry) => ({
    ...entry,
    settings: redactAgentServerSettings(entry.settings),
  }));
}

async function listAgentServerEntries(bridge: SpecflowBridge, root: string): Promise<AgentServerEntry[]> {
  const entries = await bridge.listAgentServers(root);
  let registry: RegistryIndex | undefined;
  try {
    registry = await bridge.listAgentRegistry(root);
  } catch {
    registry = undefined;
  }

  const registryAgents = new Map((registry?.agents ?? []).map((agent) => [agent.id, agent]));
  return entries.map((entry) => {
    if (entry.settings.type !== "registry") return entry;
    const latestVersion = registryAgents.get(entry.settings.registryId)?.version;
    const installedVersion = entry.settings.installedVersion;
    return {
      ...entry,
      registry: {
        registryId: entry.settings.registryId,
        installedVersion,
        latestVersion,
        updateAvailable: Boolean(latestVersion && installedVersion && installedVersion !== latestVersion),
      },
    };
  });
}

function redactAgentServerSettings(settings: AgentServerSettings): AgentServerSettings {
  if (!settings.env) return settings;
  return {
    ...settings,
    env: Object.fromEntries(Object.entries(settings.env).map(([key, value]) => [
      key,
      isSensitiveEnvKey(key) ? REDACTED_ENV_VALUE : value,
    ])),
  } as AgentServerSettings;
}

function isSensitiveEnvKey(key: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY)/i.test(key);
}

async function preserveRedactedEnvValues(
  root: string,
  id: string,
  settings: AgentServerSettings,
): Promise<AgentServerSettings> {
  if (!settings.env || !Object.values(settings.env).includes(REDACTED_ENV_VALUE)) {
    return settings;
  }
  const current = (await loadLocalAgentServerConfig(root)).agent_servers[id]?.env ?? {};
  return {
    ...settings,
    env: Object.fromEntries(Object.entries(settings.env).map(([key, value]) => [
      key,
      value === REDACTED_ENV_VALUE && current[key] !== undefined ? current[key] : value,
    ])),
  } as AgentServerSettings;
}

function interactionAuditRecord(interaction: RunInteraction): RunInteraction {
  if (interaction.kind === "permission") {
    return interaction;
  }
  return {
    ...interaction,
    request: summarizeElicitationRequest(interaction.request),
    resolution: summarizeElicitationResolution(interaction.resolution),
  };
}

function summarizeElicitationRequest(request: unknown): unknown {
  if (!request || typeof request !== "object") return request;
  const rawValue = request as Record<string, unknown>;
  return {
    ...(typeof rawValue.sessionId === "string" ? { sessionId: rawValue.sessionId } : {}),
    ...(typeof rawValue.mode === "string" ? { mode: rawValue.mode } : {}),
    ...(typeof rawValue.message === "string" ? { message: rawValue.message } : {}),
    ...(rawValue.requestedSchema ? { requestedSchema: rawValue.requestedSchema } : {}),
  };
}

function summarizeElicitationResolution(resolution: unknown): unknown {
  if (!resolution || typeof resolution !== "object") return resolution;
  const rawValue = resolution as Record<string, unknown>;
  return {
    ...(typeof rawValue.action === "string" ? { action: rawValue.action } : {}),
  };
}

interface LifecyclePayload {
  type: string;
  at: string;
  sessionId?: string;
  parentSessionId?: string;
  stopReason?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Build a WorkflowResumeState snapshot from a prior run record + its log.
 * Powers POST /api/runs/:id/resume-workflow.
 */
async function buildResumeStateFromRun(root: string, record: RunRecord): Promise<WorkflowResumeState> {
  // Session map: specflowSessionId → ACP sessionId, from invocations.
  const acpSessionByWorkflowSession: Record<string, string> = {};
  for (const invocation of record.agentInvocations) {
    if (invocation.sessionId && invocation.acpSessionId && !acpSessionByWorkflowSession[invocation.sessionId]) {
      acpSessionByWorkflowSession[invocation.sessionId] = invocation.acpSessionId;
    }
  }
  // Gate decisions + branch traversal counts: scan node_status log events.
  const gateDecisions: Record<string, { branchId: string }> = {};
  const branchTraversals: Record<string, number> = {};
  for (const event of await listRunLogEvents(root, record.id)) {
    if (event.type !== "node_status" || !event.gateDecision) continue;
    gateDecisions[event.nodeId] = { branchId: event.gateDecision.branchId };
    const key = `${event.nodeId}:${event.gateDecision.branchId}`;
    branchTraversals[key] = (branchTraversals[key] ?? 0) + 1;
  }
  return {
    nodeStates: { ...record.nodeStates } as WorkflowResumeState["nodeStates"],
    nodeOutputs: { ...record.nodeOutputs },
    gateDecisions,
    acpSessionByWorkflowSession,
    branchTraversals,
  };
}

async function reconstructInvocationsFromRunLog(root: string, record: RunRecord): Promise<RunRecord["agentInvocations"]> {
  const events = await listRunLogEvents(root, record.id);
  const byInvocationId = new Map<string, RunRecord["agentInvocations"][number]>();
  for (const event of events) {
    if (event.type === "agent_prompt") {
      if (!event.agentInvocationId) continue;
      let existing = byInvocationId.get(event.agentInvocationId);
      if (!existing) {
        existing = {
          id: event.agentInvocationId,
          runId: event.runId,
          nodeRunId: event.nodeRunId,
          nodeId: event.nodeId,
          edgeId: event.edgeId,
          purpose: event.purpose,
          sourceNodeId: event.sourceNodeId,
          targetNodeId: event.targetNodeId,
          agentId: event.agentId,
          agentServerId: event.agentServerId,
          sessionId: event.specflowSessionId,
          prompt: event.prompt,
          status: "running",
          startedAt: event.at,
        };
        byInvocationId.set(event.agentInvocationId, existing);
      } else {
        existing.prompt = event.prompt;
        existing.agentServerId ||= event.agentServerId;
        existing.sessionId ||= event.specflowSessionId;
        existing.purpose ||= event.purpose;
        existing.sourceNodeId ||= event.sourceNodeId;
        existing.targetNodeId ||= event.targetNodeId;
      }
    } else if (event.type === "agent_lifecycle") {
      const lifecycle = (event.lifecycle ?? {}) as { type?: string; at?: string; sessionId?: string; parentSessionId?: string; error?: string };
      if (!event.agentInvocationId) continue;
      let existing = byInvocationId.get(event.agentInvocationId);
      if (!existing) {
        existing = {
          id: event.agentInvocationId,
          runId: event.runId,
          nodeRunId: event.nodeRunId,
          nodeId: event.nodeId,
          edgeId: event.edgeId,
          purpose: event.purpose,
          sourceNodeId: event.sourceNodeId,
          targetNodeId: event.targetNodeId,
          agentId: event.agentId,
          agentServerId: event.agentServerId,
          prompt: "",
          status: "running",
          startedAt: lifecycle.at ?? record.startedAt,
        };
        byInvocationId.set(event.agentInvocationId, existing);
      }
      if (lifecycle.sessionId && !existing.acpSessionId) existing.acpSessionId = lifecycle.sessionId;
      if (event.specflowSessionId && !existing.sessionId) existing.sessionId = event.specflowSessionId;
      if (event.purpose && !existing.purpose) existing.purpose = event.purpose;
      if (event.sourceNodeId && !existing.sourceNodeId) existing.sourceNodeId = event.sourceNodeId;
      if (event.targetNodeId && !existing.targetNodeId) existing.targetNodeId = event.targetNodeId;
      const parentSpecflowSessionId = typeof event.parentSpecflowSessionId === "string" ? event.parentSpecflowSessionId : undefined;
      if (parentSpecflowSessionId && !existing.parentSessionId) existing.parentSessionId = parentSpecflowSessionId;
      if (lifecycle.type === "session_forked") existing.acpSessionForked = true;
      if (lifecycle.type === "session_closed" || lifecycle.type === "prompt_stopped") {
        if (existing.status === "running") existing.status = "done";
        if (!existing.completedAt) existing.completedAt = lifecycle.at ?? new Date().toISOString();
      }
      if (lifecycle.type === "prompt_failed") {
        existing.status = "failed";
        existing.completedAt = lifecycle.at ?? new Date().toISOString();
        if (lifecycle.error) existing.error = lifecycle.error;
      }
    } else if (event.type === "session_update") {
      // session_update fires per agent chunk and carries both agentInvocationId
      // and the ACP sessionId. Invocations that REUSE an existing ACP session
      // (no fresh `session_created` of their own) only get their acpSessionId
      // populated this way.
      const sessionUpdate = event as { agentInvocationId?: string; sessionId?: string; agentServerId?: string };
      if (!sessionUpdate.agentInvocationId || !sessionUpdate.sessionId) continue;
      const existing = byInvocationId.get(sessionUpdate.agentInvocationId);
      if (existing && !existing.acpSessionId) existing.acpSessionId = sessionUpdate.sessionId;
    }
  }
  return [...byInvocationId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function mergeRunInvocations(
  existing: RunRecord["agentInvocations"],
  next: RunRecord["agentInvocations"],
): RunRecord["agentInvocations"] {
  const byId = new Map<string, RunRecord["agentInvocations"][number]>();
  for (const invocation of existing) byId.set(invocation.id, invocation);
  for (const invocation of next) byId.set(invocation.id, { ...(byId.get(invocation.id) ?? {}), ...invocation });
  return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function pickResumableInvocation(record: RunRecord): RunRecord["agentInvocations"][number] | undefined {
  if (!record.agentInvocations?.length) return undefined;
  const sortByStartDesc = [...record.agentInvocations].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // Prefer an invocation that was still running — that's the one mid-flight when interrupted.
  const stillRunning = sortByStartDesc.find((invocation) => invocation.status === "running");
  if (stillRunning) return stillRunning;
  // Otherwise the most recently finished invocation; the user can prompt it to continue the flow.
  return sortByStartDesc[0];
}

function buildContinuationPrompt(input: {
  nodeTitle?: string;
  invocationStatus: "running" | "done" | "failed" | "cancelled";
  runStatus: "pending" | "running" | "paused" | "interrupted" | "success" | "error" | "stopped";
  errorMsg?: string;
  originalTask?: string;
}): string {
  const node = input.nodeTitle ? `"${input.nodeTitle}"` : "the last step";
  const lines: string[] = [];
  if (input.invocationStatus === "running") {
    lines.push(`Specflow detected that the previous run was interrupted while ${node} was still in progress.`);
  } else if (input.invocationStatus === "cancelled" || input.runStatus === "stopped") {
    lines.push(`Specflow detected that the previous run was stopped after ${node} completed.`);
  } else if (input.runStatus === "error") {
    lines.push(`Specflow detected that the previous run failed after ${node} completed${input.errorMsg ? `: ${input.errorMsg}` : ""}.`);
  } else {
    lines.push(`Specflow is resuming the conversation that backed ${node}.`);
  }
  lines.push(
    "Specflow cannot prove exactly where the interruption happened; you may have received none, part, or all of the original task.",
  );
  if (input.originalTask) {
    lines.push([
      "Best available rendered original task:",
      "<original_task>",
      input.originalTask,
      "</original_task>",
    ].join("\n"));
  }
  lines.push(
    "Before doing more work, briefly summarize what you completed in your last actions and what (if anything) was left undone. " +
    "Then, if it makes sense, finish the outstanding work. If you cannot tell what to do, ask me a clarifying question instead of guessing.",
  );
  return lines.join("\n\n");
}

function bestEffortRenderedOriginalTask(record: RunRecord, nodeId: string | undefined): string | undefined {
  if (!nodeId) return undefined;
  try {
    const prepared = prepareCanvasRun(record.agentflowSnapshot, {
      initialInput: record.initialInput,
      variableValues: record.variableValues,
    });
    const node = prepared.doc.nodes.find((candidate) => candidate.id === nodeId);
    return node?.kind === "step" ? node.prompt : undefined;
  } catch {
    const node = record.agentflowSnapshot.nodes.find((candidate) => candidate.id === nodeId);
    return node?.kind === "step" ? node.prompt : undefined;
  }
}

function upsertRunInvocation(record: RunRecord, input: {
  id: string;
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  purpose?: AgentInvocationPurpose;
  sourceNodeId?: string;
  targetNodeId?: string;
  specflowSessionId?: string;
  parentSpecflowSessionId?: string;
  agentId: string;
  agentServerId: string;
  lifecycle: LifecyclePayload;
}): void {
  const existingInvocationIndex = record.agentInvocations.findIndex((invocation) => invocation.id === input.id);
  const occurredAt = input.lifecycle.at ?? new Date().toISOString();
  const lifecycleSessionId = typeof input.lifecycle.sessionId === "string" ? input.lifecycle.sessionId : undefined;
  const parentSessionId = input.parentSpecflowSessionId;
  const error = typeof input.lifecycle.error === "string" ? input.lifecycle.error : undefined;

  if (existingInvocationIndex < 0) {
    record.agentInvocations.push({
      id: input.id,
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      nodeId: input.nodeId,
      edgeId: input.edgeId,
      purpose: input.purpose,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      agentId: input.agentId,
      agentServerId: input.agentServerId,
      sessionId: input.specflowSessionId,
      acpSessionId: lifecycleSessionId,
      parentSessionId,
      acpSessionForked: input.lifecycle.type === "session_forked" ? true : undefined,
      prompt: "",
      status: "running",
      startedAt: occurredAt,
    });
    return;
  }
  const existing = record.agentInvocations[existingInvocationIndex]!;
  if (lifecycleSessionId && !existing.acpSessionId) existing.acpSessionId = lifecycleSessionId;
  if (input.specflowSessionId && !existing.sessionId) existing.sessionId = input.specflowSessionId;
  if (parentSessionId && !existing.parentSessionId) existing.parentSessionId = parentSessionId;
  if (input.purpose && !existing.purpose) existing.purpose = input.purpose;
  if (input.sourceNodeId && !existing.sourceNodeId) existing.sourceNodeId = input.sourceNodeId;
  if (input.targetNodeId && !existing.targetNodeId) existing.targetNodeId = input.targetNodeId;
  if (input.lifecycle.type === "session_forked") existing.acpSessionForked = true;
  if (input.lifecycle.type === "session_closed" || input.lifecycle.type === "prompt_stopped") {
    if (existing.status === "running") existing.status = "done";
    if (!existing.completedAt) existing.completedAt = occurredAt;
  }
  if (input.lifecycle.type === "prompt_failed") {
    existing.status = "failed";
    existing.completedAt = occurredAt;
    if (error) existing.error = error;
  }
}

function upsertRunInvocationPrompt(record: RunRecord, input: {
  id: string;
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  purpose?: AgentInvocationPurpose;
  sourceNodeId?: string;
  targetNodeId?: string;
  agentId: string;
  agentServerId: string;
  sessionId?: string;
  prompt: string;
  at: string;
}): void {
  const existing = record.agentInvocations.find((invocation) => invocation.id === input.id);
  if (existing) {
    existing.prompt = input.prompt;
    existing.agentServerId ||= input.agentServerId;
    existing.sessionId ||= input.sessionId;
    existing.purpose ||= input.purpose;
    existing.sourceNodeId ||= input.sourceNodeId;
    existing.targetNodeId ||= input.targetNodeId;
    return;
  }
  record.agentInvocations.push({
    id: input.id,
    runId: input.runId,
    nodeRunId: input.nodeRunId,
    nodeId: input.nodeId,
    edgeId: input.edgeId,
    purpose: input.purpose,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    agentId: input.agentId,
    agentServerId: input.agentServerId,
    sessionId: input.sessionId,
    prompt: input.prompt,
    status: "running",
    startedAt: input.at,
  });
}

// ── API handler factory ───────────────────────────────────────────────────────

export function createApiHandler(bridge: SpecflowBridge, root: string) {
  const eventBus = new EventBus();
  const authTerminals = new AuthTerminalSessionStore({
    checkAuth: (agentServerId) => bridge.inspectAgentAuthentication(root, agentServerId),
  });
  const aflowMigrationTerminals = new TerminalSessionStore();
  const restoreStreams = new Map<string, RestoreStreamState>();
  const restoreControllers = new Map<string, AbortController>();
  const activeConversations = new Map<string, ActiveConversation>();
  const runControllers = new Map<string, AbortController>();
  const resumeRequests = new Set<string>();

  // Reconcile any runs left "running" from a previous process — server restart
  // or kill -9 — so the UI shows the real state instead of a stuck spinner.
  // The ACP session itself can still be resumed via the agent-session restore flow.
  void reconcileInterruptedRuns(root, "Server restart detected; run was interrupted before completion.")
    .then(async (ids) => {
      for (const id of ids) {
        try {
          await upsertAgentSessionsFromRun(await loadRun(id, root), root);
        } catch (error) {
          console.error(`Failed to rebuild agent sessions for interrupted run ${id}`, error);
        }
      }
      if (ids.length > 0) {
        console.log(`[specflow] reconciled ${ids.length} interrupted run(s):`, ids.join(", "));
      }
    })
    .catch((error) => console.error("Failed to reconcile interrupted runs", error));

  async function closeActiveConversation(active: ActiveConversation, reason = "Restored conversation closed."): Promise<void> {
    active.promptController?.abort();
    active.stopInteractionEvents();
    for (const interaction of bridge.interactions.list({ status: "pending" })) {
      if (interaction.agentInvocationId === active.interactionInvocationId) {
        bridge.interactions.cancel(interaction.id, reason);
      }
    }
    await active.waitForLogWrites();
    await active.conversation.close();
  }

  function publishRestoreEvent(event: RestoreStreamEvent): void {
    const state = restoreStreams.get(event.restoreId) ?? { events: [], done: false };
    state.events.push(event);
    if (closesRestoreStream(event)) {
      state.done = true;
    }
    restoreStreams.set(event.restoreId, state);
    eventBus.emit(`${event.restoreId}:restore`, event);
  }

  function restoreSseResponse(restoreId: string): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (event: RestoreStreamEvent) =>
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));

        const state = restoreStreams.get(restoreId);
        if (!state) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Restore not found" })}\n\n`));
          controller.close();
          return;
        }

        for (const event of state.events) {
          enqueue(event);
        }
        if (state.done) {
          controller.close();
          return;
        }

        cleanup = eventBus.on(`${restoreId}:restore`, (event) => {
          const restoreEvent = event as RestoreStreamEvent;
          enqueue(restoreEvent);
          if (closesRestoreStream(restoreEvent)) {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  function authTerminalSseResponse(sessionId: string): Response {
    const record = authTerminals.get(sessionId);
    if (!record) {
      return Response.json({ error: "Auth terminal session not found" }, { status: 404 });
    }
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (event: { type: string }) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };

        for (const event of record.events) enqueue(event);
        if (record.status !== "running") {
          controller.close();
          return;
        }
        cleanup = authTerminals.subscribe(sessionId, (event) => {
          enqueue(event);
          if (event.type === "status" && event.status !== "running") {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  function terminalSseResponse(
    store: TerminalSessionStore,
    sessionId: string,
    notFoundMessage: string,
  ): Response {
    const record = store.get(sessionId);
    if (!record) {
      return Response.json({ error: notFoundMessage }, { status: 404 });
    }
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (event: { type: string }) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };

        for (const event of record.events) enqueue(event);
        if (record.status !== "running") {
          controller.close();
          return;
        }
        cleanup = store.subscribe(sessionId, (event) => {
          enqueue(event);
          if (event.type === "status" && event.status !== "running") {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  function sseResponse(runId: string, options: { replay: boolean } = { replay: true }): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const enqueue = (type: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch (error) {
            if (!closed) throw error;
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        };

        enqueue("hello", { runId });

        let priorRunStatus: string | undefined;
        try {
          const prior = await loadRun(runId, root);
          priorRunStatus = prior.status;
        } catch {
          // Run may not exist yet; subscribe optimistically.
        }

        // Skip replay when the caller already loaded history in bulk via /logs.
        // Replaying 70k+ session_update events through SSE one-by-one floods
        // the client; batch load is O(1) on the React side.
        if (options.replay) {
          for (const event of await listRunLogEvents(root, runId)) {
            if (event.type === "acp_timeline") {
              if (event.kind !== "timeline_snapshot") enqueue("timeline", { ...event, replay: true });
            } else if (event.type === "terminal") {
              enqueue("terminal", {
                chunk: event.chunk,
                stream: event.stream,
                nodeId: event.nodeId,
                agentInvocationId: event.agentInvocationId,
                specflowSessionId: event.specflowSessionId,
                replay: true,
              });
            } else if (event.type === "session_update") {
              enqueue("session-update", { ...event, replay: true });
            } else if (event.type === "agent_prompt") {
              enqueue("agent-prompt", { ...event, replay: true });
            } else if (event.type === "agent_lifecycle") {
              enqueue("agent-lifecycle", { ...event, replay: true });
            } else if (event.type === "node_status") {
              enqueue("node-status", {
                nodeId: event.nodeId,
                status: event.status === "done" ? "success" : event.status,
                runId,
                ...(event.gateDecision ? { gateDecision: event.gateDecision, gateBranches: event.gateBranches } : {}),
                replay: true,
              });
            }
          }
        }

        const unsubscribeNode = eventBus.on(`${runId}:node`, (event) => enqueue("node-status", event));
        const unsubscribeInteraction = bridge.interactions.subscribe(runId, (interaction) => {
          enqueue("interaction-requested", interaction);
        });
        const unsubscribeRun = eventBus.on(`${runId}:run`, (event) => {
          enqueue("run-status", event);
          const runStatusEvent = event as { status: string };
          if (isTerminalRunRecordStatus(runStatusEvent.status)) {
            setTimeout(close, 200);
          }
        });
        const unsubscribeTerminal = eventBus.on(`${runId}:term`, (event) => enqueue("terminal", event));
        const unsubscribeSessionUpdate = eventBus.on(`${runId}:session-update`, (event) => enqueue("session-update", event));
        const unsubscribeAgentPrompt = eventBus.on(`${runId}:agent-prompt`, (event) => enqueue("agent-prompt", event));
        const unsubscribeAgentLifecycle = eventBus.on(`${runId}:agent-lifecycle`, (event) => enqueue("agent-lifecycle", event));
        const unsubscribeTimeline = eventBus.on(`${runId}:timeline`, (event) => enqueue("timeline", event));

        for (const interaction of bridge.interactions.list({ runId, status: "pending" })) {
          enqueue("interaction-requested", interaction);
        }

        if (priorRunStatus) {
          let priorControl: RunRecord["control"] | undefined;
          try {
            priorControl = (await loadRun(runId, root)).control;
          } catch {
            // Keep the replay status even if the run disappears.
          }
          enqueue("run-status", { runId, status: priorRunStatus, control: priorControl, replay: true });
          if (isTerminalRunRecordStatus(priorRunStatus)) setTimeout(close, 50);
        }

        cleanup = () => {
          unsubscribeNode(); unsubscribeRun(); unsubscribeTerminal(); unsubscribeSessionUpdate(); unsubscribeAgentPrompt(); unsubscribeAgentLifecycle(); unsubscribeTimeline(); unsubscribeInteraction();
        };
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  async function handleRun(
    workflowId: string,
    initialInput: string,
    variableValues: Record<string, string>,
    snapshot?: { agentflow: AgentFlowDoc; layout: CanvasLayoutDoc },
    resumeFrom?: { state: WorkflowResumeState; source: RunRecord },
    playFrom?: { record: RunRecord; checkpoint: WorkflowExecutionCheckpoint },
  ): Promise<Response> {
    let agentflow: AgentFlowDoc;
    let layout: CanvasLayoutDoc;
    if (snapshot) {
      agentflow = snapshot.agentflow;
      layout = snapshot.layout;
    } else {
      try {
        agentflow = await loadAgentFlow(workflowId, root);
        layout = await loadOrCreateCanvasLayout(agentflow, root);
      } catch (error) {
        const notFound = (error as { code?: string }).code === "ENOENT";
        return Response.json({ error: notFound ? "Agentflow not found" : errorMessage(error) }, { status: notFound ? 404 : 400 });
      }
    }

    let authStatuses: AgentAuthenticationStatus[];
    try {
      assertServerRunnableAgentFlow(agentflow, new Map((await bridge.listAgentServers(root)).map((entry) => [entry.id, entry])));
      authStatuses = await inspectWorkflowAuthentication(agentflow);
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 409 });
    }
    const requiredAuth = authStatuses.filter((status) => status.needsAuth);
    if (requiredAuth.length > 0) {
      return Response.json({
        error: "Agent authentication required",
        authStatuses: requiredAuth,
      }, { status: 409 });
    }

    const prepared = prepareCanvasRun(agentflow, { initialInput, variableValues });
    if (prepared.missingVariables.length > 0) {
      return Response.json({
        error: "Missing required variables",
        missingVariables: prepared.missingVariables.map((variable) => ({
          name: variable.name,
          description: variable.description,
        })),
      }, { status: 400 });
    }

    const workflow = canvasToWorkflow(prepared.doc);
    const runId = playFrom?.record.id ?? uuidv7();
    const runController = new AbortController();
    runControllers.set(runId, runController);

    let record: RunRecord;
    if (playFrom) {
      record = playFrom.record;
      record.status = "running";
      record.errorMsg = undefined;
      record.control = undefined;
      record.checkpoint = undefined;
      record.agentflowSnapshot = agentflow;
      record.canvasSnapshot = layout;
      record.initialInput = initialInput;
      record.variableValues = variableValues;
    } else {
      const existingCount = (await listRuns(workflowId, root)).length;
      const label = `Run #${existingCount + 1}`;

      const initialNodeStates: Record<string, RunState> = {};
      for (const node of agentflow.nodes) {
        initialNodeStates[node.id] = "pending";
      }

      // A continued run inherits completed work only. Interrupted or failed work
      // belongs to the source run and starts pending until this run re-enters it.
      const seededNodeStates: Record<string, RunState> = { ...initialNodeStates };
      if (resumeFrom) {
        for (const [nodeId, state] of Object.entries(resumeFrom.state.nodeStates)) {
          if (state === "done" || state === "success") seededNodeStates[nodeId] = "success";
        }
      }
      record = {
        id: runId,
        workflowId,
        label,
        status: "running",
        startedAt: new Date().toISOString(),
        agent: agentflow.sessions[0]?.agentServerId ?? agentflow.sessions[0]?.agent ?? "unconfigured",
        nodeStates: seededNodeStates,
        nodeOutputs: resumeFrom ? { ...resumeFrom.state.nodeOutputs } : {},
        agentInvocations: [],
        agentSessions: [],
        agentflowSnapshot: agentflow, // store pre-substitution snapshots
        canvasSnapshot: layout,
        initialInput,
        variableValues,
        ...(resumeFrom ? { resumedFromRunId: resumeFrom.source.id } : {}),
      };
    }

    await saveRun(record, root);
    const runStatusAt = playFrom ? new Date().toISOString() : record.startedAt;
    if (resumeFrom) {
      resumeFrom.source.resumedByRunId = runId;
      await saveRun(resumeFrom.source, root);
    }
    await appendRunLogEvent(root, {
      type: "run_status",
      runId,
      workflowId,
      status: "running",
      at: runStatusAt,
    });

    let lastTermSeq = 0;
    let currentNodeId: string | undefined;
    const invocationNodeMap = new Map<string, string>();
    const invocationSessionMap = new Map<string, string>();
    let logWrite = Promise.resolve();
    const appendLog = (event: Parameters<typeof appendRunLogEvent>[1]) => {
      logWrite = logWrite
        .then(() => appendRunLogEvent(root, event))
        .catch((error) => {
          console.error("Failed to append run log", error);
        });
    };
    const timeline = new AcpTimelinePipeline({
      source: "agentflow",
      scopeId: runId,
      append: (event) => appendRunLogEvent(root, { ...event, runId } as AcpTimelineEvent & { runId: string }),
      emit: (event) => eventBus.emit(`${runId}:timeline`, event),
      base: { runId },
    });
    const offInteractionLog = bridge.interactions.subscribe(runId, (interaction) => {
      appendLog({ type: "interaction", ...interactionAuditRecord(interaction) });
    });

    const flushTerminalEvents = () => {
      const terminalEvents = bridge.terminalEvents.list({ runId });
      for (const terminalEvent of terminalEvents) {
        if (terminalEvent.sequence > lastTermSeq) {
          lastTermSeq = terminalEvent.sequence;
          const attributedNodeId = (terminalEvent.agentInvocationId && invocationNodeMap.get(terminalEvent.agentInvocationId))
            ?? currentNodeId;
          const specflowSessionId = terminalEvent.agentInvocationId
            ? invocationSessionMap.get(terminalEvent.agentInvocationId)
            : undefined;
          const event = { type: "terminal" as const, ...terminalEvent, nodeId: attributedNodeId, specflowSessionId };
          appendLog(event);
          timeline.record({
            kind: "terminal",
            turnId: terminalEvent.agentInvocationId,
            text: terminalEvent.chunk,
            stream: terminalEvent.stream,
            nodeId: attributedNodeId,
            agentInvocationId: terminalEvent.agentInvocationId,
            specflowSessionId,
          });
          eventBus.emit(`${runId}:term`, {
            chunk: terminalEvent.chunk,
            stream: terminalEvent.stream,
            nodeId: attributedNodeId,
            agentInvocationId: terminalEvent.agentInvocationId,
            specflowSessionId,
          });
        }
      }
    };

    const onNodeStatus = (nodeStatus: NodeStatusEvent) => {
      const uiStatus: RunState =
        nodeStatus.status === "done" ? "success" :
        nodeStatus.status === "failed" ? "error" :
        nodeStatus.status === "paused" ? "paused" :
        nodeStatus.status === "interrupted" ? "interrupted" :
        nodeStatus.status === "cancelled" ? "cancelled" :
        nodeStatus.status === "running" ? "running" : "pending";

      if (nodeStatus.status === "running") {
        currentNodeId = nodeStatus.nodeId;
      }

      record.nodeStates[nodeStatus.nodeId] = uiStatus;
      if (uiStatus === "running") record.activeNode = nodeStatus.nodeId;
      if (uiStatus === "paused") record.pausedNodeId = nodeStatus.nodeId;
      if (uiStatus === "interrupted") {
        record.activeNode = nodeStatus.nodeId;
        record.control = { ...(record.control ?? {}), interruptedNodeId: nodeStatus.nodeId };
      }
      if (uiStatus === "success" && record.pausedNodeId === nodeStatus.nodeId) record.pausedNodeId = undefined;

      if (nodeStatus.status === "done" && (nodeStatus as NodeStatusEvent & { output?: string }).output) {
        record.nodeOutputs[nodeStatus.nodeId] = (nodeStatus as NodeStatusEvent & { output?: string }).output!;
      }

      void saveRun(record, root);
      appendLog({ type: "node_status", ...nodeStatus });
      eventBus.emit(`${runId}:node`, {
        nodeId: nodeStatus.nodeId,
        status: uiStatus,
        runId,
        ...(nodeStatus.gateDecision ? { gateDecision: nodeStatus.gateDecision, gateBranches: nodeStatus.gateBranches } : {}),
      });
      flushTerminalEvents();
    };

    const onRunStatus = (runStatus: RunStatusEvent) => {
      const terminal = runStatus.status === "done" || runStatus.status === "failed" || runStatus.status === "cancelled";
      if (runStatus.status === "running") {
        record.status = "running";
        delete record.control?.pauseRequested;
        delete record.control?.intent;
        delete record.errorMsg;
      } else if (runStatus.status === "paused") {
        record.status = "paused";
        record.control = { ...(record.control ?? {}), reason: runStatus.error };
        delete record.control.intent;
      } else if (runStatus.status === "interrupted") {
        record.status = "interrupted";
        record.errorMsg = runStatus.error;
        record.control = { ...(record.control ?? {}), reason: runStatus.error };
        delete record.control.intent;
      } else if (runStatus.status === "done") {
        const completedAt = new Date().toISOString();
        record.completedAt = completedAt;
        record.duration = formatDuration(record.startedAt, completedAt);
        record.status = "success";
        delete record.control;
        delete record.checkpoint;
      } else if (runStatus.status === "failed") {
        const completedAt = new Date().toISOString();
        record.completedAt = completedAt;
        record.duration = formatDuration(record.startedAt, completedAt);
        record.status = "error";
        record.errorMsg = runStatus.error;
        delete record.control;
      } else if (runStatus.status === "cancelled") {
        const completedAt = new Date().toISOString();
        record.completedAt = completedAt;
        record.duration = formatDuration(record.startedAt, completedAt);
        record.status = "stopped";
        record.errorMsg = runStatus.error;
        delete record.control;
      }
      flushTerminalEvents();
      if (terminal) {
        bridge.interactions.cancelPendingForRun(runId, `run ${record.status}`);
        bridge.pauses.cancelForRun(runId, `run ${record.status}`);
        bridge.runControls.clear(runId);
      }
      void saveRun(record, root);
      appendLog({ type: "run_status", ...runStatus });
      eventBus.emit(`${runId}:run`, { runId, status: record.status, workflowId, error: record.errorMsg, control: record.control });
      if (terminal) offInteractionLog();
    };

    const onCheckpoint = async (checkpointEvent: WorkflowCheckpointEvent) => {
      record.status = checkpointEvent.status;
      record.checkpoint = checkpointEvent.checkpoint as unknown as Record<string, unknown>;
      record.control = {
        ...(record.control ?? {}),
        ...(checkpointEvent.status === "paused" ? { pauseRequested: false } : {}),
        ...(checkpointEvent.nodeId ? { interruptedNodeId: checkpointEvent.nodeId } : {}),
        ...(checkpointEvent.reason ? { reason: checkpointEvent.reason } : {}),
      };
      delete record.control.intent;
      if (checkpointEvent.status === "interrupted") {
        record.activeNode = checkpointEvent.nodeId;
        record.errorMsg = checkpointEvent.reason;
      }
      await saveRun(record, root);
      eventBus.emit(`${runId}:run`, {
        runId,
        status: record.status,
        workflowId,
        error: record.errorMsg,
        control: record.control,
      });
    };

    const reloadWorkflowSnapshot = () => {
      const nextPrepared = prepareCanvasRun(record.agentflowSnapshot, {
        initialInput: record.initialInput,
        variableValues: record.variableValues,
      });
      return canvasToWorkflow(nextPrepared.doc);
    };

    const executor = new WorkflowExecutor({
      cwd: root,
      terminalEvents: bridge.terminalEvents,
      onNodeStatus,
      onRunStatus,
      onCheckpoint,
      onAgentLifecycle: (event) => {
        const {
          runId,
          nodeRunId,
          nodeId,
          edgeId,
          purpose,
          sourceNodeId,
          targetNodeId,
          specflowSessionId,
          parentSpecflowSessionId,
          agentInvocationId,
          agentId,
          agentServerId,
          ...lifecycle
        } = event;
        if (agentInvocationId && nodeId) {
          invocationNodeMap.set(agentInvocationId, nodeId);
        }
        // Prefer the executor-provided sessionId (covers edge-handoff
        // invocations which have no nodeId). Fall back to deriving from the
        // node for older code paths.
        if (agentInvocationId && event.specflowSessionId) {
          invocationSessionMap.set(agentInvocationId, event.specflowSessionId);
        } else if (agentInvocationId && nodeId) {
          const node = agentflow.nodes.find((candidate) => candidate.id === nodeId);
          if (node?.kind === "step" && node.sessionId) {
            invocationSessionMap.set(agentInvocationId, node.sessionId);
          }
        }
        // Persist invocation rows incrementally so an unexpected shutdown
        // still leaves enough metadata to drive a "resume run" action later.
        if (agentInvocationId) {
          upsertRunInvocation(record, {
            id: agentInvocationId,
            runId,
            nodeRunId,
            nodeId,
            edgeId,
            purpose,
            sourceNodeId,
            targetNodeId,
            specflowSessionId,
            parentSpecflowSessionId: lifecycle.type === "session_forked" ? parentSpecflowSessionId : undefined,
            agentId,
            agentServerId,
            lifecycle,
          });
          void saveRun(record, root);
        }
        const lifecycleLogEvent = {
          type: "agent_lifecycle",
          runId,
          nodeRunId,
          nodeId,
          edgeId,
          purpose,
          sourceNodeId,
          targetNodeId,
          specflowSessionId,
          parentSpecflowSessionId,
          agentInvocationId,
          agentId,
          agentServerId,
          lifecycle,
        } as const;
        const lifecycleRecord = lifecycle as { type?: string; sessionId?: string };
        appendLog(lifecycleLogEvent);
        timeline.record({
          kind: "lifecycle",
          turnId: agentInvocationId,
          eventType: typeof lifecycleRecord.type === "string" ? lifecycleRecord.type : "agent_lifecycle",
          data: lifecycleLogEvent,
          nodeId,
          agentInvocationId,
          agentServerId,
          specflowSessionId,
          sessionId: typeof lifecycleRecord.sessionId === "string" ? lifecycleRecord.sessionId : undefined,
        });
        eventBus.emit(`${runId}:agent-lifecycle`, lifecycleLogEvent);
      },
      onAgentPrompt: (event) => {
        upsertRunInvocationPrompt(record, {
          id: event.agentInvocationId,
          runId: event.runId,
          nodeRunId: event.nodeRunId,
          nodeId: event.nodeId,
          edgeId: event.edgeId,
          purpose: event.purpose,
          sourceNodeId: event.sourceNodeId,
          targetNodeId: event.targetNodeId,
          agentId: event.agentId,
          agentServerId: event.agentServerId,
          sessionId: event.specflowSessionId,
          prompt: event.prompt,
          at: event.at,
        });
        void saveRun(record, root);
        const promptLogEvent = { type: "agent_prompt", ...event } as const;
        appendLog(promptLogEvent);
        timeline.record({
          kind: "user_message",
          turnId: event.agentInvocationId,
          text: event.prompt,
          nodeId: event.nodeId,
          agentInvocationId: event.agentInvocationId,
          agentServerId: event.agentServerId,
          specflowSessionId: event.specflowSessionId,
        });
        eventBus.emit(`${event.runId}:agent-prompt`, promptLogEvent);
      },
      onAgentSessionUpdate: (event) => {
        if (event.agentInvocationId && event.nodeId) {
          invocationNodeMap.set(event.agentInvocationId, event.nodeId);
        }
        // Catch invocations that REUSE an ACP session (no fresh session_created
        // event of their own) — their acpSessionId only shows up on session_update.
        // Seed once per invocation to avoid saving on every chunk.
        if (event.agentInvocationId && event.sessionId) {
          const invocation = record.agentInvocations.find((candidate) => candidate.id === event.agentInvocationId);
          if (invocation && !invocation.acpSessionId) {
            invocation.acpSessionId = event.sessionId;
            void saveRun(record, root);
          }
        }
        const specflowSessionId = event.specflowSessionId
          ?? (event.agentInvocationId ? invocationSessionMap.get(event.agentInvocationId) : undefined);
        // Persist specflowSessionId in the log too so SSE replay on a later
        // page load routes events to the correct session tab.
        const persisted = { type: "session_update" as const, ...event, specflowSessionId };
        appendLog(persisted);
        recordAgentflowSessionUpdate(timeline, persisted);
        eventBus.emit(`${runId}:session-update`, persisted);
      },
      interactions: bridge.interactions,
      pauses: bridge.pauses,
      runControls: bridge.runControls,
    });

    void executor.run(workflow, prepared.initialInput, {
        runId,
        signal: runController.signal,
        ...(resumeFrom ? { resumeFrom: resumeFrom.state } : {}),
        ...(playFrom ? { checkpoint: playFrom.checkpoint } : {}),
        reloadWorkflow: reloadWorkflowSnapshot,
      })
      .then(async (workflowRun) => {
        timeline.snapshot({ status: "success" });
        await timeline.flush();
        await logWrite;
        record.agentInvocations = mergeRunInvocations(record.agentInvocations, workflowRun.agentInvocations);
        await saveRun(record, root);
        await upsertAgentSessionsFromRun(record, root);
      })
      .catch(async () => {
        // On cancel/error the .then path never runs, so agentSessions would
        // stay empty even though incremental upserts populated agentInvocations
        // with valid acpSessionIds. Rebuild explicitly so resume lookups don't
        // have to fix this up after the fact.
        try {
          timeline.snapshot({ status: record.status === "stopped" ? "cancelled" : "failed" });
          await timeline.flush();
          await logWrite;
          await upsertAgentSessionsFromRun(record, root);
        } catch (error) {
          console.error("Failed to rebuild agent sessions after run failure", error);
        }
      })
      .finally(() => {
        runControllers.delete(runId);
      });

    return Response.json({ runId });
  }

  function recordAgentflowSessionUpdate(
    timeline: AcpTimelinePipeline,
    event: {
      sessionId?: string;
      update: unknown;
      nodeId?: string;
      agentInvocationId?: string;
      agentServerId?: string;
      specflowSessionId?: string;
    },
  ): void {
    const update = event.update && typeof event.update === "object" ? event.update as Record<string, unknown> : {};
    const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
    const base = {
      turnId: event.agentInvocationId,
      nodeId: event.nodeId,
      agentInvocationId: event.agentInvocationId,
      agentServerId: event.agentServerId,
      sessionId: event.sessionId,
      specflowSessionId: event.specflowSessionId,
    };
    if (kind === "agent_message_chunk" || kind === "user_message_chunk" || kind === "agent_thought_chunk") {
      const text = acpContentText(update.content);
      if (!text) return;
      timeline.record(kind === "user_message_chunk"
        ? { ...base, kind: "user_message", text }
        : { ...base, kind: "assistant_delta", text, role: kind === "agent_thought_chunk" ? "thought" : "assistant" });
      return;
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
      if (!toolCallId) return;
      timeline.record({
        ...base,
        kind,
        toolCallId,
        title: typeof update.title === "string" ? update.title : undefined,
        status: typeof update.status === "string" ? update.status : undefined,
        toolKind: typeof update.kind === "string" ? update.kind : undefined,
        content: update.content,
        locations: update.locations,
        rawInput: update.rawInput,
        rawOutput: update.rawOutput,
      });
      return;
    }
    if (kind) {
      timeline.record({
        ...base,
        kind: "lifecycle",
        eventType: kind,
        data: event.update,
      });
    }
  }

  function acpContentText(content: unknown): string {
    const block = content && typeof content === "object" ? content as { type?: unknown; text?: unknown } : {};
    if (block.type === "text" && typeof block.text === "string") return block.text;
    return typeof block.type === "string" ? `[${block.type}]` : "";
  }

  async function inspectWorkflowAuthentication(agentflow: AgentFlowDoc): Promise<AgentAuthenticationStatus[]> {
    const servers = new Map((await bridge.listAgentServers(root)).map((entry) => [entry.id, entry]));
    const agentServerIds = [...new Set(agentflow.sessions
      .map((session) => session.agentServerId ?? session.agent)
      .filter((id): id is string => Boolean(id) && id !== "unconfigured"))];

    return Promise.all(agentServerIds
      .filter((id) => servers.get(id)?.settings.type !== "headless")
      .map((id) => bridge.inspectAgentAuthentication(root, id)));
  }

  async function handleRestore(agentSessionId: string, mode: AgentRestoreMode): Promise<Response> {
    let session: Awaited<ReturnType<typeof loadAgentSession>>;
    try {
      session = await loadAgentSession(root, agentSessionId);
    } catch {
      return Response.json({ error: "Agent session not found" }, { status: 404 });
    }

    const restoreId = uuidv7();
    const restoreController = new AbortController();
    restoreControllers.set(restoreId, restoreController);
    const startedAt = new Date().toISOString();
    const requestedAttempt = {
      id: restoreId,
      requestedMode: mode,
      status: "requested" as const,
      startedAt,
    };
    await recordAgentSessionRestoreAttempt(root, session.id, requestedAttempt);
    await appendRunLogEvent(root, {
      type: "restore_attempt",
      runId: session.latestRunId,
      agentSessionId: session.id,
      agentServerId: session.agentServerId,
      acpSessionId: session.acpSessionId,
      requestedMode: mode,
      status: "requested",
      at: startedAt,
    });

    publishRestoreEvent({
      type: "restore-status",
      restoreId,
      agentSessionId: session.id,
      runId: session.latestRunId,
      requestedMode: mode,
      status: "requested",
      at: startedAt,
    });

    let conversation: AgentConversation | undefined;
    let persistContinuedUpdates = false;
    let continuedLogWrite = Promise.resolve();
    const interactionInvocationId = `restore:${restoreId}`;
    const latestInvocation = session.invocations.find((entry) => entry.invocationId === session.latestInvocationId)
      ?? session.invocations.at(-1);
    const interactionContext: RunInteractionContext = {
      runId: session.latestRunId,
      nodeRunId: latestInvocation?.nodeRunId,
      nodeId: latestInvocation?.nodeId,
      edgeId: latestInvocation?.edgeId,
      agentInvocationId: interactionInvocationId,
      agentId: session.agentId,
      agentServerId: session.agentServerId,
      specflowSessionId: session.specflowSessionId,
      acpSessionId: session.acpSessionId,
    };
    const stopInteractionEvents = mode === "continue"
      ? bridge.interactions.subscribe(session.latestRunId, (interaction) => {
          if (interaction.agentInvocationId !== interactionInvocationId) return;
          void appendRunLogEvent(root, { type: "interaction", ...interactionAuditRecord(interaction) })
            .catch((error) => console.error("Failed to append restored conversation interaction log", error));
          publishRestoreEvent({
            type: "interaction-requested",
            restoreId,
            interaction,
            at: new Date().toISOString(),
          });
        })
      : () => {};
    void bridge.openAgentConversation({
      agentServerId: session.agentServerId,
      sessionId: session.acpSessionId,
      mode,
      cwd: root,
      signal: restoreController.signal,
      onTerminalEvent: (event) => {
        publishRestoreEvent({
          type: "terminal",
          restoreId,
          agentSessionId: session.id,
          stream: event.stream,
          chunk: event.chunk,
          at: new Date().toISOString(),
        });
      },
      onSessionUpdate: (event) => {
        const occurredAt = new Date().toISOString();
        if (persistContinuedUpdates) {
          continuedLogWrite = continuedLogWrite
            .then(() => appendRunLogEvent(root, {
              type: "session_update",
              runId: session.latestRunId,
              nodeRunId: latestInvocation?.nodeRunId,
              nodeId: latestInvocation?.nodeId,
              edgeId: latestInvocation?.edgeId,
              agentInvocationId: interactionInvocationId,
              agentId: session.agentId,
              agentServerId: session.agentServerId,
              sessionId: event.sessionId,
              update: event.update,
              at: occurredAt,
            }))
            .catch((error) => console.error("Failed to append restored conversation session update log", error));
        }
        publishRestoreEvent({
          type: "session-update",
          restoreId,
          agentSessionId: session.id,
          sessionId: event.sessionId,
          update: event.update,
          at: occurredAt,
        });
      },
      onPermissionRequest: mode === "continue"
        ? (request) => bridge.interactions.requestPermission(interactionContext, request)
        : undefined,
      onElicitationRequest: mode === "continue"
        ? (request) => bridge.interactions.requestElicitation(interactionContext, request)
        : undefined,
      onElicitationComplete: mode === "continue"
        ? (notification) => bridge.interactions.recordElicitationComplete(interactionContext, notification)
        : undefined,
    }).then(async (opened) => {
      conversation = opened;
      return opened.restore();
    }).then(async (result) => {
      const completedAt = new Date().toISOString();
      await recordAgentSessionRestoreAttempt(root, session.id, {
        ...requestedAttempt,
        selectedPrimitive: result.selectedPrimitive,
        status: "success",
        completedAt,
      });
      await appendRunLogEvent(root, {
        type: "restore_attempt",
        runId: session.latestRunId,
        agentSessionId: session.id,
        agentServerId: session.agentServerId,
        acpSessionId: session.acpSessionId,
        requestedMode: mode,
        selectedPrimitive: result.selectedPrimitive,
        status: "success",
        at: completedAt,
      });
      if (mode === "continue") {
        activeConversations.set(restoreId, {
          conversation: conversation!,
          promptPending: false,
          interactionInvocationId,
          stopInteractionEvents,
          waitForLogWrites: () => continuedLogWrite,
        });
        persistContinuedUpdates = true;
      } else {
        await conversation?.close();
      }
      publishRestoreEvent({
        type: "restore-status",
        restoreId,
        agentSessionId: session.id,
        runId: session.latestRunId,
        requestedMode: mode,
        selectedPrimitive: result.selectedPrimitive,
        capabilities: {
          modes: result.loadResponse?.modes ?? result.resumeResponse?.modes ?? null,
          configOptions: result.loadResponse?.configOptions ?? result.resumeResponse?.configOptions ?? null,
        },
        status: "success",
        at: completedAt,
      });
    }).catch(async (error) => {
      stopInteractionEvents();
      await conversation?.close().catch(() => {});
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await recordAgentSessionRestoreAttempt(root, session.id, {
        ...requestedAttempt,
        status: "failure",
        completedAt,
        error: message,
      });
      await appendRunLogEvent(root, {
        type: "restore_attempt",
        runId: session.latestRunId,
        agentSessionId: session.id,
        agentServerId: session.agentServerId,
        acpSessionId: session.acpSessionId,
        requestedMode: mode,
        status: "failure",
        error: message,
        at: completedAt,
      });
      publishRestoreEvent({
        type: "restore-status",
        restoreId,
        agentSessionId: session.id,
        runId: session.latestRunId,
        requestedMode: mode,
        status: "failure",
        error: message,
        at: completedAt,
      });
    }).finally(() => {
      restoreControllers.delete(restoreId);
    });

    return Response.json({
      restoreId,
      agentSessionId: session.id,
      runId: session.latestRunId,
      status: "running",
      requestedMode: mode,
    });
  }

  return async function handleApiRequest(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const { pathname } = url;

    // GET /api/agent-servers
    if (request.method === "GET" && pathname === "/api/agent-servers") {
      const entries = await listAgentServerEntries(bridge, root);
      return Response.json(redactAgentServerEntries(entries));
    }

    // GET /api/agent-servers/registry
    if (request.method === "GET" && pathname === "/api/agent-servers/registry") {
      return Response.json(await bridge.listAgentRegistry(root));
    }

    // GET /api/agent-servers/:id/auth
    const agentServerAuthMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/auth$/);
    if (agentServerAuthMatch && request.method === "GET") {
      try {
        return Response.json(await bridge.inspectAgentAuthentication(root, decodeURIComponent(agentServerAuthMatch[1])));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // POST /api/agent-servers/:id/auth/:methodId
    const agentServerAuthMethodMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/auth\/([^/]+)$/);
    if (agentServerAuthMethodMatch && request.method === "POST") {
      const id = decodeURIComponent(agentServerAuthMethodMatch[1]);
      const methodId = decodeURIComponent(agentServerAuthMethodMatch[2]);
      try {
        const terminalTask = await bridge.resolveAgentTerminalAuthTask(root, id, methodId);
        if (terminalTask) {
          const terminalSessionId = authTerminals.start(terminalTask);
          return Response.json({ status: "terminal_started", terminalSessionId });
        }
        return Response.json(await bridge.authenticateAgentServer(root, id, methodId));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // GET /api/agent-auth-terminals/:sessionId/events
    const authTerminalMatch = pathname.match(/^\/api\/agent-auth-terminals\/([^/]+)$/);
    const authTerminalEventsMatch = pathname.match(/^\/api\/agent-auth-terminals\/([^/]+)\/events$/);
    if (authTerminalEventsMatch && request.method === "GET") {
      return authTerminalSseResponse(decodeURIComponent(authTerminalEventsMatch[1]));
    }

    if (authTerminalMatch && request.method === "GET") {
      const record = authTerminals.get(decodeURIComponent(authTerminalMatch[1]));
      if (!record) return Response.json({ error: "Auth terminal session not found" }, { status: 404 });
      return Response.json({
        sessionId: record.id,
        agentServerId: record.task.agentServerId,
        methodId: record.task.methodId,
        label: record.task.label,
        status: record.status,
      });
    }

    // POST /api/agent-auth-terminals/:sessionId/(input|resize|cancel|check)
    const authTerminalActionMatch = pathname.match(/^\/api\/agent-auth-terminals\/([^/]+)\/(input|resize|cancel|check)$/);
    if (authTerminalActionMatch && request.method === "POST") {
      const sessionId = decodeURIComponent(authTerminalActionMatch[1]);
      const action = authTerminalActionMatch[2];
      try {
        if (action === "input") {
          const body = await request.json().catch(() => ({})) as { data?: unknown };
          if (typeof body.data !== "string") return Response.json({ error: "Missing input data" }, { status: 400 });
          authTerminals.input(sessionId, body.data);
          return Response.json({ ok: true });
        }
        if (action === "resize") {
          const body = await request.json().catch(() => ({})) as { cols?: unknown; rows?: unknown };
          if (typeof body.cols !== "number" || typeof body.rows !== "number") {
            return Response.json({ error: "Missing terminal size" }, { status: 400 });
          }
          authTerminals.resize(sessionId, body.cols, body.rows);
          return Response.json({ ok: true });
        }
        if (action === "cancel") {
          await authTerminals.cancel(sessionId);
          return Response.json({ ok: true });
        }
        const authStatus = await authTerminals.check(sessionId);
        return Response.json({ ok: true, authStatus });
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 404 });
      }
    }

    // POST /api/aflow/migrations — start an Aflow terminal to migrate a v1 workflow to v2.
    if (pathname === "/api/aflow/migrations" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as { workflowId?: unknown };
      if (typeof body.workflowId !== "string" || body.workflowId.trim() === "") {
        return Response.json({ error: "Missing workflowId" }, { status: 400 });
      }
      const workflowId = body.workflowId.trim();
      const serverUrl = new URL("/", request.url).toString();
      const task = buildAflowMigrationTask({ root, workflowId, serverUrl });
      try {
        const terminalSessionId = aflowMigrationTerminals.start(task);
        return Response.json({ terminalSessionId, label: task.label ?? workflowId });
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    const aflowMigrationMatch = pathname.match(/^\/api\/aflow\/migrations\/([^/]+)$/);
    const aflowMigrationEventsMatch = pathname.match(/^\/api\/aflow\/migrations\/([^/]+)\/events$/);
    if (aflowMigrationEventsMatch && request.method === "GET") {
      return terminalSseResponse(
        aflowMigrationTerminals,
        decodeURIComponent(aflowMigrationEventsMatch[1]),
        "Aflow migration terminal session not found",
      );
    }
    if (aflowMigrationMatch && request.method === "GET") {
      const record = aflowMigrationTerminals.get(decodeURIComponent(aflowMigrationMatch[1]));
      if (!record) return Response.json({ error: "Aflow migration terminal session not found" }, { status: 404 });
      return Response.json({
        sessionId: record.id,
        label: record.task.label,
        status: record.status,
      });
    }
    const aflowMigrationActionMatch = pathname.match(/^\/api\/aflow\/migrations\/([^/]+)\/(input|resize|cancel)$/);
    if (aflowMigrationActionMatch && request.method === "POST") {
      const sessionId = decodeURIComponent(aflowMigrationActionMatch[1]);
      const action = aflowMigrationActionMatch[2];
      try {
        if (action === "input") {
          const body = await request.json().catch(() => ({})) as { data?: unknown };
          if (typeof body.data !== "string") return Response.json({ error: "Missing input data" }, { status: 400 });
          aflowMigrationTerminals.input(sessionId, body.data);
          return Response.json({ ok: true });
        }
        if (action === "resize") {
          const body = await request.json().catch(() => ({})) as { cols?: unknown; rows?: unknown };
          if (typeof body.cols !== "number" || typeof body.rows !== "number") {
            return Response.json({ error: "Missing terminal size" }, { status: 400 });
          }
          aflowMigrationTerminals.resize(sessionId, body.cols, body.rows);
          return Response.json({ ok: true });
        }
        aflowMigrationTerminals.cancel(sessionId);
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 404 });
      }
    }

    // PUT /api/agent-servers/:id
    const agentServerMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)$/);
    if (agentServerMatch && request.method === "PUT") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      let settings = parseAgentServerSettings(body);
      if (!settings) {
        return Response.json({ error: "Invalid agent server settings" }, { status: 400 });
      }
      settings = await preserveRedactedEnvValues(root, decodeURIComponent(agentServerMatch[1]), settings);
      const id = decodeURIComponent(agentServerMatch[1]);
      await upsertLocalAgentServer(root, id, settings);
      if (settings.type === "registry") {
        try {
          await bridge.ensureAgentServerInstalled(root, id);
        } catch (error) {
          return Response.json({ error: errorMessage(error) }, { status: 409 });
        }
      }
      return Response.json(redactAgentServerEntries(await listAgentServerEntries(bridge, root)));
    }

    // DELETE /api/agent-servers/:id
    if (agentServerMatch && request.method === "DELETE") {
      await removeLocalAgentServer(root, decodeURIComponent(agentServerMatch[1]));
      return Response.json(redactAgentServerEntries(await listAgentServerEntries(bridge, root)));
    }

    // GET /api/agent-servers/:id/capabilities
    // Returns the cached InitializeResponse.agentCapabilities + first session's
    // modes / configOptions / availableCommands snapshot. 404 means no probe yet
    // — the UI should fall back to a generic editor and offer the refresh button.
    const agentServerCapabilitiesMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/capabilities$/);
    if (agentServerCapabilitiesMatch && request.method === "GET") {
      const id = decodeURIComponent(agentServerCapabilitiesMatch[1]);
      const cached = await new AgentServerStore({ root }).getCapabilities(id);
      if (!cached) return Response.json({ error: "No capability snapshot cached for this agent." }, { status: 404 });
      return Response.json(cached);
    }

    // POST /api/agent-servers/:id/capabilities/refresh
    // Spawns a throwaway ACP session purely to refresh the cache. Used when
    // the user knows their settings changed without an installedVersion bump
    // (env vars / args / etc.) and wants the UI to see new modes immediately.
    const agentServerCapabilitiesRefreshMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/capabilities\/refresh$/);
    if (agentServerCapabilitiesRefreshMatch && request.method === "POST") {
      const id = decodeURIComponent(agentServerCapabilitiesRefreshMatch[1]);
      const store = new AgentServerStore({ root });
      try {
        const resolved = await store.resolve(id);
        if (resolved.source === "headless") {
          return Response.json({ error: "Headless agent runtimes do not advertise ACP capabilities." }, { status: 409 });
        }
        const probe = await probeAcpAgentCapabilities({ resolved, cwd: root });
        await store.setCapabilities(id, probe);
        const refreshed = await store.getCapabilities(id);
        return Response.json(refreshed ?? probe);
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // GET /api/skills
    // Lists every skill the user has authored under `~/.agents/skills/` or
    // `<workspace>/.agents/skills/`. Powers the UI slash-command popup. Body
    // payloads are omitted from this listing — they ship with the prompt
    // when the executor injects them, not over a separate fetch.
    if (request.method === "GET" && pathname === "/api/skills") {
      const allSkills = await new SkillStore({ root }).list();
      // Dedupe for display: list() returns both scopes, but the popup only
      // needs the winning skill per name. list() is sorted projectLocal-first
      // within a name group, so the first occurrence is the winner.
      const seen = new Set<string>();
      const skills = allSkills.filter((skill) => {
        if (seen.has(skill.name)) return false;
        seen.add(skill.name);
        return true;
      });
      return Response.json(skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        filePath: skill.filePath,
        bodyPreview: skill.body.slice(0, 200),
      })));
    }

    // GET /api/canvases
    if (request.method === "GET" && pathname === "/api/canvases") {
      const list = await listCanvases(root);
      const runs = await listRuns(undefined, root);
      const runsByWorkflow = new Map<string, number>();
      for (const run of runs) {
        runsByWorkflow.set(run.workflowId, (runsByWorkflow.get(run.workflowId) ?? 0) + 1);
      }
      return Response.json(list.map((canvasSummary) => ({ ...canvasSummary, runs: runsByWorkflow.get(canvasSummary.id) ?? 0 })));
    }

    // POST /api/canvases  (create new canvas)
    if (request.method === "POST" && pathname === "/api/canvases") {
      let body: { key?: string; name?: string } = {};
      try { body = await request.json(); } catch { /* ok */ }
      const name = body.name ?? "Untitled workflow";
      let id = body.key ?? keyFromLabel(name, "untitled-workflow");
      try {
        assertSymbolKey(id, "workflow key");
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
      const existingIds = new Set((await listCanvases(root)).map((entry) => entry.id));
      if (existingIds.has(id)) {
        const base = id;
        let suffix = 2;
        while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
        id = `${base}-${suffix}`;
      }
      const canvasDocument: CanvasDoc = {
        id,
        version: 2,
        name,
        sessions: [],
        nodes: [{
          kind: "start",
          id: "start",
          alias: "START",
          title: "Start",
          x: 60,
          y: 80,
          w: 140,
          sessionId: null,
        }],
        edges: [],
        variables: [],
      };
      await saveCanvas(id, canvasDocument, root);
      return Response.json(canvasDocument);
    }

    // /api/canvases/:id
    const canvasMatch = pathname.match(/^\/api\/canvases\/([^/]+)$/);
    if (canvasMatch) {
      const id = canvasMatch[1];
      if (request.method === "GET") {
        try {
          const canvasDocument = await loadCanvas(id, root);
          return Response.json(canvasDocument);
        } catch (error) {
          const notFound = (error as { code?: string }).code === "ENOENT";
          return Response.json({ error: notFound ? "Not found" : errorMessage(error) }, { status: notFound ? 404 : 400 });
        }
      }
      if (request.method === "PUT") {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        try {
          await saveCanvas(id, body, root);
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({ error: errorMessage(error) }, { status: 400 });
        }
      }
      if (request.method === "DELETE") {
        await deleteCanvas(id, root);
        return Response.json({ ok: true });
      }
    }

    // POST /api/canvases/:id/assets
    const assetsMatch = pathname.match(/^\/api\/canvases\/([^/]+)\/assets$/);
    if (assetsMatch && request.method === "POST") {
      const workflowId = assetsMatch[1];
      const kind = url.searchParams.get("kind");
      const directory = url.searchParams.get("directory") === "true";
      if (kind !== "image" && kind !== "path") {
        return Response.json({ error: "Invalid asset kind" }, { status: 400 });
      }
      const form = await request.formData();
      const files = form.getAll("files").filter((value): value is File => value instanceof File);
      const relativePaths = form.getAll("relativePaths").filter((value): value is string => typeof value === "string");
      if (files.length === 0) return Response.json({ error: "No files supplied" }, { status: 400 });
      const base = join(agentflowAssetsDir(root), workflowId, kind === "image" ? "images" : "resources");
      await mkdir(base, { recursive: true });
      if (kind === "image") {
        const images: Array<{ path: string; label: string; mimeType?: string }> = [];
        for (const file of files) {
          if (!file.type.startsWith("image/")) return Response.json({ error: "Images only" }, { status: 400 });
          const extension = extname(file.name) || mimeExtension(file.type);
          const filename = `${uuidv7()}${extension}`;
          await writeFile(join(base, filename), new Uint8Array(await file.arrayBuffer()));
          images.push({
            path: `${SPECFLOW_AGENTFLOW_PATH}/assets/${workflowId}/images/${filename}`,
            label: basename(file.name) || filename,
            ...(file.type ? { mimeType: file.type } : {}),
          });
        }
        return Response.json({ paths: images.map((image) => image.path), images });
      }
      const importedPaths = new Set<string>();
      for (const [index, file] of files.entries()) {
        const safePath = safeAssetPath(relativePaths[index] ?? file.name);
        const output = join(base, safePath);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, new Uint8Array(await file.arrayBuffer()));
        importedPaths.add(directory
          ? `${SPECFLOW_AGENTFLOW_PATH}/assets/${workflowId}/resources/${safePath.split("/")[0]}/`
          : `${SPECFLOW_AGENTFLOW_PATH}/assets/${workflowId}/resources/${safePath}`);
      }
      return Response.json({ paths: [...importedPaths] });
    }

    // POST /api/canvases/:id/run
    const runMatch = pathname.match(/^\/api\/canvases\/([^/]+)\/run$/);
    if (runMatch && request.method === "POST") {
      const id = runMatch[1];
      let body: { initialInput?: string; variableValues?: Record<string, string> } = {};
      try { body = await request.json(); } catch { /* ok */ }
      return handleRun(id, body.initialInput ?? "", body.variableValues ?? {});
    }

    // GET /api/runs  (optional ?workflowId=)
    if (request.method === "GET" && pathname === "/api/runs") {
      const workflowId = url.searchParams.get("workflowId") ?? undefined;
      const runs = await listRuns(workflowId, root);
      return Response.json(runs);
    }

    // /api/runs/:id
    const runIdMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runIdMatch) {
      const id = runIdMatch[1];
      if (request.method === "GET") {
        try {
          const runRecord = await loadRun(id, root);
          return Response.json(runRecord);
        } catch {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (request.method === "DELETE") {
        let deleted: RunRecord | undefined;
        try {
          deleted = await loadRun(id, root);
        } catch {
          // Deleting an already absent run remains idempotent.
        }
        if (deleted?.resumedFromRunId) {
          try {
            const source = await loadRun(deleted.resumedFromRunId, root);
            if (source.resumedByRunId === deleted.id) {
              delete source.resumedByRunId;
              await saveRun(source, root);
            }
          } catch {
            // A missing source run does not prevent deletion.
          }
        }
        if (deleted?.resumedByRunId) {
          try {
            const continuation = await loadRun(deleted.resumedByRunId, root);
            if (continuation.resumedFromRunId === deleted.id) {
              delete continuation.resumedFromRunId;
              await saveRun(continuation, root);
            }
          } catch {
            // A missing continuation run does not prevent deletion.
          }
        }
        await deleteRun(id, root);
        await deleteRunLog(root, id);
        return Response.json({ ok: true });
      }
    }

    // POST /api/runs/:id/best-practice
    const runBestPracticeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/best-practice$/);
    if (runBestPracticeMatch && request.method === "POST") {
      const id = runBestPracticeMatch[1];
      let record: RunRecord;
      try {
        record = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if (record.status !== "success") {
        return Response.json({ error: "Only successful runs can be saved as best practice" }, { status: 409 });
      }
      if (!record.agentflowSnapshot || !record.canvasSnapshot) {
        return Response.json({ error: "Run snapshot is missing" }, { status: 409 });
      }
      if ((record.agentflowSnapshot.version ?? 1) !== 2) {
        return Response.json({ error: "Only v2 workflow snapshots can be saved as best practice" }, { status: 409 });
      }
      let body: { name?: string; shared?: boolean } = {};
      try { body = await request.json(); } catch { /* ok */ }
      const name = body.name?.trim() || `${record.agentflowSnapshot.name} best practice`;
      const existingIds = new Set((await listCanvases(root)).map((entry) => entry.id));
      let workflowId = keyFromLabel(name, "best-practice");
      try {
        assertSymbolKey(workflowId, "workflow key");
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
      if (existingIds.has(workflowId)) {
        const base = workflowId;
        let suffix = 2;
        while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
        workflowId = `${base}-${suffix}`;
      }
      try {
        assertServerRunnableAgentFlow(record.agentflowSnapshot, new Map((await bridge.listAgentServers(root)).map((entry) => [entry.id, entry])));
        const snapshot = combineAgentFlowAndLayout(record.agentflowSnapshot, record.canvasSnapshot);
        const { agentflow, layout } = splitCanvasDoc({ ...snapshot, id: workflowId, name });
        await saveAgentFlowAndLayout(workflowId, { ...agentflow, id: workflowId, name, version: 2 }, { ...layout, workflowId }, root, { local: body.shared !== true });
        return Response.json({
          ok: true,
          workflow: {
            id: workflowId,
            name,
            version: 2,
            local: body.shared !== true,
          },
        });
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
    }

    // PATCH /api/runs/:id/snapshot
    const runSnapshotMatch = pathname.match(/^\/api\/runs\/([^/]+)\/snapshot$/);
    if (runSnapshotMatch && request.method === "PATCH") {
      const id = runSnapshotMatch[1];
      let record: RunRecord;
      try {
        record = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if (record.status !== "paused" && record.status !== "interrupted") {
        return Response.json({ error: "Only paused or interrupted run snapshots can be edited" }, { status: 409 });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const parsed = parseRunSnapshotPatch(body);
      if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
      const missingRequiredNode = firstMissingCheckpointNode(record, parsed.agentflow);
      if (missingRequiredNode) {
        return Response.json({
          code: "SNAPSHOT_EDIT_REQUIRED_NODE_REMOVED",
          nodeId: missingRequiredNode,
          error: `Cannot remove checkpoint node "${missingRequiredNode}" from an active run snapshot`,
        }, { status: 409 });
      }
      const reachabilityEditError = validateSnapshotReachabilityPatch(record, parsed.agentflow);
      if (reachabilityEditError) {
        return Response.json(reachabilityEditError, { status: 409 });
      }
      try {
        assertServerRunnableAgentFlow(parsed.agentflow, new Map((await bridge.listAgentServers(root)).map((entry) => [entry.id, entry])));
        const prepared = prepareCanvasRun(parsed.agentflow, {
          initialInput: record.initialInput,
          variableValues: record.variableValues,
        });
        if (prepared.missingVariables.length > 0) {
          return Response.json({
            error: "Run snapshot is missing required variable values",
            missingVariables: prepared.missingVariables.map((variable) => variable.name),
          }, { status: 409 });
        }
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
      record.agentflowSnapshot = parsed.agentflow;
      record.canvasSnapshot = parsed.layout;
      record.snapshotRevision = (record.snapshotRevision ?? 0) + 1;
      record.snapshotEditedAt = new Date().toISOString();
      record.snapshotEditSummary = parsed.summary;
      await saveRun(record, root);
      const reachability = computeRunReachability(record);
      const snapshot = combineAgentFlowAndLayout(record.agentflowSnapshot, record.canvasSnapshot);
      return Response.json({
        ok: true,
        snapshotRevision: record.snapshotRevision,
        snapshot,
        reachability,
      });
    }

    // GET /api/runs/:id/reachability
    const runReachabilityMatch = pathname.match(/^\/api\/runs\/([^/]+)\/reachability$/);
    if (runReachabilityMatch && request.method === "GET") {
      try {
        const record = await loadRun(runReachabilityMatch[1], root);
        return Response.json(computeRunReachability(record));
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
    }

    // POST /api/runs/:id/pause
    const runPauseMatch = pathname.match(/^\/api\/runs\/([^/]+)\/pause$/);
    if (runPauseMatch && request.method === "POST") {
      const id = runPauseMatch[1];
      const controller = runControllers.get(id);
      if (!controller) {
        try {
          const runRecord = await loadRun(id, root);
          return Response.json({ error: `Run process is not active (status: ${runRecord.status})` }, { status: 409 });
        } catch {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
      }
      const runRecord = await loadRun(id, root).catch(() => undefined);
      if (!runRecord) return Response.json({ error: "Run not found" }, { status: 404 });
      if (runRecord.control?.intent) {
        if (runRecord.control.intent.kind === "pause_after_activation" || runRecord.control.intent.kind === "pause_at_safe_point") {
          return Response.json({ ok: true, status: runRecord.control.intent.kind === "pause_after_activation" ? "pause_after_requested" : "safe_point_pause_requested", controlIntent: runRecord.control.intent });
        }
        return Response.json({
          code: "RUN_CONTROL_ALREADY_PENDING",
          error: `Run control is already pending: ${runRecord.control.intent.kind}`,
          controlIntent: runRecord.control.intent,
        }, { status: 409 });
      }
      if (runRecord.status !== "running") {
        return Response.json({ ok: true, status: runRecord.status });
      }
      const active = bridge.runControls.getActiveActivation(id);
      const requestedAt = new Date().toISOString();
      let responseStatus: "pause_after_requested" | "safe_point_pause_requested" = "safe_point_pause_requested";
      let responseNode: { nodeId: string; nodeKind: "step" | "gate"; executionKey: string } | undefined;
      if (active && (active.nodeKind === "agent" || active.nodeKind === "gate")) {
        const nodeKind = active.nodeKind === "agent" ? "step" : "gate";
        const intent: RunControlIntent = {
          kind: "pause_after_activation",
          source: "player",
          nodeId: active.nodeId,
          executionKey: active.executionKey,
          requestedAt,
        };
        runRecord.control = { ...(runRecord.control ?? {}), intent, pauseRequested: true };
        bridge.runControls.requestPauseAfterActivation(id, active.executionKey);
        responseStatus = "pause_after_requested";
        responseNode = {
          nodeId: active.nodeId,
          nodeKind,
          executionKey: active.executionKey,
        };
      } else {
        const intent: RunControlIntent = {
          kind: "pause_at_safe_point",
          source: "player",
          requestedAt,
        };
        runRecord.control = { ...(runRecord.control ?? {}), intent, pauseRequested: true };
        bridge.runControls.requestPauseAtSafePoint(id);
      }
      await saveRun(runRecord, root);
      bridge.terminalEvents.append({
        runId: id,
        stream: "system",
        chunk: "Run pause requested.\n",
      });
      eventBus.emit(`${id}:run`, { runId: id, status: runRecord.status, workflowId: runRecord.workflowId, error: runRecord.errorMsg, control: runRecord.control });
      eventBus.emit(`${id}:term`, {
        chunk: "Run pause requested.\n",
        stream: "system",
      });
      return Response.json({ ok: true, status: responseStatus, ...(responseNode ?? {}), controlIntent: runRecord.control.intent });
    }

    // POST /api/runs/:id/interrupt
    const runInterruptMatch = pathname.match(/^\/api\/runs\/([^/]+)\/interrupt$/);
    if (runInterruptMatch && request.method === "POST") {
      const id = runInterruptMatch[1];
      if (!runControllers.has(id)) {
        return Response.json({ error: "Run process is not active" }, { status: 409 });
      }
      const runRecord = await loadRun(id, root).catch(() => undefined);
      if (!runRecord) return Response.json({ error: "Run not found" }, { status: 404 });
      if (runRecord.control?.intent) {
        if (runRecord.control.intent.kind === "interrupting") {
          return Response.json({ ok: true, status: "interrupting", controlIntent: runRecord.control.intent });
        }
        return Response.json({
          code: "RUN_CONTROL_ALREADY_PENDING",
          error: `Run control is already pending: ${runRecord.control.intent.kind}`,
          controlIntent: runRecord.control.intent,
        }, { status: 409 });
      }
      if (runRecord.status !== "running") {
        return Response.json({ error: `Only running runs can interrupt (status: ${runRecord.status})` }, { status: 409 });
      }
      const interrupted = bridge.runControls.interrupt(id);
      if (!interrupted.interrupted) {
        return Response.json({ error: "No active agent invocation to interrupt" }, { status: 409 });
      }
      const intent: RunControlIntent = {
        kind: "interrupting",
        source: "player",
        nodeId: interrupted.nodeId ?? "",
        agentInvocationId: interrupted.agentInvocationId ?? "",
        requestedAt: new Date().toISOString(),
      };
      runRecord.control = { ...(runRecord.control ?? {}), intent, interruptedNodeId: interrupted.nodeId };
      await saveRun(runRecord, root);
      bridge.interactions.cancelPendingForRun(id, "run interrupted");
      bridge.terminalEvents.append({
        runId: id,
        stream: "system",
        chunk: "Run interrupt requested.\n",
      });
      eventBus.emit(`${id}:term`, {
        chunk: "Run interrupt requested.\n",
        stream: "system",
      });
      eventBus.emit(`${id}:run`, { runId: id, status: runRecord.status, workflowId: runRecord.workflowId, error: runRecord.errorMsg, control: runRecord.control });
      return Response.json({ ok: true, status: "interrupting", ...interrupted, controlIntent: intent });
    }

    // POST /api/runs/:id/play
    const runPlayMatch = pathname.match(/^\/api\/runs\/([^/]+)\/play$/);
    if (runPlayMatch && request.method === "POST") {
      const id = runPlayMatch[1];
      let runRecord: RunRecord;
      try {
        runRecord = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if (runRecord.status !== "paused" && runRecord.status !== "interrupted") {
        if (runRecord.status === "running" && runRecord.control?.intent) {
          return Response.json({
            code: "RUN_NOT_SUSPENDED_YET",
            error: "Run is waiting for a pause or interrupt checkpoint before it can play.",
            controlIntent: runRecord.control.intent,
          }, { status: 409 });
        }
        return Response.json({ error: `Only paused or interrupted runs can play (status: ${runRecord.status})` }, { status: 409 });
      }
      if (runRecord.pausedNodeId && bridge.pauses.get(id, runRecord.pausedNodeId)) {
        try {
          bridge.pauses.continue(id, runRecord.pausedNodeId);
        } catch (error) {
          return Response.json({
            code: "PAUSED_NODE_NOT_READY",
            error: errorMessage(error),
          }, { status: 409 });
        }
      }
      const played = bridge.runControls.play(id);
      if (!played.played) {
        if (runControllers.has(id)) {
          return Response.json({ error: "Run is not waiting for play yet" }, { status: 409 });
        }
        const checkpoint = parseWorkflowExecutionCheckpoint(runRecord.checkpoint);
        if (!checkpoint) {
          return Response.json({ error: "Run checkpoint is missing; cannot play" }, { status: 409 });
        }
        return handleRun(
          runRecord.workflowId,
          runRecord.initialInput,
          runRecord.variableValues,
          { agentflow: runRecord.agentflowSnapshot, layout: runRecord.canvasSnapshot },
          undefined,
          { record: runRecord, checkpoint },
        );
      }
      return Response.json({ ok: true, status: "playing", previousStatus: played.kind });
    }

    // POST /api/runs/:id/stop (compat: /cancel)
    const runStopMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(?:stop|cancel)$/);
    if (runStopMatch && request.method === "POST") {
      const id = runStopMatch[1];
      const controller = runControllers.get(id);
      if (!controller) {
        try {
          const runRecord = await loadRun(id, root);
          if (runRecord.status === "running" || runRecord.status === "paused" || runRecord.status === "interrupted") {
            return Response.json({ error: "Run process is not active" }, { status: 409 });
          }
          return Response.json({ ok: true, status: runRecord.status });
        } catch {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
      }
      bridge.interactions.cancelPendingForRun(id, "run stopped");
      bridge.pauses.cancelForRun(id, "run stopped");
      bridge.terminalEvents.append({
        runId: id,
        stream: "system",
        chunk: "Run stop requested.\n",
      });
      controller.abort();
      bridge.runControls.clear(id);
      eventBus.emit(`${id}:term`, {
        chunk: "Run stop requested.\n",
        stream: "system",
      });
      return Response.json({ ok: true, status: "stopping" });
    }

    // GET /api/runs/:id/logs
    // No query → full array (back-compat). With ?timeline=compact → latest
    // ACP snapshot plus later raw timeline events. With ?tail=N or ?from=X&to=Y
    // → paginated `{ events, total, startIndex }` for lazy load.
    const runLogsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
    if (runLogsMatch && request.method === "GET") {
      const tailParam = url.searchParams.get("tail");
      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      if (tailParam || fromParam || toParam) {
        const tail = tailParam ? Number.parseInt(tailParam, 10) : undefined;
        const from = fromParam ? Number.parseInt(fromParam, 10) : undefined;
        const toSequence = toParam ? Number.parseInt(toParam, 10) : undefined;
        return Response.json(await listRunLogEventsRange(root, runLogsMatch[1], {
          ...(Number.isFinite(tail) ? { tail } : {}),
          ...(Number.isFinite(from) ? { from } : {}),
          ...(Number.isFinite(toSequence) ? { to: toSequence } : {}),
        }));
      }
      if (url.searchParams.get("timeline") === "compact") {
        return Response.json(await listRunTimelineRestoreEvents(root, runLogsMatch[1]));
      }
      return Response.json(await listRunLogEvents(root, runLogsMatch[1]));
    }

    // GET /api/runs/:id/paused-nodes
    const runPausesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/paused-nodes$/);
    if (runPausesMatch && request.method === "GET") {
      return Response.json(bridge.pauses.list(runPausesMatch[1]));
    }

    // POST /api/runs/:id/paused-nodes/:nodeId/prompt|continue
    const pausedActionMatch = pathname.match(/^\/api\/runs\/([^/]+)\/paused-nodes\/([^/]+)\/(prompt|continue)$/);
    if (pausedActionMatch && request.method === "POST") {
      const runId = decodeURIComponent(pausedActionMatch[1]);
      const nodeId = decodeURIComponent(pausedActionMatch[2]);
      let record: RunRecord;
      try {
        record = await loadRun(runId, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if ((record.status !== "running" && record.status !== "paused") || !bridge.pauses.get(runId, nodeId)) {
        return Response.json({ error: "Node is not currently authorized for paused interaction" }, { status: 409 });
      }
      try {
        if (pausedActionMatch[3] === "continue") {
          const paused = bridge.pauses.continue(runId, nodeId);
          const played = bridge.runControls.play(runId);
          return Response.json({ ok: true, paused, played });
        }
        const body = await request.json() as { prompt?: unknown };
        if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
          return Response.json({ error: "Prompt must not be empty" }, { status: 400 });
        }
        return Response.json(await bridge.pauses.sendPrompt(runId, nodeId, body.prompt, request.signal));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // GET /api/agent-sessions  (optional ?workflowId=&agentServerId=)
    if (request.method === "GET" && pathname === "/api/agent-sessions") {
      const workflowId = url.searchParams.get("workflowId") ?? undefined;
      const agentServerId = url.searchParams.get("agentServerId") ?? undefined;
      return Response.json(await listAgentSessions(root, { workflowId, agentServerId }));
    }

    // GET /api/agent-sessions/:id
    const agentSessionMatch = pathname.match(/^\/api\/agent-sessions\/([^/]+)$/);
    if (agentSessionMatch && request.method === "GET") {
      try {
        return Response.json(await loadAgentSession(root, agentSessionMatch[1]));
      } catch {
        return Response.json({ error: "Agent session not found" }, { status: 404 });
      }
    }

    // POST /api/agent-sessions/:id/restore
    const agentSessionRestoreMatch = pathname.match(/^\/api\/agent-sessions\/([^/]+)\/restore$/);
    if (agentSessionRestoreMatch && request.method === "POST") {
      let body: { mode?: AgentRestoreMode } = {};
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const mode = body.mode;
      if (mode !== "inspect" && mode !== "continue") {
        return Response.json({ error: "Invalid restore mode" }, { status: 400 });
      }
      return handleRestore(agentSessionRestoreMatch[1], mode);
    }

    // GET /api/agent-session-restores/:id/events
    const restoreEventsMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/events$/);
    if (restoreEventsMatch && request.method === "GET") {
      return restoreSseResponse(restoreEventsMatch[1]);
    }

    // POST /api/agent-session-restores/:id/cancel
    const restoreCancelMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/cancel$/);
    if (restoreCancelMatch && request.method === "POST") {
      const restoreId = restoreCancelMatch[1];
      const controller = restoreControllers.get(restoreId);
      if (!controller) {
        const active = activeConversations.get(restoreId);
        if (active) {
          activeConversations.delete(restoreId);
          await closeActiveConversation(active);
          return Response.json({ ok: true, status: "closed" });
        }
        const state = restoreStreams.get(restoreId);
        if (!state) return Response.json({ error: "Restore not found" }, { status: 404 });
        return Response.json({ ok: true, status: state.done ? "done" : "inactive" });
      }
      controller.abort();
      const active = activeConversations.get(restoreId);
      activeConversations.delete(restoreId);
      if (active) void closeActiveConversation(active, "Restore cancelled.");
      return Response.json({ ok: true, status: "cancelling" });
    }

    // POST /api/agent-session-restores/:id/prompt
    const restorePromptMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/prompt$/);
    if (restorePromptMatch && request.method === "POST") {
      const restoreId = restorePromptMatch[1];
      const active = activeConversations.get(restoreId);
      if (!active) return Response.json({ error: "Interactive restored session is not active" }, { status: 409 });
      if (active.promptPending) return Response.json({ error: "A prompt is already running" }, { status: 409 });
      let body: { prompt?: unknown; modeId?: unknown; configOptions?: unknown };
      try {
        body = await request.json() as { prompt?: unknown };
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
        return Response.json({ error: "Prompt must not be empty" }, { status: 400 });
      }
      const modeId = typeof body.modeId === "string" && body.modeId.trim() ? body.modeId.trim() : undefined;
      const configOptions = parseRestoreConfigOptions(body.configOptions);
      active.promptPending = true;
      const promptController = new AbortController();
      active.promptController = promptController;
      const abortPrompt = () => promptController.abort();
      request.signal.addEventListener("abort", abortPrompt, { once: true });
      try {
        const result = await active.conversation.prompt({
          prompt: body.prompt,
          ...(modeId ? { modeId } : {}),
          ...(configOptions && Object.keys(configOptions).length > 0 ? { configOptions } : {}),
        }, promptController.signal);
        await active.waitForLogWrites();
        return Response.json(result);
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      } finally {
        request.signal.removeEventListener("abort", abortPrompt);
        active.promptController = undefined;
        active.promptPending = false;
      }
    }

    // POST /api/agent-session-restores/:id/close
    const restoreCloseMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/close$/);
    if (restoreCloseMatch && request.method === "POST") {
      const active = activeConversations.get(restoreCloseMatch[1]);
      activeConversations.delete(restoreCloseMatch[1]);
      if (active) await closeActiveConversation(active);
      return Response.json({ ok: true });
    }

    // POST /api/runs/:id/interactions/:interactionId/respond
    const interactionRespondMatch = pathname.match(/^\/api\/runs\/([^/]+)\/interactions\/([^/]+)\/respond$/);
    if (interactionRespondMatch && request.method === "POST") {
      const runId = interactionRespondMatch[1];
      const interactionId = interactionRespondMatch[2];
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      try {
        const existing = bridge.interactions.get(interactionId);
        if (!existing) {
          return Response.json({ error: "Interaction not found" }, { status: 404 });
        }
        if (existing.runId !== runId) {
          return Response.json({ error: "Interaction belongs to another run" }, { status: 409 });
        }
        const interaction = bridge.interactions.resolve(interactionId, body);
        return Response.json({ ok: true, interaction });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes("Unknown interaction") ? 404 : 409;
        return Response.json({ error: message }, { status });
      }
    }

    // GET /api/runs/:id/resumable-session — find the agent session most appropriate for resuming
    const resumableMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resumable-session$/);
    if (resumableMatch && request.method === "GET") {
      const id = resumableMatch[1];
      try {
        const record = await loadRun(id, root);
        // Pre-fix runs that crashed mid-flight never persisted their invocations,
        // and invocations that reused an existing ACP session may have been
        // written without an acpSessionId. The session index (record.agentSessions)
        // may also be stale from an earlier partial repair. Rebuild from the log
        // and merge missing fields back into the record.
        const empty = !record.agentInvocations?.length;
        const needsEnrichment = !empty && record.agentInvocations.some((invocation) => !invocation.acpSessionId);
        const coveredInvocations = new Set(record.agentSessions?.flatMap((session) => session.invocationIds ?? []) ?? []);
        const sessionsOutOfSync = !empty && record.agentInvocations.some((invocation) => !coveredInvocations.has(invocation.id));
        if (empty || needsEnrichment) {
          const reconstructed = await reconstructInvocationsFromRunLog(root, record);
          if (reconstructed.length > 0) {
            if (empty) {
              record.agentInvocations = reconstructed;
            } else {
              const invocationById = new Map(record.agentInvocations.map((invocation) => [invocation.id, invocation]));
              for (const invocation of reconstructed) {
                const existing = invocationById.get(invocation.id);
                if (!existing) {
                  record.agentInvocations.push(invocation);
                  continue;
                }
                if (!existing.acpSessionId && invocation.acpSessionId) existing.acpSessionId = invocation.acpSessionId;
                if (!existing.parentSessionId && invocation.parentSessionId) existing.parentSessionId = invocation.parentSessionId;
                // Older invocation rows could be saved without agentServerId/agentId
                // (e.g. legacy code paths). buildAgentSessionsForRun silently drops
                // invocations missing those fields, so backfill from the log too.
                if (!existing.agentServerId && invocation.agentServerId) existing.agentServerId = invocation.agentServerId;
                if (!existing.agentId && invocation.agentId) existing.agentId = invocation.agentId;
                if (existing.status === "running" && (invocation.status === "done" || invocation.status === "failed")) {
                  existing.status = invocation.status;
                  if (!existing.completedAt && invocation.completedAt) existing.completedAt = invocation.completedAt;
                }
              }
            }
            await saveRun(record, root);
            await upsertAgentSessionsFromRun(record, root);
          }
        } else if (sessionsOutOfSync) {
          // Invocations are healthy but the session index is stale (e.g. from
          // a partial repair on a previous server version). Just re-derive.
          await upsertAgentSessionsFromRun(record, root);
        }
        const suggested = pickResumableInvocation(record);
        if (!suggested) {
          return Response.json({ error: "No resumable agent session found for this run" }, { status: 404 });
        }
        const sessions = await listAgentSessions(root, { workflowId: record.workflowId });
        const session = sessions.find((candidate) => candidate.invocationIds.includes(suggested.id));
        if (!session) {
          return Response.json({ error: "Agent session record is missing for the last incomplete step" }, { status: 404 });
        }
        const node = suggested.nodeId
          ? record.agentflowSnapshot.nodes.find((node) => node.id === suggested.nodeId)
          : undefined;
        const continuationPrompt = buildContinuationPrompt({
          nodeTitle: node && "title" in node ? node.title : suggested.nodeId,
          invocationStatus: suggested.status,
          runStatus: record.status,
          errorMsg: record.errorMsg,
          originalTask: bestEffortRenderedOriginalTask(record, suggested.nodeId),
        });
        return Response.json({
          agentSessionId: session.id,
          acpSessionId: session.acpSessionId,
          agentServerId: session.agentServerId,
          nodeId: suggested.nodeId,
          continuationPrompt,
          canLoad: session.acpSupportsLoadSession,
          canResume: session.acpSupportsResumeSession,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes("not found") ? 404 : 500;
        return Response.json({ error: message }, { status });
      }
    }

    // POST /api/runs/:id/continue (compat: /resume-workflow) — start a new run that picks up where
    // the source run left off: completed nodes get short-circuited with their
    // recorded outputs, interrupted nodes are re-invoked with a continuation
    // prompt against their existing ACP sessions.
    const resumeWorkflowMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(?:continue|resume-workflow)$/);
    if (resumeWorkflowMatch && request.method === "POST") {
      const id = resumeWorkflowMatch[1];
      let source: RunRecord;
      try {
        source = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if (source.status === "running" || source.status === "paused" || source.status === "interrupted") {
        return Response.json({ error: "Cannot continue a run that is still active" }, { status: 409 });
      }
      if (source.status !== "stopped" && source.status !== "error") {
        return Response.json({ error: "Only stopped or failed runs can be continued" }, { status: 409 });
      }
      if (source.resumedByRunId) {
        return Response.json({
          error: "This run has already been resumed",
          resumedByRunId: source.resumedByRunId,
        }, { status: 409 });
      }
      if (resumeRequests.has(source.id)) {
        return Response.json({ error: "A resume for this run is already being started" }, { status: 409 });
      }
      const layout = source.canvasSnapshot;
      const agentflow = source.agentflowSnapshot;
      if (!agentflow || !layout) {
        return Response.json({ error: "Run snapshot is missing; cannot resume" }, { status: 409 });
      }
      resumeRequests.add(source.id);
      try {
        const state = await buildResumeStateFromRun(root, source);
        return await handleRun(
          source.workflowId,
          source.initialInput,
          source.variableValues,
          { agentflow, layout },
          { state, source },
        );
      } finally {
        resumeRequests.delete(source.id);
      }
    }

    // POST /api/runs/:id/rerun — re-execute the snapshot of an existing run
    const rerunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/rerun$/);
    if (rerunMatch && request.method === "POST") {
      const id = rerunMatch[1];
      let prior;
      try {
        prior = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      let body: { initialInput?: string; variableValues?: Record<string, string> } = {};
      try { body = await request.json(); } catch { /* ok */ }
      // Fall back to the prior run's values when not overridden.
      return handleRun(
        prior.workflowId,
        body.initialInput ?? prior.initialInput,
        body.variableValues ?? prior.variableValues,
        {
          agentflow: prior.agentflowSnapshot,
          layout: prior.canvasSnapshot,
        },
      );
    }

    // GET /api/runs/:id/events  (SSE)
    const eventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (eventsMatch && request.method === "GET") {
      const replay = url.searchParams.get("replay") !== "false";
      return sseResponse(eventsMatch[1], { replay });
    }

    return null; // not handled
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTerminalRunRecordStatus(status: string): boolean {
  return status === "success" || status === "error" || status === "stopped" || status === "cancelled";
}

function parseRunSnapshotPatch(body: unknown):
  | { agentflow: AgentFlowDoc; layout: CanvasLayoutDoc; summary?: string }
  | { error: string } {
  if (!body || typeof body !== "object") return { error: "Request body must be an object" };
  const raw = body as Record<string, unknown>;
  const summary = typeof raw.summary === "string"
    ? raw.summary
    : typeof raw.snapshotEditSummary === "string"
      ? raw.snapshotEditSummary
      : undefined;
  if (raw.snapshot && typeof raw.snapshot === "object") {
    const snapshot = raw.snapshot as CanvasDoc;
    if (typeof snapshot.id !== "string" || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || !Array.isArray(snapshot.sessions)) {
      return { error: "snapshot must be a complete canvas document" };
    }
    const { agentflow, layout } = splitCanvasDoc(snapshot);
    return { agentflow, layout, summary };
  }
  const agentflow = raw.agentflowSnapshot;
  const layout = raw.canvasSnapshot;
  if (!agentflow || typeof agentflow !== "object" || !layout || typeof layout !== "object") {
    return { error: "Provide either snapshot or agentflowSnapshot + canvasSnapshot" };
  }
  const agentflowDoc = agentflow as AgentFlowDoc;
  const layoutDoc = layout as CanvasLayoutDoc;
  if (typeof agentflowDoc.id !== "string" || !Array.isArray(agentflowDoc.nodes) || !Array.isArray(agentflowDoc.edges) || !Array.isArray(agentflowDoc.sessions)) {
    return { error: "agentflowSnapshot is invalid" };
  }
  if (typeof layoutDoc.workflowId !== "string" || !Array.isArray(layoutDoc.nodes)) {
    return { error: "canvasSnapshot is invalid" };
  }
  return { agentflow: agentflowDoc, layout: layoutDoc, summary };
}

function firstMissingCheckpointNode(record: RunRecord, agentflow: AgentFlowDoc): string | undefined {
  const existingNodeIds = new Set(agentflow.nodes.map((node) => node.id));
  for (const nodeId of requiredCheckpointNodeIds(record.checkpoint)) {
    if (!existingNodeIds.has(nodeId)) return nodeId;
  }
  return undefined;
}

function validateSnapshotReachabilityPatch(record: RunRecord, nextAgentflow: AgentFlowDoc): Record<string, unknown> | undefined {
  const reachability = computeRunReachability(record);
  const editableClasses = new Set(["current", "future", "history_future"]);
  const currentNodes = new Map(record.agentflowSnapshot.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(nextAgentflow.nodes.map((node) => [node.id, node]));
  const currentNodeIds = new Set(currentNodes.keys());
  const nextNodeIds = new Set(nextNodes.keys());
  if (!sameStringSet(currentNodeIds, nextNodeIds)) {
    return {
      code: "SNAPSHOT_EDIT_TOPOLOGY_UNSUPPORTED",
      error: "Adding or deleting nodes in an active run snapshot is not supported.",
    };
  }
  for (const [nodeId, currentNode] of currentNodes.entries()) {
    const nextNode = nextNodes.get(nodeId);
    if (!nextNode || stableJson(currentNode) === stableJson(nextNode)) continue;
    const editClass = reachability.nodes[nodeId] ?? "inactive";
    if (!editableClasses.has(editClass)) {
      return {
        code: "SNAPSHOT_EDIT_UNREACHABLE_NODE",
        nodeId,
        editClass,
        error: `Node "${nodeId}" is ${editClass} and cannot be edited for this run.`,
      };
    }
  }

  const currentEdges = new Map(record.agentflowSnapshot.edges.map((edge) => [edge.id, edge]));
  const nextEdges = new Map(nextAgentflow.edges.map((edge) => [edge.id, edge]));
  if (!sameStringSet(new Set(currentEdges.keys()), new Set(nextEdges.keys()))) {
    return {
      code: "SNAPSHOT_EDIT_TOPOLOGY_UNSUPPORTED",
      error: "Adding or deleting edges in an active run snapshot is not supported.",
    };
  }
  for (const [edgeId, currentEdge] of currentEdges.entries()) {
    const nextEdge = nextEdges.get(edgeId);
    if (!nextEdge || stableJson(currentEdge) === stableJson(nextEdge)) continue;
    if (currentEdge.from !== nextEdge.from || currentEdge.to !== nextEdge.to) {
      return {
        code: "SNAPSHOT_EDIT_TOPOLOGY_UNSUPPORTED",
        edgeId,
        error: "Changing edge endpoints in an active run snapshot is not supported.",
      };
    }
    const fromClass = reachability.nodes[currentEdge.from] ?? "inactive";
    const toClass = reachability.nodes[currentEdge.to] ?? "inactive";
    if (!editableClasses.has(fromClass) && !editableClasses.has(toClass)) {
      return {
        code: "SNAPSHOT_EDIT_UNREACHABLE_EDGE",
        edgeId,
        error: `Edge "${edgeId}" is not on a reachable future path for this run.`,
      };
    }
  }

  const currentSessions = new Map(record.agentflowSnapshot.sessions.map((session) => [session.id, session]));
  for (const nextSession of nextAgentflow.sessions) {
    const currentSession = currentSessions.get(nextSession.id);
    if (!currentSession || stableJson(currentSession) === stableJson(nextSession)) continue;
    const referencedByEditableNode = record.agentflowSnapshot.nodes.some((node) => {
      if (node.kind !== "step" || node.sessionId !== nextSession.id) return false;
      return editableClasses.has(reachability.nodes[node.id] ?? "inactive");
    });
    if (!referencedByEditableNode) {
      return {
        code: "SNAPSHOT_EDIT_UNREACHABLE_SESSION",
        sessionId: nextSession.id,
        error: `Session "${nextSession.id}" is not referenced by an editable node in this run.`,
      };
    }
  }
  return undefined;
}

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortJsonValue);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sortJsonValue(entry)]));
}

function parseWorkflowExecutionCheckpoint(value: Record<string, unknown> | undefined): WorkflowExecutionCheckpoint | undefined {
  if (!value) return undefined;
  if (!Array.isArray(value.queue)
    || !value.pendingInputs
    || typeof value.pendingInputs !== "object"
    || !Array.isArray(value.completedNodeIds)
    || !Array.isArray(value.completedExecutionKeys)
    || !Array.isArray(value.skippedNodeIds)
    || !Array.isArray(value.inactiveEdgeIds)
    || !value.branchTraversals
    || typeof value.branchTraversals !== "object") {
    return undefined;
  }
  return value as unknown as WorkflowExecutionCheckpoint;
}

function requiredCheckpointNodeIds(checkpoint: Record<string, unknown> | undefined): string[] {
  if (!checkpoint) return [];
  const ids = new Set<string>();
  if (typeof checkpoint.activeNodeId === "string") ids.add(checkpoint.activeNodeId);
  if (typeof checkpoint.interruptedNodeId === "string") ids.add(checkpoint.interruptedNodeId);
  const suspension = checkpoint.suspension;
  if (suspension && typeof suspension === "object" && typeof (suspension as { nodeId?: unknown }).nodeId === "string") {
    ids.add((suspension as { nodeId: string }).nodeId);
  }
  const pendingCompletion = checkpoint.pendingCompletion;
  if (pendingCompletion && typeof pendingCompletion === "object" && typeof (pendingCompletion as { nodeId?: unknown }).nodeId === "string") {
    ids.add((pendingCompletion as { nodeId: string }).nodeId);
  }
  if (Array.isArray(checkpoint.queue)) {
    for (const entry of checkpoint.queue) {
      if (entry && typeof entry === "object" && typeof (entry as { nodeId?: unknown }).nodeId === "string") {
        ids.add((entry as { nodeId: string }).nodeId);
      }
    }
  }
  return [...ids];
}

function buildAflowMigrationTask(input: {
  root: string;
  workflowId: string;
  serverUrl: string;
}): TerminalSessionTask {
  const directArgs = ["/specflow-migrate-v2", input.workflowId, "--server", input.serverUrl];
  const env = { AFLOW_SPECFLOW_URL: input.serverUrl };
  const configuredCommand = process.env["AFLOW_COMMAND"]?.trim();
  if (configuredCommand) {
    return {
      command: configuredCommand,
      args: directArgs,
      cwd: input.root,
      env,
      label: `Aflow migrate ${input.workflowId}`,
    };
  }

  const serverSourceDir = dirname(fileURLToPath(import.meta.url));
  const devAflowEntry = join(serverSourceDir, "../../aflow/src/cli.ts");
  if (existsSync(devAflowEntry)) {
    return {
      command: "bun",
      args: [devAflowEntry, ...directArgs],
      cwd: input.root,
      env,
      label: `Aflow migrate ${input.workflowId}`,
    };
  }

  return {
    command: "aflow",
    args: directArgs,
    cwd: input.root,
    env,
    label: `Aflow migrate ${input.workflowId}`,
  };
}

function parseRestoreConfigOptions(value: unknown): Record<string, string | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parsed: Record<string, string | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" && typeof entry !== "boolean") continue;
    parsed[key] = entry;
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function safeAssetPath(name: string): string {
  const parts = name.replaceAll("\\", "/").split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.map((part) => part.replace(/[^A-Za-z0-9._-]/g, "_")).join("/") || `asset-${uuidv7()}`;
}

function mimeExtension(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".bin";
}
