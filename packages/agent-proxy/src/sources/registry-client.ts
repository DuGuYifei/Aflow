import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentServerCommand } from "../types";
import { ensureParent } from "../util";

export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export interface RegistryIndex {
  version: string;
  agents: RegistryAgent[];
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description?: string;
  repository?: string;
  website?: string;
  icon?: string;
  distribution: RegistryDistribution;
}

export interface RegistryDistribution {
  binary?: Record<string, RegistryBinaryTarget>;
  npx?: RegistryPackageTarget;
  uvx?: RegistryPackageTarget;
}

export interface RegistryBinaryTarget {
  archive: string;
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
  sha256?: string;
}

export interface RegistryPackageTarget {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

export async function loadRegistryIndex(cacheDir: string): Promise<RegistryIndex> {
  const cachePath = join(cacheDir, "registry.json");
  try {
    const { parsed, text } = await fetchRegistryIndexText();
    await ensureParent(cachePath);
    await writeFile(cachePath, text, "utf8");
    return parsed;
  } catch (error) {
    const cached = await readCachedRegistry(cachePath);
    if (cached) return cached;
    throw error;
  }
}

export async function fetchRegistryIndex(): Promise<RegistryIndex> {
  return (await fetchRegistryIndexText()).parsed;
}

async function fetchRegistryIndexText(): Promise<{ parsed: RegistryIndex; text: string }> {
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const parsed = JSON.parse(text) as RegistryIndex;
  return { parsed, text };
}

async function readCachedRegistry(cachePath: string): Promise<RegistryIndex | undefined> {
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as RegistryIndex;
  } catch {
    return undefined;
  }
}

export async function ensureCacheDir(cacheDir: string): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

export function packageTargetCommand(
  runner: "npx" | "uvx",
  target: RegistryPackageTarget,
  extraEnv?: Record<string, string>,
): AgentServerCommand {
  return {
    command: commandForPackageRunner(runner),
    args: runner === "npx"
      ? ["--yes", target.package, ...(target.args ?? [])]
      : [target.package, ...(target.args ?? [])],
    env: { ...(target.env ?? {}), ...(extraEnv ?? {}) },
  };
}

function commandForPackageRunner(runner: "npx" | "uvx"): string {
  if (process.platform !== "win32") return runner;
  return runner === "npx" ? "npx.cmd" : "uvx.exe";
}
