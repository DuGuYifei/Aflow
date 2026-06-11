import {
  isAcpTimelineEvent,
  reduceAcpTimelineEvents,
  type AcpTimelineBlock,
  type AcpTimelineEvent,
} from '@specflow/shared';
import type { LegacyTimelineEvent, TimelineEvent } from './types';

export type TimelineRole = 'agent' | 'user' | 'thought' | 'terminal' | 'system';

export type TimelineItem =
  | {
      kind: 'message';
      role: TimelineRole;
      text: string;
      nodeId?: string;
      agentInvocationId?: string;
      stream?: 'stdout' | 'stderr' | 'system';
      localContext?: boolean;
    }
  | {
      kind: 'tool';
      toolCallId: string;
      title: string;
      status?: string;
      toolKind?: string;
      content?: unknown;
      locations?: unknown;
      rawInput?: unknown;
      rawOutput?: unknown;
      nodeId?: string;
      agentInvocationId?: string;
    }
  | {
      kind: 'plan';
      entries: Array<{ content: string; status?: string }>;
      agentInvocationId?: string;
    }
  | {
      kind: 'gate';
      branchId: string;
      reason?: string;
      branches?: Array<{ branchId: string; label: string; traversalsUsed: number; maxTraversals: number; available: boolean }>;
      nodeId?: string;
    };

export function buildTimelineItems(events: TimelineEvent[]): TimelineItem[] {
  const gateItems = events.flatMap((event): TimelineItem[] =>
    !isAcpTimelineEvent(event) && event.type === 'gate-decision'
      ? [{
          kind: 'gate',
          branchId: event.branchId,
          reason: event.reason,
          branches: event.branches,
          nodeId: event.nodeId,
        }]
      : []);
  const timelineEvents = events.flatMap((event, index) => toAcpTimelineEvents(event, index));
  return [...blocksToItems(reduceAcpTimelineEvents(timelineEvents)), ...gateItems];
}

function blocksToItems(blocks: AcpTimelineBlock[]): TimelineItem[] {
  return blocks.map((block): TimelineItem => {
    if (block.kind === 'message') {
      return {
        kind: 'message',
        role: block.role === 'assistant' ? 'agent' : block.role,
        text: block.text,
        nodeId: block.nodeId,
        agentInvocationId: block.agentInvocationId,
        localContext: block.localContext,
      };
    }
    if (block.kind === 'tool') {
      return {
        kind: 'tool',
        toolCallId: block.toolCallId,
        title: block.title,
        status: block.status,
        toolKind: block.toolKind,
        content: block.content,
        locations: block.locations,
        rawInput: block.rawInput,
        rawOutput: block.rawOutput,
        nodeId: block.nodeId,
        agentInvocationId: block.agentInvocationId,
      };
    }
    if (block.kind === 'terminal') {
      return {
        kind: 'message',
        role: block.stream === 'system' ? 'system' : 'terminal',
        text: block.text,
        stream: block.stream,
        nodeId: block.nodeId,
        agentInvocationId: block.agentInvocationId,
        localContext: block.localContext,
      };
    }
    if (block.kind === 'error') {
      return {
        kind: 'message',
        role: 'system',
        text: block.text,
        nodeId: block.nodeId,
        agentInvocationId: block.agentInvocationId,
        localContext: block.localContext,
      };
    }
    return {
      kind: 'message',
      role: 'system',
      text: lifecycleText(block.eventType),
      nodeId: block.nodeId,
      agentInvocationId: block.agentInvocationId,
      localContext: block.localContext,
    };
  });
}

function toAcpTimelineEvents(event: TimelineEvent, index: number): AcpTimelineEvent[] {
  if (isAcpTimelineEvent(event)) return [event];
  if (event.type === 'gate-decision') return [];
  const base = legacyBase(event, index);
  if (event.type === 'display-message') {
    if (event.role === 'user') return [{ ...base, kind: 'user_message', text: event.text }];
    if (event.role === 'agent') return [{ ...base, kind: 'assistant_delta', text: event.text }];
    return [{ ...base, kind: 'terminal', stream: 'system', text: event.text }];
  }
  if (event.type === 'terminal') {
    return [{
      ...base,
      kind: 'terminal',
      stream: event.stream,
      text: event.chunk,
    }];
  }
  return sessionUpdateToAcpEvents(event, base);
}

function sessionUpdateToAcpEvents(
  event: Extract<LegacyTimelineEvent, { type: 'session-update' }>,
  base: AcpTimelineBaseForUi,
): AcpTimelineEvent[] {
  const update = record(event.update);
  const updateKind = typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : '';
  if (updateKind === 'agent_message_chunk' || updateKind === 'user_message_chunk' || updateKind === 'agent_thought_chunk') {
    const text = contentText(update?.content);
    if (updateKind === 'user_message_chunk') return [{ ...base, kind: 'user_message', text }];
    return [{
      ...base,
      kind: 'assistant_delta',
      text,
      role: updateKind === 'agent_thought_chunk' ? 'thought' : 'assistant',
    }];
  }
  if (updateKind === 'tool_call' || updateKind === 'tool_call_update') {
    const toolCallId = stringValue(update?.toolCallId) ?? `tool-${base.id}`;
    return [{
      ...base,
      kind: updateKind,
      toolCallId,
      title: stringValue(update?.title),
      status: stringValue(update?.status),
      toolKind: stringValue(update?.kind),
      content: update?.content,
      locations: update?.locations,
      rawInput: update?.rawInput,
      rawOutput: update?.rawOutput,
    }];
  }
  if (updateKind === 'plan') {
    const entries = Array.isArray(update?.entries)
      ? update.entries.map((entry) => {
          const item = record(entry);
          return {
            content: stringValue(item?.content) ?? stringValue(item?.description) ?? stringValue(item?.title) ?? 'Plan step',
            status: stringValue(item?.status),
          };
        })
      : [];
    return [{
      ...base,
      kind: 'lifecycle',
      eventType: 'plan',
      data: { entries },
    }];
  }
  if (updateKind) {
    return [{ ...base, kind: 'lifecycle', eventType: updateKind, data: event.update }];
  }
  return [];
}

type AcpTimelineBaseForUi = Omit<AcpTimelineEvent, 'kind'>;

function legacyBase(event: LegacyTimelineEvent, index: number): AcpTimelineBaseForUi {
  return {
    type: 'acp_timeline',
    id: `legacy-${index}`,
    at: new Date(0).toISOString(),
    source: 'agentflow',
    scopeId: 'legacy',
    turnId: 'agentInvocationId' in event ? event.agentInvocationId : undefined,
    nodeId: 'nodeId' in event ? event.nodeId : undefined,
    agentInvocationId: 'agentInvocationId' in event ? event.agentInvocationId : undefined,
    sessionId: event.type === 'session-update' ? event.sessionId : undefined,
    specflowSessionId: 'specflowSessionId' in event ? event.specflowSessionId : undefined,
    localContext: 'localContext' in event ? event.localContext : undefined,
  };
}

function lifecycleText(eventType: string): string {
  return `[acp:${eventType}]\n`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function contentText(content: unknown): string {
  const block = record(content);
  if (block?.type === 'text' && typeof block.text === 'string') return block.text;
  return block?.type ? `[${String(block.type)}]` : '';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
