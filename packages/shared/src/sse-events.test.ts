import { describe, expect, test } from "bun:test";
import {
  RESTORE_SSE_EVENT_TYPES,
  RESTORE_SSE_EVENTS,
  RUN_SSE_EVENT_TYPES,
  RUN_SSE_EVENTS,
} from "./sse-events";

describe("SSE event constants", () => {
  test("lists every core run event type", () => {
    expect(RUN_SSE_EVENT_TYPES).toEqual([
      "hello",
      "node-status",
      "terminal",
      "session-update",
      "agent-prompt",
      "agent-lifecycle",
      "timeline",
      "run-status",
      "interaction-requested",
    ]);
    expect(RUN_SSE_EVENTS.interactionRequested).toBe("interaction-requested");
  });

  test("lists every restore event type", () => {
    expect(RESTORE_SSE_EVENT_TYPES).toEqual([
      "restore-status",
      "session-update",
      "terminal",
      "interaction-requested",
    ]);
    expect(RESTORE_SSE_EVENTS.restoreStatus).toBe("restore-status");
  });
});
