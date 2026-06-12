import { resolve } from "node:path";
import { DEFAULT_HOST, SERVER_PORT } from "@specflow/shared";
import { prepareSpecflowWorkspace, startSpecflowServer, type RunningSpecflowServer } from "@specflow/server";
import { SpecflowClient, type SpecflowHealth } from "./specflow-client";

export interface ConnectSpecflowServerOptions {
  cwd: string;
  serverUrl?: string;
  host?: string;
  port?: number;
}

export interface SpecflowServerConnection {
  client: SpecflowClient;
  url: string;
  started: boolean;
  server?: RunningSpecflowServer;
  health?: SpecflowHealth;
}

export async function connectOrStartSpecflowServer(
  options: ConnectSpecflowServerOptions,
): Promise<SpecflowServerConnection> {
  const explicitUrl = options.serverUrl ?? process.env["AFLOW_SPECFLOW_URL"] ?? process.env["SPECFLOW_SERVER_URL"];
  if (explicitUrl) {
    const url = normalizeBaseUrl(explicitUrl);
    const client = new SpecflowClient(url);
    const health = await client.health();
    ensureSpecflowHealth(health, url);
    ensureWorkspaceMatch(health, options.cwd, url);
    await prepareSpecflowWorkspace(options.cwd, { createIfMissing: true });
    return { client, url, started: false, health };
  }

  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? SERVER_PORT;
  const defaultUrl = normalizeBaseUrl(`http://${host}:${port}/`);
  const existingHealth = await probeHealth(defaultUrl);
  if (existingHealth) {
    ensureSpecflowHealth(existingHealth, defaultUrl);
    if (workspaceMatches(existingHealth, options.cwd)) {
      await prepareSpecflowWorkspace(options.cwd, { createIfMissing: true });
      return {
        client: new SpecflowClient(defaultUrl),
        url: defaultUrl,
        started: false,
        health: existingHealth,
      };
    }
  }

  const server = await startSpecflowServer({ cwd: options.cwd, host, port });
  const client = new SpecflowClient(server.url);
  const health = await client.health().catch(() => undefined);
  return {
    client,
    url: server.url,
    started: true,
    server,
    health,
  };
}

async function probeHealth(url: string): Promise<SpecflowHealth | undefined> {
  try {
    const response = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(300) });
    if (!response.ok) return undefined;
    return response.json() as Promise<SpecflowHealth>;
  } catch {
    return undefined;
  }
}

function ensureSpecflowHealth(health: SpecflowHealth, url: string): void {
  if (!health.ok || health.app !== "Specflow") {
    throw new Error(`${url} is not a Specflow server.`);
  }
}

function ensureWorkspaceMatch(health: SpecflowHealth, cwd: string, url: string): void {
  if (!workspaceMatches(health, cwd)) {
    throw new Error(`${url} belongs to a different workspace: ${health.workspaceRoot}`);
  }
}

function workspaceMatches(health: SpecflowHealth, cwd: string): boolean {
  if (!health.workspaceRoot) return true;
  return resolve(health.workspaceRoot) === resolve(cwd);
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
