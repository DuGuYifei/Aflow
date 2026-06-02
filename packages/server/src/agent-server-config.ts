import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentServerSettings } from "@specflow/bridge";
import { SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";

export interface AgentServerSharedConfig {
  agent_servers: Record<string, AgentServerSettings>;
}

export interface AgentServerLocalConfig {
  agent_servers: Record<string, AgentServerSettings>;
}

export function agentServersPath(root: string): string {
  return join(root, SPECFLOW_WORKSPACE_PATH, "agent-servers.json");
}

export function agentServersLocalPath(root: string): string {
  return join(root, SPECFLOW_WORKSPACE_PATH, "agent-servers.local.json");
}

export async function loadSharedAgentServerConfig(root: string): Promise<AgentServerSharedConfig> {
  return loadAgentServerConfig(agentServersPath(root));
}

export async function loadLocalAgentServerConfig(root: string): Promise<AgentServerLocalConfig> {
  return loadAgentServerConfig(agentServersLocalPath(root));
}

async function loadAgentServerConfig(path: string): Promise<AgentServerSharedConfig> {
  try {
    const rawValue = JSON.parse(await readFile(path, "utf8")) as Partial<AgentServerSharedConfig> & {
      agentServers?: Record<string, AgentServerSettings>;
    };
    return { agent_servers: rawValue.agent_servers ?? rawValue.agentServers ?? {} };
  } catch {
    return { agent_servers: {} };
  }
}

export async function upsertLocalAgentServer(
  root: string,
  id: string,
  settings: AgentServerSettings,
): Promise<AgentServerLocalConfig> {
  const config = await loadLocalAgentServerConfig(root);
  config.agent_servers[id] = settings;
  await saveLocalAgentServerConfig(root, config);
  return config;
}

export async function removeLocalAgentServer(root: string, id: string): Promise<AgentServerLocalConfig> {
  const config = await loadLocalAgentServerConfig(root);
  delete config.agent_servers[id];
  await saveLocalAgentServerConfig(root, config);
  return config;
}

async function saveLocalAgentServerConfig(root: string, config: AgentServerLocalConfig): Promise<void> {
  const path = agentServersLocalPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
