import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runAcpAgent } from "./connection";
import type { ResolvedAgentServer } from "../../types";

describe("runAcpAgent", () => {
  it("runs an ACP subprocess through the official SDK and services client requests", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-"));
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");
    const terminalEvents: string[] = [];
    const lifecycleEvents: string[] = [];

    const fakeAgentPath = fileURLToPath(new URL("./test-fixtures/fake-agent.ts", import.meta.url));
    const resolved: ResolvedAgentServer = {
      id: "fake-acp",
      source: "custom",
      settings: {
        type: "custom",
        command: "bun",
        args: [],
        defaultMode: "auto",
        defaultModel: "test-model",
        defaultConfigOptions: { reasoning: "high" },
      },
      command: {
        command: "bun",
        args: [fakeAgentPath],
      },
    };

    const result = await runAcpAgent(resolved, {
      agentServerId: "fake-acp",
      cwd,
      prompt: "hello",
      onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      onTerminalEvent: (event) => terminalEvents.push(`${event.stream}:${event.chunk}`),
      onLifecycleEvent: (event) => lifecycleEvents.push(event.type),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stopReason).toBe("end_turn");
    expect(result.output).toContain("prompt:hello");
    expect(result.output).toContain("file:file-content");
    expect(result.output).toContain("terminal:terminal-output");
    expect(result.output).toContain("permission:allow");
    expect(await readFile(join(cwd, "out.txt"), "utf8")).toBe("written-by-agent");
    expect(terminalEvents.some((event) => event.includes("[acp:stop] end_turn"))).toBe(true);
    expect(lifecycleEvents).toEqual([
      "process_started",
      "initialized",
      "session_created",
      "prompt_started",
      "prompt_stopped",
      "session_closed",
    ]);
  });
});
