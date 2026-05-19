import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { loadLocalAgentServerConfig } from "./agent-server-config";

describe("agent server API", () => {
  test("lists built-ins and writes local custom/registry overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-api-"));
    const handle = createApiHandler(createSpecflowBridge(), root);

    const initial = await handle(new Request("http://specflow.test/api/agent-servers"));
    expect(initial?.status).toBe(200);
    const initialBody = await initial!.json() as Array<{ id: string }>;
    expect(initialBody.map((entry) => entry.id)).toContain("codex-acp");

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
});
