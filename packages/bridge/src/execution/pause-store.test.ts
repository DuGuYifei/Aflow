import { describe, expect, test } from "bun:test";
import { RunPauseStore } from "./pause-store";

describe("RunPauseStore", () => {
  test("aborts an active paused prompt and clears prompt-pending state", async () => {
    const pauses = new RunPauseStore();
    let promptCalls = 0;
    const continuation = pauses.waitForContinuation({
      runId: "run-1",
      nodeId: "node-1",
      specflowSessionId: "session-1",
      agentServerId: "agent-1",
      pausedAt: new Date(0).toISOString(),
    }, (_prompt, signal) => {
      promptCalls += 1;
      if (promptCalls === 1) {
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("paused prompt aborted")), { once: true });
        });
      }
      return Promise.resolve("recovered");
    });

    const controller = new AbortController();
    const firstPrompt = pauses.sendPrompt("run-1", "node-1", "cancel me", controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(firstPrompt).rejects.toThrow("paused prompt aborted");
    await expect(pauses.sendPrompt("run-1", "node-1", "retry")).resolves.toEqual({ output: "recovered" });
    pauses.continue("run-1", "node-1");
    await expect(continuation).resolves.toBe("recovered");
  });
});
