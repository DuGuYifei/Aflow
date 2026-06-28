import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_HOST, SERVER_PORT, SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";
import { SpecflowClient, type SpecflowHealth } from "@specflow/client";

export interface WorkspaceServerConnection {
  client: SpecflowClient;
  url: string;
  cwd: string;
  started: boolean;
  health: SpecflowHealth;
}

export interface ConnectWorkspaceServerOptions {
  cwd?: string;
  serverUrl?: string;
  serveCommand?: string[];
  startupTimeoutMs?: number;
}

interface ServerRegistryRecord {
  workspaceRoot?: string;
  url?: string;
  pid?: number;
  serverId?: string;
  apiVersion?: number;
}

export async function connectWorkspaceServer(
  options: ConnectWorkspaceServerOptions = {},
): Promise<WorkspaceServerConnection> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const explicitUrl = options.serverUrl ?? process.env["SPECFLOW_SERVER_URL"];
  if (explicitUrl) {
    const health = await probeHealth(explicitUrl);
    if (!health) throw new Error(`${explicitUrl} is not a reachable Specflow server.`);
    ensureHealthMatches(health, cwd, explicitUrl);
    return { client: new SpecflowClient(explicitUrl), url: normalizeUrl(explicitUrl), cwd, started: false, health };
  }

  const existing = await findWorkspaceServer(cwd);
  if (existing) return { ...existing, cwd, started: false };

  await mkdir(dirname(serverRegistryPath(cwd)), { recursive: true });
  const command = options.serveCommand ?? defaultServeCommand();
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();

  const deadline = Date.now() + (options.startupTimeoutMs ?? 10_000);
  for (;;) {
    const started = await findWorkspaceServer(cwd);
    if (started) return { ...started, cwd, started: true };
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Specflow server from command: ${command.join(" ")}`);
    }
    await sleep(200);
  }
}

async function findWorkspaceServer(cwd: string): Promise<Omit<WorkspaceServerConnection, "cwd" | "started"> | undefined> {
  const registry = await readServerRegistry(cwd);
  const candidates = [
    ...(registry?.url ? [registry.url] : []),
    ...defaultPortCandidates(),
  ];
  const seen = new Set<string>();
  for (const url of candidates) {
    const normalized = normalizeUrl(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const health = await probeHealth(normalized);
    if (!health) continue;
    if (!healthMatches(health, cwd)) continue;
    return { client: new SpecflowClient(normalized), url: normalized, health };
  }
  return undefined;
}

async function readServerRegistry(cwd: string): Promise<ServerRegistryRecord | undefined> {
  try {
    const rawValue = await readFile(serverRegistryPath(cwd), "utf8");
    return JSON.parse(rawValue) as ServerRegistryRecord;
  } catch {
    return undefined;
  }
}

async function probeHealth(url: string): Promise<SpecflowHealth | undefined> {
  try {
    const response = await fetch(new URL("/api/health", normalizeUrl(url)), {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return undefined;
    const health = await response.json() as SpecflowHealth;
    return health.app === "Specflow" && health.ok ? health : undefined;
  } catch {
    return undefined;
  }
}

function ensureHealthMatches(health: SpecflowHealth, cwd: string, url: string): void {
  if (!healthMatches(health, cwd)) {
    throw new Error(`${url} belongs to a different workspace: ${health.workspaceRoot ?? "(unknown)"}`);
  }
}

function healthMatches(health: SpecflowHealth, cwd: string): boolean {
  if (!health.workspaceRoot) return true;
  return resolve(health.workspaceRoot) === resolve(cwd);
}

function serverRegistryPath(cwd: string): string {
  return join(cwd, SPECFLOW_WORKSPACE_PATH, "server.json");
}

function defaultPortCandidates(): string[] {
  const host = process.env["SPECFLOW_HOST"] ?? DEFAULT_HOST;
  const port = Number.parseInt(process.env["SPECFLOW_PORT"] ?? String(SERVER_PORT), 10);
  const start = Number.isFinite(port) ? port : SERVER_PORT;
  return Array.from({ length: 20 }, (_, index) => `http://${host}:${start + index}/`);
}

function defaultServeCommand(): string[] {
  const explicit = process.env["SPECFLOW_MCP_SERVE_COMMAND"];
  if (explicit?.trim()) return ["bash", "-lc", explicit];
  const argv1 = Bun.argv[1];
  if (argv1 && argv1.endsWith(".ts")) return [process.execPath, argv1, "serve"];
  if (argv1 && argv1 !== "mcp" && argv1 !== "serve" && argv1 !== "run" && argv1 !== "validate") {
    try {
      const url = pathToFileURL(argv1).toString();
      if (import.meta.url !== url) return [process.execPath, argv1, "serve"];
    } catch {
      // Fall through to compiled-binary mode.
    }
  }
  return [process.execPath, "serve"];
}

function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
