import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { AgentSessionUpdateEvent, AgentTerminalEvent } from "../../types";

export function handleSessionUpdate(input: {
  params: SessionNotification;
  appendOutput: (text: string) => void;
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
  onSessionUpdate?: (event: AgentSessionUpdateEvent) => void;
}): void {
  const { sessionId, update } = input.params;
  input.onSessionUpdate?.({ sessionId, update });

  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") {
    const content = update.content;
    if (content?.type === "text" && typeof content.text === "string") {
      input.appendOutput(content.text);
      input.onTerminalEvent?.({ stream: "stdout", chunk: content.text });
    }
    return;
  }

  if (kind === "tool_call" || kind === "tool_call_update") {
    const title = String(update.title ?? update.toolCallId ?? "tool");
    const status = String(update.status ?? "updated");
    input.onTerminalEvent?.({ stream: "system", chunk: `[acp:${kind}] ${title} ${status}\n` });
    return;
  }

  if (kind) {
    input.onTerminalEvent?.({ stream: "system", chunk: `[acp:${kind}]\n` });
  }
}
