import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { loadLocalAgentServerConfig } from "./agent-server-config";

describe("agent server API", () => {
  test("lists configured servers and writes local custom/registry overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-api-"));
    const handle = createApiHandler(createSpecflowBridge(), root);

    const initial = await handle(new Request("http://specflow.test/api/agent-servers"));
    expect(initial?.status).toBe(200);
    const initialBody = await initial!.json() as Array<{ id: string }>;
    expect(initialBody).toEqual([]);

    const putCustom = await handle(new Request("http://specflow.test/api/agent-servers/my-custom", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "custom",
        command: "node",
        args: ["agent.js", "--acp"],
        env: { A: "B", API_KEY: "secret" },
        additionalDirectories: ["../shared"],
        terminal: { enabled: false, auth: false },
      }),
    }));
    expect(putCustom?.status).toBe(200);
    const putCustomBody = await putCustom!.json() as Array<{ id: string; settings: { env?: Record<string, string> } }>;
    expect(putCustomBody.find((entry) => entry.id === "my-custom")?.settings.env).toEqual({
      A: "B",
      API_KEY: "[redacted]",
    });
    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: {
        "my-custom": {
          type: "custom",
          command: "node",
          args: ["agent.js", "--acp"],
          env: { API_KEY: "secret" },
          additionalDirectories: ["../shared"],
          terminal: { enabled: false, auth: false },
        },
      },
    });

    const preserveRedacted = await handle(new Request("http://specflow.test/api/agent-servers/my-custom", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "custom",
        command: "node",
        args: ["agent.js", "--acp"],
        env: { API_KEY: "[redacted]" },
      }),
    }));
    expect(preserveRedacted?.status).toBe(200);
    expect((await loadLocalAgentServerConfig(root)).agent_servers["my-custom"]?.env).toEqual({
      API_KEY: "secret",
    });

    const putRegistry = await handle(new Request("http://specflow.test/api/agent-servers/codex-acp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "registry",
        registryId: "codex-acp",
        defaultMode: "auto",
      }),
    }));
    expect(putRegistry?.status).toBe(200);
    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: {
        "codex-acp": {
          type: "registry",
          registryId: "codex-acp",
          defaultMode: "auto",
        },
      },
    });

    const del = await handle(new Request("http://specflow.test/api/agent-servers/my-custom", { method: "DELETE" }));
    expect(del?.status).toBe(200);
    expect((await loadLocalAgentServerConfig(root)).agent_servers["my-custom"]).toBeUndefined();
  });

  test("reports registry agent updates from installed version markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-api-"));
    const bridge = {
      ...createSpecflowBridge(),
      listAgentRegistry: async () => ({
        version: "1",
        agents: [{
          id: "codex-acp",
          name: "Codex",
          version: "2.0.0",
          distribution: { npx: { package: "codex-acp" } },
        }],
      }),
    };
    const handle = createApiHandler(bridge, root);

    const putOld = await handle(new Request("http://specflow.test/api/agent-servers/codex-acp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "registry",
        registryId: "codex-acp",
        installedVersion: "1.0.0",
      }),
    }));
    expect(putOld?.status).toBe(200);
    const oldBody = await putOld!.json() as Array<{ id: string; registry?: { updateAvailable: boolean; latestVersion?: string } }>;
    expect(oldBody.find((entry) => entry.id === "codex-acp")?.registry).toMatchObject({
      latestVersion: "2.0.0",
      updateAvailable: true,
    });

    const putLatest = await handle(new Request("http://specflow.test/api/agent-servers/codex-acp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "registry",
        registryId: "codex-acp",
        installedVersion: "2.0.0",
      }),
    }));
    expect(putLatest?.status).toBe(200);
    const latestBody = await putLatest!.json() as Array<{ id: string; registry?: { updateAvailable: boolean } }>;
    expect(latestBody.find((entry) => entry.id === "codex-acp")?.registry?.updateAvailable).toBe(false);
  });

  test("probes auth methods and stores env auth values locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-auth-api-"));
    const authStatus = {
      agentServerId: "fake",
      methods: [{
        type: "env_var" as const,
        id: "env",
        name: "Environment",
        vars: [{ name: "FAKE_API_KEY", secret: true, optional: false }],
        missingVars: [],
      }],
    };
    const bridge = {
      ...createSpecflowBridge(),
      inspectAgentAuthentication: async () => authStatus,
      authenticateAgentServer: async () => authStatus,
    };
    const handle = createApiHandler(bridge, root);

    await handle(new Request("http://specflow.test/api/agent-servers/fake", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "custom", command: "fake-acp" }),
    }));

    const inspected = await handle(new Request("http://specflow.test/api/agent-servers/fake/auth"));
    expect(await inspected!.json()).toEqual(authStatus);

    const authenticated = await handle(new Request("http://specflow.test/api/agent-servers/fake/auth/env", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ env: { FAKE_API_KEY: "secret" } }),
    }));
    expect(authenticated?.status).toBe(200);
    expect((await loadLocalAgentServerConfig(root)).agent_servers.fake?.env).toEqual({
      FAKE_API_KEY: "secret",
    });
  });
});
