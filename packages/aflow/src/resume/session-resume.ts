import type { AgentServerEntry } from "@specflow/agent-proxy";
import { openAcpSessionView, type AflowCustomUi } from "../acp/acp-session-view";
import {
  buildNodeDisplayMap,
  extractRecentConversationSnippets,
  formatAgentSessionList,
  formatAgentSessionOption,
  latestInvocation,
  sessionsForRun,
  type NodeDisplayInfo,
} from "../acp/session-summary";
import { commandExists } from "../native/command-detection";
import { buildNativeResumeRecommendation, type NativeResumeRecommendation } from "../native/native-agent-adapters";
import { handoffToNativeTerminalFromTui } from "../native/terminal-handoff";
import type { AgentSessionRecord, RunLogEvent, RunRecordDetail, SpecflowClient } from "../server/specflow-client";

type NativeHandoffUi = Parameters<typeof handoffToNativeTerminalFromTui>[1];
export type ResumeUi = AflowCustomUi & NativeHandoffUi;

const MODE_ACP_RESUME = "ACP Resume";
const MODE_ACP_INSPECT = "ACP Inspect";
const MODE_NATIVE_HANDOFF = "Native CLI in Aflow terminal";
const MODE_SHOW_NATIVE_COMMAND = "Show native resume command";
const MODE_SKIP = "Skip";

export interface SessionResumeResult {
  text: string;
  sessions: AgentSessionRecord[];
  details?: Record<string, unknown>;
}

export async function offerRunSessionResume(input: {
  client: SpecflowClient;
  run: RunRecordDetail;
  nodeDisplay?: Map<string, NodeDisplayInfo>;
  hasUI: boolean;
  ui?: ResumeUi;
}): Promise<SessionResumeResult> {
  const nodeDisplay = input.nodeDisplay ?? await loadNodeDisplay(input.client, input.run.workflowId);
  const allSessions = await input.client.listAgentSessions({ workflowId: input.run.workflowId }).catch(() => []);
  const sessions = sessionsForRun(allSessions, input.run.id);
  const agentServers = await input.client.listAgentServers().catch(() => []);
  const listText = formatAgentSessionList(sessions, nodeDisplay, agentServers);
  const hint = resumeSessionCommandHint(input.run.id);

  if (sessions.length === 0) {
    return { text: listText, sessions };
  }

  if (!input.hasUI || !input.ui) {
    return { text: [listText, hint].join("\n\n"), sessions, details: { selected: false, hint } };
  }

  const sessionOptions = [
    MODE_SKIP,
    ...sessions.map((session) => `${formatAgentSessionOption(session, nodeDisplay, agentServers)} · ${session.id.slice(0, 8)}`),
  ];
  const selectedSessionLabel = await input.ui.select("Resume an agent session from this run", sessionOptions);
  if (!selectedSessionLabel || selectedSessionLabel === MODE_SKIP) {
    return { text: listText, sessions, details: { selected: false } };
  }

  const session = sessions[sessionOptions.indexOf(selectedSessionLabel) - 1];
  if (!session) {
    return { text: listText, sessions, details: { selected: false } };
  }

  const mode = await input.ui.select([
    "Open selected session",
    formatSelectedSession(session, nodeDisplay, agentServers),
  ].join("\n"), [MODE_ACP_RESUME, MODE_ACP_INSPECT, MODE_NATIVE_HANDOFF, MODE_SHOW_NATIVE_COMMAND, MODE_SKIP]);
  if (!mode || mode === MODE_SKIP) {
    return { text: listText, sessions, details: { selectedSessionId: session.id, selected: false } };
  }

  if (mode === MODE_SHOW_NATIVE_COMMAND) {
    const native = await showNativeResumeCommand(session, agentServers);
    input.ui.notify(native.notification ?? "Native command recommendation prepared.", native.ok ? "info" : "warning");
    return {
      text: [listText, native.text, hint].filter(Boolean).join("\n\n"),
      sessions,
      details: { selectedSessionId: session.id, mode, ...native.details },
    };
  }

  if (mode === MODE_NATIVE_HANDOFF) {
    const native = await openNativeResume(input.ui, session, agentServers);
    return {
      text: [listText, native.text, hint].filter(Boolean).join("\n\n"),
      sessions,
      details: { selectedSessionId: session.id, mode, ...native.details },
    };
  }

  const runLogs = normalizeRunLogs(await input.client.getRunLogs(input.run.id, { tail: 500 }).catch(() => []));
  const snippets = extractRecentConversationSnippets(runLogs, session, 2);
  const latest = latestInvocation(session);
  await openAcpSessionView({
    client: input.client,
    ui: input.ui,
    session,
    mode: mode === MODE_ACP_INSPECT ? "inspect" : "continue",
    node: latest?.nodeId ? nodeDisplay.get(latest.nodeId) : undefined,
    snippets,
  });

  return {
    text: [
      listText,
      `Opened ${mode} for ${formatSelectedSession(session, nodeDisplay, agentServers)}.`,
    ].join("\n\n"),
    sessions,
    details: { selectedSessionId: session.id, mode },
  };
}

