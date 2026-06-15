import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DesignRuntimeManager } from "./runtime-manager";

describe("design runtime manager", () => {
  test("starts React previews on an allocated port and records last runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-runtime-"));
    const projectRoot = join(root, ".aflow/.specflow/design/projects/react-runtime");
    await mkdir(join(projectRoot, ".aflow-design"), { recursive: true });
    await mkdir(join(projectRoot, "node_modules"), { recursive: true });
    await writeFile(join(projectRoot, "preview-server.ts"), [
      "const port = Number(Bun.argv[2]);",
      "Bun.serve({ hostname: \"127.0.0.1\", port, fetch() { return new Response(\"ok\"); } });",
      "await new Promise(() => {});",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(projectRoot, ".aflow-design/project.json"), JSON.stringify({
      kind: "react",
      devCommand: { command: "bun", args: ["preview-server.ts", "{port}"] },
      lastRuntime: { port: 6500 },
    }), "utf8");

    const manager = new DesignRuntimeManager(root);
    const state = await manager.start("react-runtime");

    expect(state.status).toBe("running");
    expect(state.port).toBeGreaterThanOrEqual(6200);
    expect(state.port).not.toBe(6500);
    expect(await localHttpText(state.url ?? "")).toBe("ok");
    const config = JSON.parse(await readFile(join(projectRoot, ".aflow-design/project.json"), "utf8")) as { lastRuntime?: { port?: number } };
    expect(config.lastRuntime?.port).toBe(state.port);

    const stopped = await manager.stop("react-runtime");
    expect(stopped.status).toBe("stopped");
  });
});

function localHttpText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(url), (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.end();
  });
}
