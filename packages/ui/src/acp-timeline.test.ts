import { buildTimelineItems } from "./acp-timeline";
import type { TimelineEvent } from "./types";

declare function describe(name: string, callback: () => void): void;
declare function test(name: string, callback: () => void): void;
declare const expect: (value: unknown) => {
  toHaveLength(expected: number): void;
  toMatchObject(expected: unknown): void;
};

describe("ACP timeline parser", () => {
  test("deduplicates user prompt display messages from ACP user chunks", () => {
    const events: TimelineEvent[] = [{
      type: "display-message",
      role: "user",
      text: "Design a dashboard",
      agentInvocationId: "invocation-1",
    }, {
      type: "session-update",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Design a dashboard" } },
    }];

    const items = buildTimelineItems(events);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "message", role: "user", text: "Design a dashboard" });
  });

  test("combines assistant chunks and updates tool calls", () => {
    const events: TimelineEvent[] = [{
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } },
    }, {
      type: "session-update",
      update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Write file", status: "completed" },
    }];

    const items = buildTimelineItems(events);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "message", role: "agent", text: "Done" });
    expect(items[1]).toMatchObject({ kind: "tool", title: "Write file", status: "completed" });
  });

  test("deduplicates user chunks without invocation ids after a displayed user message", () => {
    const events: TimelineEvent[] = [{
      type: "display-message",
      role: "user",
      text: "Make it cleaner",
    }, {
      type: "session-update",
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Make it cleaner" } },
    }];

    const items = buildTimelineItems(events);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "message", role: "user", text: "Make it cleaner" });
  });
});
