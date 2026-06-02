import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  agentServersPath,
  agentServersLocalPath,
  loadLocalAgentServerConfig,
  loadSharedAgentServerConfig,
  removeLocalAgentServer,
  upsertLocalAgentServer,
} from "./agent-server-config";
import { prepareSpecflowWorkspace } from "./workspace";

describe("agent server local config", () => {
  test("upserts and removes local agent server overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-servers-"));

    await upsertLocalAgentServer(root, "my-agent", {
      type: "custom",
      command: "node",
      args: ["agent.js", "--acp"],
      env: { TOKEN: "secret" },
    });

    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: {
        "my-agent": {
          type: "custom",
          command: "node",
          args: ["agent.js", "--acp"],
        },
      },
    });

    await removeLocalAgentServer(root, "my-agent");
    expect(await loadLocalAgentServerConfig(root)).toEqual({ agent_servers: {} });
  });

  test("normalizes camelCase agentServers from existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-servers-"));
    await mkdir(join(root, ".aflow/.specflow"), { recursive: true });
    await writeFile(agentServersLocalPath(root), JSON.stringify({
      agentServers: {
        codex: { type: "registry", registryId: "codex-acp" },
      },
    }), "utf8");

    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: { codex: { type: "registry", registryId: "codex-acp" } },
    });
  });

  test("loads shared agent server config from agent-servers.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-servers-"));
    await mkdir(join(root, ".aflow/.specflow"), { recursive: true });
    await writeFile(agentServersPath(root), JSON.stringify({
      agent_servers: {
        codex: { type: "registry", registryId: "codex-acp" },
      },
    }), "utf8");

    expect(await loadSharedAgentServerConfig(root)).toMatchObject({
      agent_servers: { codex: { type: "registry", registryId: "codex-acp" } },
    });
  });

  test("prewarms shared registry agent servers and warns about installedVersion", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-servers-"));
    await mkdir(join(root, ".aflow/.specflow"), { recursive: true });
    await writeFile(agentServersPath(root), JSON.stringify({
      agent_servers: {
        codex: { type: "registry", registryId: "codex-acp", installedVersion: "0.1.0" },
        custom: { type: "custom", command: "node", args: ["agent.js"] },
      },
    }), "utf8");
    await writeFile(agentServersLocalPath(root), JSON.stringify({
      agent_servers: {
        localOnly: { type: "registry", registryId: "local-acp" },
      },
    }), "utf8");

    const installed: string[] = [];
    const warnings: string[] = [];
    await prepareSpecflowWorkspace(root, {
      createIfMissing: true,
      prewarmAgentServers: true,
      ensureAgentServerInstalled: async (_root, id) => {
        installed.push(id);
      },
      warn: (message) => warnings.push(message),
    });

    expect(installed).toEqual(["codex"]);
    expect(warnings).toEqual([
      expect.stringContaining('agent-servers.json entry "codex" includes an installed version field'),
    ]);
  });
});
