export type AcpTimelineSource = "agentflow" | "design";

export type AcpTimelineStatus = "running" | "success" | "failed" | "cancelled" | "partial";

export type AcpTimelineEvent =
  | AcpTimelineUserMessageEvent
  | AcpTimelineAssistantDeltaEvent
  | AcpTimelineToolEvent
  | AcpTimelineTerminalEvent
  | AcpTimelineLifecycleEvent
  | AcpTimelineErrorEvent
  | AcpTimelineSnapshotEvent;

export interface AcpTimelineBaseEvent {
  type: "acp_timeline";
  id: string;
  at: string;
  source: AcpTimelineSource;
  scopeId: string;
  turnId?: string;
  runId?: string;
  designSessionId?: string;
  sessionId?: string;
  specflowSessionId?: string;
  agentInvocationId?: string;
  agentServerId?: string;
  nodeId?: string;
  phase?: "memory" | "message" | string;
  localContext?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AcpTimelineUserMessageEvent extends AcpTimelineBaseEvent {
  kind: "user_message";
  text: string;
}

export interface AcpTimelineAssistantDeltaEvent extends AcpTimelineBaseEvent {
  kind: "assistant_delta";
  text: string;
  role?: "assistant" | "thought";
}

export interface AcpTimelineToolEvent extends AcpTimelineBaseEvent {
  kind: "tool_call" | "tool_call_update";
  toolCallId: string;
  title?: string;
  status?: string;
  toolKind?: string;
  content?: unknown;
  locations?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpTimelineTerminalEvent extends AcpTimelineBaseEvent {
  kind: "terminal";
  stream?: "stdout" | "stderr" | "system";
  text: string;
}

export interface AcpTimelineLifecycleEvent extends AcpTimelineBaseEvent {
  kind: "lifecycle";
  eventType: string;
  data?: unknown;
}

export interface AcpTimelineErrorEvent extends AcpTimelineBaseEvent {
  kind: "error";
  text: string;
  data?: unknown;
}

export interface AcpTimelineSnapshotEvent extends AcpTimelineBaseEvent {
  kind: "timeline_snapshot";
  status: AcpTimelineStatus;
  blocks: AcpTimelineBlock[];
  rawEventCount: number;
}

export type AcpTimelineBlock =
  | AcpTimelineMessageBlock
  | AcpTimelineToolBlock
  | AcpTimelineTerminalBlock
  | AcpTimelineLifecycleBlock
  | AcpTimelineErrorBlock;

export interface AcpTimelineBlockBase {
  id: string;
  at: string;
  source: AcpTimelineSource;
  scopeId: string;
  turnId?: string;
  runId?: string;
  designSessionId?: string;
  sessionId?: string;
  specflowSessionId?: string;
  agentInvocationId?: string;
  agentServerId?: string;
  nodeId?: string;
  phase?: "memory" | "message" | string;
  localContext?: boolean;
}

export interface AcpTimelineMessageBlock extends AcpTimelineBlockBase {
  kind: "message";
  role: "user" | "assistant" | "thought" | "system";
  text: string;
}

export interface AcpTimelineToolBlock extends AcpTimelineBlockBase {
  kind: "tool";
  toolCallId: string;
  title: string;
  status?: string;
  toolKind?: string;
  content?: unknown;
  locations?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpTimelineTerminalBlock extends AcpTimelineBlockBase {
  kind: "terminal";
  stream?: "stdout" | "stderr" | "system";
  text: string;
}

export interface AcpTimelineLifecycleBlock extends AcpTimelineBlockBase {
  kind: "lifecycle";
  eventType: string;
  data?: unknown;
}

export interface AcpTimelineErrorBlock extends AcpTimelineBlockBase {
  kind: "error";
  text: string;
  data?: unknown;
}

export function isAcpTimelineEvent(value: unknown): value is AcpTimelineEvent {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "acp_timeline");
}

export function reduceAcpTimelineEvents(events: readonly AcpTimelineEvent[]): AcpTimelineBlock[] {
  let blocks: AcpTimelineBlock[] = [];
  const toolIndexes = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "timeline_snapshot") {
      blocks = event.blocks.map(cloneBlock);
      toolIndexes.clear();
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (block?.kind === "tool") toolIndexes.set(block.toolCallId, index);
      }
      continue;
    }
    if (event.kind === "user_message") {
      appendMessageBlock(blocks, blockBase(event), "user", event.text);
      continue;
    }
    if (event.kind === "assistant_delta") {
      appendMessageBlock(blocks, blockBase(event), event.role === "thought" ? "thought" : "assistant", event.text);
      continue;
    }
    if (event.kind === "tool_call" || event.kind === "tool_call_update") {
      upsertToolBlock(blocks, toolIndexes, event);
      continue;
    }
    if (event.kind === "terminal") {
      appendTerminalBlock(blocks, event);
      continue;
    }
    if (event.kind === "lifecycle") {
      blocks.push({ ...blockBase(event), kind: "lifecycle", eventType: event.eventType, data: event.data });
      continue;
    }
    if (event.kind === "error") {
      blocks.push({ ...blockBase(event), kind: "error", text: event.text, data: event.data });
    }
  }
  return blocks;
}

