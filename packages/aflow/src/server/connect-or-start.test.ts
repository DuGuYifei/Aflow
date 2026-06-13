import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { connectOrStartSpecflowServer } from "./connect-or-start";

describe("connectOrStartSpecflowServer", () => {
  test("prepares the Specflow workspace when Aflow starts the server", async () => {
    const root = await mkdtemp(join(tmpdir(), "aflow-specflow-workspace-"));
    const connection = await connectOrStartSpecflowServer({
      cwd: root,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const health = await connection.client.health();

      expect(connection.started).toBe(true);
      expect(resolve(health.workspaceRoot ?? "")).toBe(resolve(root));
      expect(await pathExists(join(root, ".aflow/.specflow/agentflow/agentflows"))).toBe(true);
      expect(await pathExists(join(root, ".aflow/.specflow/agentflow/agentflows-local"))).toBe(true);
      expect(await pathExists(join(root, ".aflow/.specflow/agentflow/canvas"))).toBe(true);
      expect(await pathExists(join(root, ".aflow/.specflow/agentflow/runs"))).toBe(true);
      expect(await pathExists(join(root, ".aflow/.specflow/agentflow/run-logs"))).toBe(true);
      expect(await pathExists(join(root, ".aflow/.specflow/agentflow/agentflows-local/example-v2-review-loop.yaml"))).toBe(true);
    } finally {
      connection.server?.stop();
    }
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
