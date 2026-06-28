import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";

describe("interaction API", () => {
  test("streams pending interactions and resolves them through the respond endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-interactions-"));
    const bridge = createSpecflowBridge();
    const handle = createApiHandler(bridge, root);

    const permission = bridge.interactions.requestPermission({
      runId: "run1",
      nodeRunId: "node-run-1",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      agentId: "agent-1",
      agentServerId: "codex-acp",
      specflowSessionId: "s1",
    }, {
      sessionId: "acp-session",
      toolCall: { toolCallId: "tool-1", title: "Edit file" },
      options: [{ optionId: "allow", name: "Allow" }],
      raw: {},
    });

    const eventResponse = await handle(new Request("http://specflow.test/api/runs/run1/events"));
    expect(eventResponse?.status).toBe(200);
    const eventText = await readUntil(eventResponse!, "interaction-requested");
    expect(eventText).toContain("interaction-requested");
    expect(eventText).toContain("Edit file");

    const interaction = bridge.interactions.list({ runId: "run1", status: "pending" })[0]!;
    const pending = await handle(new Request("http://specflow.test/api/runs/run1/interactions?status=pending"));
    expect(pending?.status).toBe(200);
    expect(await pending!.json()).toMatchObject([{ id: interaction.id, status: "pending" }]);

    const response = await handle(new Request(`http://specflow.test/api/runs/run1/interactions/${interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "selected", optionId: "allow" }),
    }));

    const responseBody = await response?.clone().json().catch(() => undefined);
    expect(response?.status, JSON.stringify(responseBody)).toBe(200);
    await expect(permission).resolves.toEqual({ outcome: "selected", optionId: "allow" });
  });
});

async function readUntil(response: Response, pattern: string): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let index = 0; index < 8 && !text.includes(pattern); index += 1) {
    const result = await reader.read();
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  await reader.cancel();
  return text;
}
