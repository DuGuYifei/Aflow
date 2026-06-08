import {
  appendAcpEventLogEntry,
  listAcpEventLogEntries,
} from "../acp-event-log-store";
import { designConversationsDir } from "../workspace-paths";
import { compactAcpTimelineEventsForRestore, isAcpTimelineEvent, type AcpTimelineEvent } from "@specflow/shared";
import { uuidv7 } from "@specflow/shared";

export async function appendDesignSessionLogEntry(
  root: string,
  sessionId: string,
  entry: AcpTimelineEvent,
): Promise<void> {
  await appendAcpEventLogEntry(designConversationsDir(root), sessionId, entry);
}

export async function listDesignSessionLogEntries(
  root: string,
  sessionId: string,
): Promise<AcpTimelineEvent[]> {
  const entries = await listAcpEventLogEntries<unknown>(designConversationsDir(root), sessionId);
  return compactAcpTimelineEventsForRestore(entries.flatMap((entry) => normalizeDesignLogEntry(entry, sessionId)));
}

function normalizeDesignLogEntry(entry: unknown, sessionId: string): AcpTimelineEvent[] {
  if (isAcpTimelineEvent(entry)) return [entry];
  if (!entry || typeof entry !== "object") return [];
  const value = entry as {
    id?: unknown;
    at?: unknown;
    kind?: unknown;
    phase?: unknown;
    text?: unknown;
    stream?: unknown;
    eventType?: unknown;
    data?: unknown;
  };
  const id = typeof value.id === "string" ? value.id : uuidv7();
  const at = typeof value.at === "string" ? value.at : new Date().toISOString();
  const phase = typeof value.phase === "string" ? value.phase : undefined;
  const base = {
    type: "acp_timeline" as const,
    id,
    at,
    source: "design" as const,
    scopeId: sessionId,
    designSessionId: sessionId,
    phase,
    localContext: phase === "memory",
  };
  if (value.kind === "user" && typeof value.text === "string") {
    return [{ ...base, kind: "user_message", text: value.text }];
  }
  if (value.kind === "assistant" && typeof value.text === "string") {
    return [{ ...base, kind: "assistant_delta", text: value.text }];
  }
  if (value.kind === "terminal" && typeof value.text === "string") {
    return [{
      ...base,
      kind: "terminal",
      text: value.text,
      stream: value.stream === "stdout" || value.stream === "stderr" || value.stream === "system" ? value.stream : undefined,
    }];
  }
  if (value.kind === "error" && typeof value.text === "string") {
    return [{ ...base, kind: "error", text: value.text, data: value.data }];
  }
  if (value.kind === "lifecycle") {
    return [{
      ...base,
      kind: "lifecycle",
      eventType: typeof value.eventType === "string" ? value.eventType : "lifecycle",
      data: value.data,
    }];
  }
  if (value.kind === "session-update") {
    return normalizeLegacySessionUpdate(base, value.data);
  }
  return [];
}

function normalizeLegacySessionUpdate(
  base: Omit<AcpTimelineEvent, "kind">,
  data: unknown,
): AcpTimelineEvent[] {
  const event = data && typeof data === "object" ? data as { sessionId?: unknown; update?: unknown } : {};
  const update = event.update && typeof event.update === "object" ? event.update as Record<string, unknown> : {};
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  const sessionId = typeof event.sessionId === "string" ? event.sessionId : undefined;
  const nextBase = { ...base, sessionId };
  if (kind === "agent_message_chunk") {
    const content = update.content && typeof update.content === "object" ? update.content as { type?: unknown; text?: unknown } : {};
    return typeof content.text === "string" ? [{ ...nextBase, kind: "assistant_delta", text: content.text }] : [];
  }
  if (kind === "user_message_chunk") {
    const content = update.content && typeof update.content === "object" ? update.content as { type?: unknown; text?: unknown } : {};
    return typeof content.text === "string" ? [{ ...nextBase, kind: "user_message", text: content.text }] : [];
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    if (!toolCallId) return [];
    return [{
      ...nextBase,
      kind,
      toolCallId,
      title: typeof update.title === "string" ? update.title : undefined,
      status: typeof update.status === "string" ? update.status : undefined,
      toolKind: typeof update.kind === "string" ? update.kind : undefined,
      content: update.content,
      locations: update.locations,
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
    }];
  }
  return [{
    ...nextBase,
    kind: "lifecycle",
    eventType: kind || "session_update",
    data,
  }];
}