export async function resumeAgentSessionForRun(input: {
  client: SpecflowClient;
  runId: string;
  hasUI: boolean;
  ui?: ResumeUi;
}): Promise<SessionResumeResult> {
  const run = await input.client.getRun(input.runId);
  return offerRunSessionResume({
    client: input.client,
    run,
    hasUI: input.hasUI,
    ui: input.ui,
  });
}

export function resumeSessionCommandHint(runId: string): string {
  return `Use /specflow-resume-session ${runId} in Aflow to choose ACP Resume, ACP Inspect, Native CLI in Aflow terminal, or Show native resume command.`;
}

export async function showNativeResumeCommand(
  session: AgentSessionRecord,
  agentServers: AgentServerEntry[],
): Promise<{ text: string; ok: boolean; notification?: string; details?: Record<string, unknown> }> {
  const recommendation = nativeRecommendationForSession(session, agentServers);
  if (!recommendation?.displayCommand) {
    return {
      text: formatNoNativeRecommendation(session, recommendation),
      ok: false,
      notification: `No verified native resume command for ${session.agentServerId}.`,
      details: {
        nativeStatus: recommendation?.status ?? "unknown",
        agentServerId: session.agentServerId,
        acpSessionId: session.acpSessionId,
      },
    };
  }

  const exists = await commandExists(recommendation.command);
  return {
    text: [
      `Recommended native command: ${recommendation.displayCommand}`,
      exists ? undefined : `Native CLI command not found on PATH: ${recommendation.command}`,
      recommendation.caveat ? `Caveat: ${recommendation.caveat}` : undefined,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    ok: exists,
    notification: exists ? "Native command recommendation prepared." : `Native CLI command not found: ${recommendation.command}`,
    details: {
      nativeStatus: recommendation.status,
      command: recommendation.command,
      args: recommendation.args,
      commandExists: exists,
      caveat: recommendation.caveat,
    },
  };
}

async function openNativeResume(
  ui: ResumeUi,
  session: AgentSessionRecord,
  agentServers: AgentServerEntry[],
): Promise<{ text: string; details?: Record<string, unknown> }> {
  const recommendation = nativeRecommendationForSession(session, agentServers);

  if (!recommendation?.displayCommand) {
    const text = formatNoNativeRecommendation(session, recommendation);
    ui.notify(`No verified native resume command for ${session.agentServerId}.`, "warning");
    return { text, details: { nativeStatus: recommendation?.status ?? "unknown" } };
  }

  if (!(await commandExists(recommendation.command))) {
    const text = `Native CLI command not found: ${recommendation.command}\nRecommended command: ${recommendation.displayCommand}`;
    ui.notify(`Native CLI command not found: ${recommendation.command}`, "warning");
    return {
      text,
      details: {
        nativeStatus: "command-not-found",
        command: recommendation.command,
        args: recommendation.args,
      },
    };
  }

  const exitCode = await handoffToNativeTerminalFromTui(recommendation, ui);
  return {
    text: `Native CLI exited with code ${exitCode}.\nCommand: ${recommendation.displayCommand}`,
    details: {
      nativeStatus: recommendation.status,
      command: recommendation.command,
      args: recommendation.args,
      exitCode,
    },
  };
}

function nativeRecommendationForSession(
  session: AgentSessionRecord,
  agentServers: AgentServerEntry[],
): NativeResumeRecommendation | undefined {
  const agentServer = agentServers.find((entry) => entry.id === session.agentServerId);
  return buildNativeResumeRecommendation({
    agentServer,
    agentServerId: session.agentServerId,
    acpSessionId: session.acpSessionId,
  });
}

function formatNoNativeRecommendation(
  session: AgentSessionRecord,
  recommendation: NativeResumeRecommendation | undefined,
): string {
  return [
    `No verified native resume command can be recommended for agent ${session.agentServerId}.`,
    recommendation?.caveat ? `Reason: ${recommendation.caveat}` : undefined,
    "Use ACP Resume/Inspect in Aflow, or run your own native command in another terminal with the recorded ids below.",
    `Aflow agent session: ${session.id}`,
    `ACP session: ${session.acpSessionId}`,
    `Latest run: ${session.latestRunId}`,
    session.specflowSessionId ? `Specflow session: ${session.specflowSessionId}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

async function loadNodeDisplay(client: SpecflowClient, workflowId: string): Promise<Map<string, NodeDisplayInfo>> {
  try {
    return buildNodeDisplayMap(await client.getCanvas(workflowId));
  } catch {
    return new Map();
  }
}

function formatSelectedSession(
  session: AgentSessionRecord,
  nodeDisplay: Map<string, NodeDisplayInfo>,
  agentServers: AgentServerEntry[],
): string {
  return `${formatAgentSessionOption(session, nodeDisplay, agentServers)} · ACP ${session.acpSessionId}`;
}

function normalizeRunLogs(result: RunLogEvent[] | { events: RunLogEvent[] }): RunLogEvent[] {
  return Array.isArray(result) ? result : result.events;
}
