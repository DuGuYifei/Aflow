import { join } from "node:path";
import type { AgentServerCommand, RegistryAcpAgentServerSettings } from "../types";
import {
  ensureCacheDir,
  loadRegistryIndex,
  packageTargetCommand,
  type RegistryAgent,
} from "./registry-client";
import { resolveBinaryTarget } from "./registry-download";
import { expandHome, normalizeEnv } from "../util";

export interface ResolvedRegistryAcpCommand {
  command: AgentServerCommand;
  registryId: string;
  version: string;
}

export async function resolveRegistryAcpCommand(input: {
  settings: RegistryAcpAgentServerSettings;
  cacheDir: string;
}): Promise<AgentServerCommand> {
  return (await resolveRegistryAcp(input)).command;
}

export async function resolveRegistryAcp(input: {
  settings: RegistryAcpAgentServerSettings;
  cacheDir: string;
}): Promise<ResolvedRegistryAcpCommand> {
  const cacheDir = await ensureCacheDir(input.cacheDir);
  const index = await loadRegistryIndex(cacheDir);
  const agent = index.agents.find((candidate) => candidate.id === input.settings.registryId);
  if (!agent) {
    throw new Error(`ACP registry agent not found: ${input.settings.registryId}`);
  }
  const command = await resolveRegistryDistribution(agent, cacheDir, normalizeEnv(input.settings.env));
  return {
    command: {
      ...command,
      cwd: input.settings.cwd ? expandHome(input.settings.cwd) : command.cwd,
    },
    registryId: agent.id,
    version: agent.version,
  };
}

async function resolveRegistryDistribution(
  agent: RegistryAgent,
  cacheDir: string,
  environment: Record<string, string>,
): Promise<AgentServerCommand> {
  const platform = platformKey();
  const binary = agent.distribution.binary?.[platform];
  if (binary) {
    return resolveBinaryTarget({
      cacheDir: join(cacheDir, "archives"),
      registryId: agent.id,
      version: agent.version,
      target: binary,
      extraEnv: environment,
    });
  }
  if (agent.distribution.npx) return packageTargetCommand("npx", agent.distribution.npx, environment);
  if (agent.distribution.uvx) return packageTargetCommand("uvx", agent.distribution.uvx, environment);
  throw new Error(`ACP registry agent has no supported distribution for ${platform}: ${agent.id}`);
}

function platformKey(): string {
  const platform = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : process.platform;
  const arch = process.arch === "x64"
    ? "x86_64"
    : process.arch === "arm64"
      ? "aarch64"
      : process.arch;
  return `${platform}-${arch}`;
}
