import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { listSpecflowMcpToolNames, listSpecflowMcpTools } from "./server";

describe("Specflow MCP server", () => {
  test("exposes workflow, run, dynamic, paused-node, session, capability, and asset tools without auth terminal tools", () => {
    const names = new Set(listSpecflowMcpToolNames());

    for (const name of [
      "specflow_list_workflows",
      "specflow_read_workflow",
      "specflow_write_workflow",
      "specflow_fork_workflow_to_local",
      "specflow_import_assets",
      "specflow_validate_workflow",
      "specflow_prepare_run",
      "specflow_start_run",
      "specflow_get_run",
      "specflow_get_run_logs",
      "specflow_get_run_checkpoint",
      "specflow_run_to_next_checkpoint",
      "specflow_patch_run_graph",
      "specflow_pause_run",
      "specflow_play_run",
      "specflow_interrupt_run",
      "specflow_stop_run",
      "specflow_continue_workflow",
      "specflow_prompt_paused_node",
      "specflow_continue_paused_node",
      "specflow_list_pending_interactions",
      "specflow_respond_interaction",
      "specflow_rerun",
      "specflow_delete_run",
      "specflow_save_run_best_practice",
      "specflow_restore_agent_session",
      "specflow_prompt_restored_session",
      "specflow_get_native_resume_commands",
      "specflow_get_agent_session_native_resume_command",
      "specflow_list_agent_servers",
      "specflow_list_agent_registry",
      "specflow_install_registry_agent",
      "specflow_update_registry_agent",
      "specflow_remove_agent_server",
      "specflow_get_agent_capabilities",
      "specflow_refresh_agent_capabilities",
    ]) {
      expect(names.has(name), name).toBe(true);
    }

    for (const name of [
      "specflow_get_agent_auth",
      "specflow_start_agent_auth",
      "specflow_get_auth_terminal",
      "specflow_auth_terminal_input",
      "specflow_auth_terminal_resize",
      "specflow_auth_terminal_cancel",
      "specflow_auth_terminal_check",
      "specflow_save_agent_server",
    ]) {
      expect(names.has(name), name).toBe(false);
    }
  });

  test("documents rare asset import usage", () => {
    const assetTool = listSpecflowMcpTools().find((tool) => tool.name === "specflow_import_assets");

    expect(assetTool?.description).toContain("Rare");
    expect(assetTool?.description).toContain("durable/shareable");
    expect(assetTool?.description).toContain("relative paths");
  });

  test("documents native resume and explicit registry agent install/update usage", () => {
    const tools = listSpecflowMcpTools();
    const nativeTool = tools.find((tool) => tool.name === "specflow_get_native_resume_commands");
    expect(nativeTool?.description).toContain("verified");
    expect(nativeTool?.description).toContain("do not invent");

    const installTool = tools.find((tool) => tool.name === "specflow_install_registry_agent");
    expect(installTool?.description).toContain("registry/CDN");
    expect(installTool?.description).toContain("Specflow UI");

    const updateTool = tools.find((tool) => tool.name === "specflow_update_registry_agent");
    expect(updateTool?.description).toContain("registry-backed");
    expect(updateTool?.description).toContain("custom/headless");
  });

  test("speaks newline-delimited MCP stdio used by Codex", async () => {
    const child = spawn(process.execPath, [
      "--eval",
      'import { runSpecflowMcpServer } from "./packages/mcp/src/server.ts"; await runSpecflowMcpServer();',
    ], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const reader = new JsonLineReader(child);

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    })}\n`);

    const initialized = await reader.next();
    expect(initialized.id).toBe(1);
    expect(initialized.result.serverInfo.name).toBe("specflow");

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);

    const listed = await reader.next();
    expect(listed.id).toBe(2);
    expect(listed.result.tools.some((tool: { name?: string }) => tool.name === "specflow_list_workflows")).toBe(true);

    child.stdin.end();
    await reader.closed();
  });
});

class JsonLineReader {
  #buffer = "";
  #waiters: Array<(value: Record<string, any>) => void> = [];
  #closed: Promise<void>;

  constructor(child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => {
      this.#buffer += chunk.toString("utf8");
      this.#drain();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      throw new Error(`MCP stderr: ${chunk.toString("utf8")}`);
    });
    this.#closed = new Promise((resolve, reject) => {
      child.on("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`MCP exited with code=${code} signal=${signal}`));
      });
    });
  }

  next(): Promise<Record<string, any>> {
    const immediate = this.#readOne();
    if (immediate) return Promise.resolve(immediate);
    return withTimeout(new Promise((resolve) => this.#waiters.push(resolve)), 5_000) as Promise<Record<string, any>>;
  }

  closed(): Promise<void> {
    return withTimeout(this.#closed, 5_000);
  }

  #drain(): void {
    while (this.#waiters.length > 0) {
      const parsed = this.#readOne();
      if (!parsed) return;
      this.#waiters.shift()?.(parsed);
    }
  }

  #readOne(): Record<string, any> | undefined {
    const newline = this.#buffer.indexOf("\n");
    if (newline < 0) return undefined;
    const line = this.#buffer.slice(0, newline).trim();
    this.#buffer = this.#buffer.slice(newline + 1);
    if (!line) return this.#readOne();
    return JSON.parse(line);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