export function compactAcpTimelineEventsForRestore(events: readonly AcpTimelineEvent[]): AcpTimelineEvent[] {
  const snapshotIndex = findLatestSnapshotIndex(events);
  return snapshotIndex >= 0 ? events.slice(snapshotIndex) : [...events];
}

function appendMessageBlock(
  blocks: AcpTimelineBlock[],
  base: AcpTimelineBlockBase,
  role: AcpTimelineMessageBlock["role"],
  text: string,
): void {
  const previous = blocks.at(-1);
  if (
    previous?.kind === "message"
    && previous.role === role
    && previous.turnId === base.turnId
    && previous.nodeId === base.nodeId
    && previous.agentInvocationId === base.agentInvocationId
    && previous.localContext === base.localContext
  ) {
    if (role === "user" && normalizeText(previous.text) === normalizeText(text)) return;
    previous.text += text;
    return;
  }
  blocks.push({ ...base, kind: "message", role, text });
}

function upsertToolBlock(
  blocks: AcpTimelineBlock[],
  toolIndexes: Map<string, number>,
  event: AcpTimelineToolEvent,
): void {
  const existingIndex = toolIndexes.get(event.toolCallId);
  if (typeof existingIndex === "number") {
    const existing = blocks[existingIndex];
    if (existing?.kind !== "tool") return;
    blocks[existingIndex] = {
      ...existing,
      title: event.title ?? existing.title,
      status: event.status ?? existing.status,
      toolKind: event.toolKind ?? existing.toolKind,
      content: event.content ?? existing.content,
      locations: event.locations ?? existing.locations,
      rawInput: event.rawInput ?? existing.rawInput,
      rawOutput: event.rawOutput ?? existing.rawOutput,
    };
    return;
  }
  const block: AcpTimelineToolBlock = {
    ...blockBase(event),
    kind: "tool",
    toolCallId: event.toolCallId,
    title: event.title ?? event.toolCallId,
    status: event.status,
    toolKind: event.toolKind,
    content: event.content,
    locations: event.locations,
    rawInput: event.rawInput,
    rawOutput: event.rawOutput,
  };
  toolIndexes.set(event.toolCallId, blocks.length);
  blocks.push(block);
}

function appendTerminalBlock(blocks: AcpTimelineBlock[], event: AcpTimelineTerminalEvent): void {
  const previous = blocks.at(-1);
  if (
    previous?.kind === "terminal"
    && previous.stream === event.stream
    && previous.turnId === event.turnId
    && previous.nodeId === event.nodeId
    && previous.agentInvocationId === event.agentInvocationId
    && previous.localContext === event.localContext
  ) {
    previous.text += event.text;
    return;
  }
  blocks.push({ ...blockBase(event), kind: "terminal", stream: event.stream, text: event.text });
}

function blockBase(event: AcpTimelineBaseEvent): AcpTimelineBlockBase {
  return {
    id: event.id,
    at: event.at,
    source: event.source,
    scopeId: event.scopeId,
    turnId: event.turnId,
    runId: event.runId,
    designSessionId: event.designSessionId,
    sessionId: event.sessionId,
    specflowSessionId: event.specflowSessionId,
    agentInvocationId: event.agentInvocationId,
    agentServerId: event.agentServerId,
    nodeId: event.nodeId,
    phase: event.phase,
    localContext: event.localContext,
  };
}

function cloneBlock(block: AcpTimelineBlock): AcpTimelineBlock {
  return { ...block };
}

function findLatestSnapshotIndex(events: readonly AcpTimelineEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.kind === "timeline_snapshot") return index;
  }
  return -1;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
