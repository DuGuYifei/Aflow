export const RUN_SSE_EVENTS = {
  hello: "hello",
  nodeStatus: "node-status",
  terminal: "terminal",
  sessionUpdate: "session-update",
  agentPrompt: "agent-prompt",
  agentLifecycle: "agent-lifecycle",
  timeline: "timeline",
  runStatus: "run-status",
  interactionRequested: "interaction-requested",
} as const;

export const RUN_SSE_EVENT_TYPES = [
  RUN_SSE_EVENTS.hello,
  RUN_SSE_EVENTS.nodeStatus,
  RUN_SSE_EVENTS.terminal,
  RUN_SSE_EVENTS.sessionUpdate,
  RUN_SSE_EVENTS.agentPrompt,
  RUN_SSE_EVENTS.agentLifecycle,
  RUN_SSE_EVENTS.timeline,
  RUN_SSE_EVENTS.runStatus,
  RUN_SSE_EVENTS.interactionRequested,
] as const;

export type RunSseEventType = typeof RUN_SSE_EVENT_TYPES[number];

export const RESTORE_SSE_EVENTS = {
  restoreStatus: "restore-status",
  sessionUpdate: "session-update",
  terminal: "terminal",
  interactionRequested: "interaction-requested",
} as const;

export const RESTORE_SSE_EVENT_TYPES = [
  RESTORE_SSE_EVENTS.restoreStatus,
  RESTORE_SSE_EVENTS.sessionUpdate,
  RESTORE_SSE_EVENTS.terminal,
  RESTORE_SSE_EVENTS.interactionRequested,
] as const;

export type RestoreSseEventType = typeof RESTORE_SSE_EVENT_TYPES[number];
