import type { AgentServerEntry } from "@specflow/agent-proxy";
import type { CanvasDoc, CanvasNode } from "@specflow/server";
import type { AgentSessionRecord, RunLogEvent, RunRecordDetail } from "../server/specflow-client";

export interface NodeDisplayInfo {
  id: string;
  title: string;
  alias?: string;
  kind: CanvasNode["kind"];
  sessionId?: string;
  agentServerId?: string;
}

export interface ConversationSnippet {
  user: string;
  assistant: string;
}

export function buildNodeDisplayMap(canvas: CanvasDoc): Map<string, NodeDisplayInfo> {
  const agentServerBySession = new Map(canvas.sessions.map((session) => [session.id, session.agentServerId]));
  return new Map(canvas.nodes.map((node) => [
    node.id,
    {
      id: node.id,
      title: node.title?.trim() || node.id,
      alias: node.alias,
      kind: node.kind,
      sessionId: "sessionId" in node && node.sessionId ? node.sessionId : undefined,
      agentServerId: "sessionId" in node && node.sessionId ? agentServerBySession.get(node.sessionId) : undefined,
    },
  ]));
}

export function formatRunSummary(run: RunRecordDetail, nodes: Map<string, NodeDisplayInfo>): string {
  const lines = [
    `Run: ${run.id}`,
    `Workflow: ${run.workflowId}`,
    `Status: ${run.status}`,
  ];
  if (run.pausedNodeId) lines.push(`Paused node: ${formatNodeRef(run.pausedNodeId, nodes)}`);
  if (run.errorMsg) lines.push(`Error: ${run.errorMsg}`);

  const nodeStates = Object.entries(run.nodeStates ?? {});
  if (nodeStates.length > 0) {
    lines.push("Nodes:");
    for (const [nodeId, status] of nodeStates) {
      lines.push(`- ${formatNodeRef(nodeId, nodes)}: ${status}`);
    }
  }
  return lines.join("\n");
}

export function sessionsForRun(sessions: AgentSessionRecord[], runId: string): AgentSessionRecord[] {
  return sessions
    .filter((session) => session.latestRunId === runId || session.runIds.includes(runId))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function formatAgentSessionOption(
  session: AgentSessionRecord,
  nodes: Map<string, NodeDisplayInfo>,
  agentServers: AgentServerEntry[] = [],
): string {
  const latest = latestInvocation(session);
  const node = latest?.nodeId ? nodes.get(latest.nodeId) : undefined;
  const title = node?.title ?? latest?.nodeId ?? session.specflowSessionId ?? session.id;
  const agent = displayAgentServer(session.agentServerId, agentServers);
  const status = latest?.status ?? session.latestStatus;
  return `${title} · ${latest?.nodeId ?? "session"} · ${agent} · ${status}`;
}

export function formatAgentSessionList(
  sessions: AgentSessionRecord[],
  nodes: Map<string, NodeDisplayInfo>,
  agentServers: AgentServerEntry[] = [],
): string {
  if (sessions.length === 0) return "No resumable agent sessions were recorded for this run.";
  return [
    "Agent sessions:",
    ...sessions.map((session, index) => {
      const latest = latestInvocation(session);
      const node = latest?.nodeId ? nodes.get(latest.nodeId) : undefined;
      const capabilities = [
        session.acpSupportsLoadSession ? "load" : undefined,
        session.acpSupportsResumeSession ? "resume" : undefined,
      ].filter(Boolean).join("/");
      return [
        `${index + 1}. ${formatAgentSessionOption(session, nodes, agentServers)}`,
        `   session: ${session.id}`,
        `   node title: ${node?.title ?? "(unknown)"}`,
        `   specflow session: ${session.specflowSessionId ?? "(unknown)"}`,
        `   ACP session: ${session.acpSessionId}`,
        `   ACP restore: ${capabilities || "unavailable"}`,
      ].join("\n");
    }),
  ].join("\n");
}

export function extractRecentConversationSnippets(
  events: RunLogEvent[],
  session: AgentSessionRecord,
  limit = 2,
): ConversationSnippet[] {
  const invocationIds = new Set(session.invocationIds);
  const snippets: ConversationSnippet[] = [];
  let current: ConversationSnippet | undefined;

  for (const event of events) {
    if (!eventBelongsToSession(event, session, invocationIds)) continue;
    if (event.type === "agent_prompt" && typeof event.prompt === "string") {
      current = { user: event.prompt, assistant: "" };
      snippets.push(current);
      continue;
    }

    const text = agentMessageChunkText(event.update);
    if (!text) continue;
    if (!current) {
      current = { user: "(previous prompt unavailable)", assistant: "" };
      snippets.push(current);
    }
    current.assistant += text;
  }

  return snippets
    .filter((snippet) => snippet.user.trim() || snippet.assistant.trim())
    .slice(-limit);
}

export function latestInvocation(session: AgentSessionRecord) {
  return session.invocations.find((invocation) => invocation.invocationId === session.latestInvocationId)
    ?? session.invocations.at(-1);
}

export function formatNodeRef(nodeId: string, nodes: Map<string, NodeDisplayInfo>): string {
  const node = nodes.get(nodeId);
  if (!node) return nodeId;
  const alias = node.alias ? `${node.alias} ` : "";
  return `${alias}${node.title} (${node.id})`;
}

function eventBelongsToSession(
  event: RunLogEvent,
  session: AgentSessionRecord,
  invocationIds: Set<string>,
): boolean {
  if (event.agentInvocationId && invocationIds.has(event.agentInvocationId)) return true;
  if (event.sessionId && event.sessionId === session.acpSessionId) return true;
  if (event.specflowSessionId && event.specflowSessionId === session.specflowSessionId) return true;
  return false;
}

function agentMessageChunkText(update: unknown): string | undefined {
  if (!update || typeof update !== "object") return undefined;
  const value = update as {
    sessionUpdate?: unknown;
    content?: { type?: unknown; text?: unknown };
  };
  if (value.sessionUpdate !== "agent_message_chunk") return undefined;
  if (value.content?.type !== "text" || typeof value.content.text !== "string") return undefined;
  return value.content.text;
}

function displayAgentServer(agentServerId: string, agentServers: AgentServerEntry[]): string {
  const entry = agentServers.find((candidate) => candidate.id === agentServerId);
  if (!entry) return agentServerId;
  if (entry.settings.type === "registry") return `${agentServerId}/${entry.settings.registryId}`;
  return agentServerId;
}
