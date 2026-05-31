import { DEV_UI_PORT } from "@specflow/shared";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface DevUiProxy {
  fetch(request: Request): Promise<Response>;
  stop(): void;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const uiRoot = resolve(currentDir, "../../ui");
const viteBin = resolve(repoRoot, "node_modules/vite/bin/vite.js");

export async function createDevUiProxy(): Promise<DevUiProxy> {
  let stderr = "";
  const port = await findAvailableDevUiPort(DEV_UI_PORT);
  const vite = spawn("bun", [
    viteBin,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
    "--logLevel",
    "error",
  ], {
    cwd: uiRoot,
    env: { ...process.env, SPECFLOW_DEV_UI_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  vite.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  vite.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderr = `${stderr}${text}`.slice(-4000);
    process.stderr.write(chunk);
  });

  try {
    await waitForDevUi(vite, () => stderr, port);
  } catch (error) {
    stopChild(vite);
    throw error;
  }

  return {
    fetch(request) {
      const sourceUrl = new URL(request.url);
      const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, `http://127.0.0.1:${port}`);

      return fetch(targetUrl, {
        body: request.body,
        headers: request.headers,
        method: request.method,
        redirect: "manual",
      });
    },
    stop() {
      stopChild(vite);
    },
  };
}

export async function findAvailableDevUiPort(preferredPort = DEV_UI_PORT): Promise<number> {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`Unable to find an available UI dev server port starting at ${preferredPort}.`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ host: "127.0.0.1", port });
  });
}

async function waitForDevUi(child: ChildProcess, getStderr: () => string, port: number) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      const details = getStderr().trim();
      throw new Error(details ? `UI dev server exited early:\n${details}` : "UI dev server exited early.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) {
        return;
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("Timed out waiting for the UI dev server.");
}

function stopChild(child: ChildProcess) {
  if (child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
    }
  }, 1000).unref?.();
}
