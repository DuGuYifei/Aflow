import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { AgentProxySessionPool } from "./session-pool";

describe("AgentProxySessionPool", () => {
  it("reuses one ACP process/session for repeated workflow session invocations", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-pool-"));
    const specflowDir = join(cwd, ".specflow");
    const fakeAgentPath = fileURLToPath(new URL("./runtimes/acp/test-fixtures/fake-agent.ts", import.meta.url));
    await mkdir(specflowDir, { recursive: true });
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");
    await writeFile(join(specflowDir, "agent-servers.json"), JSON.stringify({
      agent_servers: {
        fake: {
          type: "custom",
          command: "bun",
          args: [fakeAgentPath],
          default_mode: "auto",
          default_model: "test-model",
          default_config_options: { reasoning: "high" },
        },
      },
    }), "utf8");

    const pool = new AgentProxySessionPool({ root: cwd });
    try {
      const first = await pool.run({
        agentServerId: "fake",
        cwd,
        workflowSessionId: "session-a",
        prompt: "first",
        onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      });
      const second = await pool.run({
        agentServerId: "fake",
        cwd,
        workflowSessionId: "session-a",
        prompt: "second",
        onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      });

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(first.sessionId).toBe(second.sessionId);
      expect(first.output).toContain("turn:1");
      expect(second.output).toContain("turn:2");
    } finally {
      await pool.closeAll();
    }
  });
});
