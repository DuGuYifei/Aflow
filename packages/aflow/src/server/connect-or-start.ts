import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
    const health = await probeHealth(url);
    if (!health) throw new Error(`${url} is not a Specflow server.`);
    ensureSpecflowHealth(health, url);
    ensureWorkspaceMatch(health, options.cwd, url);
    await prepareSpecflowWorkspace(options.cwd, { createIfMissing: true });
    return { client, url, started: false, health };
  }

  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? SERVER_PORT;
  const defaultUrl = normalizeBaseUrl(`http://${host}:${port}/`);
  if (port > 0) {
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
  }

  const server = await startSpecflowServer({ cwd: options.cwd, host, port });
  const client = new SpecflowClient(server.url);
  const health = await probeHealth(server.url);
  if (health) ensureWorkspaceMatch(health, options.cwd, server.url);
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
    return await localJsonRequest<SpecflowHealth>(new URL("/api/health", url), 300);
  } catch {
    return undefined;
  }
}

function localJsonRequest<T>(url: URL, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolveRequest) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, (response) => {
      if ((response.statusCode ?? 500) >= 400) {
        response.resume();
        resolveRequest(undefined);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolveRequest(JSON.parse(body) as T);
        } catch {
          resolveRequest(undefined);
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolveRequest(undefined);
    });
    request.on("error", () => resolveRequest(undefined));
    request.end();
  });
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
