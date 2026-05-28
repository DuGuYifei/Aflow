import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentAvailableCommand,
  AgentServerCapabilitiesCache,
  AgentServerConfigFile,
  AgentServerCommand,
  AgentServerEntry,
  AgentServerId,
  AgentServerSettings,
  ResolvedAgentServer,
} from "../types";
import { resolveCustomAcpCommand } from "../sources/custom-acp";
import { resolveRegistryAcpCommand } from "../sources/registry-acp";
import { applySupportedRegistryAgentDefaults } from "../supported-agents";
import { expandHome } from "../util";

export interface AgentServerStoreOptions {
  root: string;
  cacheDir?: string;
}

interface CapabilitiesCacheFile {
  capabilities?: Record<AgentServerId, AgentServerCapabilitiesCache>;
}

export class AgentServerStore {
  readonly #root: string;
  readonly #cacheDir: string;
  readonly #capabilitiesFile: string;
  #settings: Map<AgentServerId, AgentServerSettings> | undefined;
  #capabilities: Map<AgentServerId, AgentServerCapabilitiesCache> | undefined;

  constructor(options: AgentServerStoreOptions) {
    this.#root = options.root;
    this.#cacheDir = options.cacheDir ?? process.env.SPECFLOW_AGENT_CACHE_DIR ?? join(options.root, ".specflow", "cache", "agents");
    this.#capabilitiesFile = join(this.#cacheDir, "capabilities.json");
  }

  async listAgentServers(): Promise<AgentServerEntry[]> {
    await this.#load();
    await this.#loadCapabilities();
    return [...this.#settings!.entries()].map(([id, settings]) => {
      const entry: AgentServerEntry = { id, settings };
      const cached = this.#capabilities!.get(id);
      if (cached && capabilityCacheStillValid(cached, settings)) {
        entry.capabilities = cached;
      }
      return entry;
    });
  }

  async resolve(agentServerId: AgentServerId): Promise<ResolvedAgentServer> {
    await this.#load();
    const settings = this.#settings!.get(agentServerId);
    if (!settings) throw new Error(`Unknown agent server: ${agentServerId}`);
    const command = await resolveCommand(settings, this.#cacheDir);
    return { id: agentServerId, source: settings.type, settings, command };
  }

  /**
   * Look up cached capabilities for an agent server. Returns undefined when
   * either no probe has run yet, or the cached probe pre-dates the current
   * installedVersion. Stale entries are not auto-removed here — call
   * `clearCapabilities` if you want them gone from disk.
   */
  async getCapabilities(agentServerId: AgentServerId): Promise<AgentServerCapabilitiesCache | undefined> {
    await this.#load();
    await this.#loadCapabilities();
    const settings = this.#settings!.get(agentServerId);
    if (!settings) return undefined;
    const cached = this.#capabilities!.get(agentServerId);
    if (!cached) return undefined;
    if (!capabilityCacheStillValid(cached, settings)) return undefined;
    return cached;
  }

  /**
   * Persist a freshly probed capability snapshot. Overwrites any prior
   * entry for the same agent server. Auto-stamps installedVersion from
   * the resolved settings so invalidation works on the next read.
   */
  async setCapabilities(agentServerId: AgentServerId, snapshot: Omit<AgentServerCapabilitiesCache, "installedVersion" | "probedAt"> & {
    probedAt?: string;
  }): Promise<void> {
    await this.#load();
    await this.#loadCapabilities();
    const settings = this.#settings!.get(agentServerId);
    const installedVersion = installedVersionOf(settings);
    const entry: AgentServerCapabilitiesCache = {
      probedAt: snapshot.probedAt ?? new Date().toISOString(),
      installedVersion,
      agentCapabilities: snapshot.agentCapabilities,
      modes: snapshot.modes,
      configOptions: snapshot.configOptions,
      availableCommands: snapshot.availableCommands,
    };
    this.#capabilities!.set(agentServerId, entry);
    await this.#writeCapabilities();
  }

  async clearCapabilities(agentServerId: AgentServerId): Promise<void> {
    await this.#loadCapabilities();
    if (!this.#capabilities!.delete(agentServerId)) return;
    await this.#writeCapabilities();
  }

  async #load(): Promise<void> {
    if (this.#settings) return;
    const base = await readConfig(join(this.#root, ".specflow", "agent-servers.json"));
    const local = await readConfig(join(this.#root, ".specflow", "agent-servers.local.json"));
    this.#settings = new Map([
      ...Object.entries(base.agentServers ?? base.agent_servers ?? {}),
      ...Object.entries(local.agentServers ?? local.agent_servers ?? {}),
    ].map(([id, settings]) => [id, applySupportedRegistryAgentDefaults(settings)]));
  }

  async #loadCapabilities(): Promise<void> {
    if (this.#capabilities) return;
    this.#capabilities = new Map();
    try {
      const raw = await readFile(this.#capabilitiesFile, "utf8");
      const parsed = JSON.parse(raw) as CapabilitiesCacheFile;
      for (const [id, entry] of Object.entries(parsed.capabilities ?? {})) {
        if (!entry || typeof entry !== "object") continue;
        // Trust on-disk shape; this file is owned by the proxy and isn't user-edited.
        this.#capabilities.set(id, entry);
      }
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
  }

  async #writeCapabilities(): Promise<void> {
    const payload: CapabilitiesCacheFile = {
      capabilities: Object.fromEntries(this.#capabilities!.entries()),
    };
    await mkdir(dirname(this.#capabilitiesFile), { recursive: true });
    await writeFile(this.#capabilitiesFile, JSON.stringify(payload, null, 2));
  }
}

function capabilityCacheStillValid(
  cached: AgentServerCapabilitiesCache,
  settings: AgentServerSettings,
): boolean {
  const current = installedVersionOf(settings);
  // Both undefined (custom/headless agents that don't pin a version) →
  // treat as still valid; user must hit refresh after changing command/env.
  return cached.installedVersion === current;
}

function installedVersionOf(settings: AgentServerSettings | undefined): string | undefined {
  if (!settings) return undefined;
  if (settings.type === "registry") return settings.installedVersion;
  return undefined;
}

async function resolveCommand(settings: AgentServerSettings, cacheDir: string): Promise<AgentServerCommand> {
  if (settings.type === "custom") return resolveCustomAcpCommand(settings);
  if (settings.type === "registry") return resolveRegistryAcpCommand({ settings, cacheDir });
  return {
    command: expandHome(settings.command),
    args: settings.argsTemplate,
    env: settings.env,
  };
}

async function readConfig(path: string): Promise<AgentServerConfigFile> {
  try {
    return normalizeConfig(JSON.parse(await readFile(path, "utf8")) as AgentServerConfigFile);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw error;
  }
}

function normalizeConfig(config: AgentServerConfigFile): AgentServerConfigFile {
  const normalize = (settings: Record<string, AgentServerSettings> | undefined) => {
    if (!settings) return undefined;
    return Object.fromEntries(
      Object.entries(settings).map(([id, value]) => {
        if (value.type === "registry") {
          const raw = value as RegistryRawSettings;
          return [id, {
            ...value,
            registryId: raw.registryId ?? raw.registry_id ?? id,
            installedVersion: raw.installedVersion ?? raw.installed_version,
            defaultMode: raw.defaultMode ?? raw.default_mode,
            defaultModel: raw.defaultModel ?? raw.default_model,
            defaultConfigOptions: raw.defaultConfigOptions ?? raw.default_config_options,
            additionalDirectories: raw.additionalDirectories ?? raw.additional_directories,
            terminal: normalizeTerminalPolicy(raw.terminal),
            permissionPolicy: normalizePermissionPolicy(raw.permissionPolicy ?? raw.permission_policy),
          } satisfies AgentServerSettings];
        }
        if (value.type === "headless") {
          const raw = value as HeadlessRawSettings;
          return [id, {
            ...value,
            argsTemplate: raw.argsTemplate ?? raw.args_template ?? [],
            timeoutMs: raw.timeoutMs ?? raw.timeout_ms,
            defaultMode: raw.defaultMode ?? raw.default_mode,
            defaultModel: raw.defaultModel ?? raw.default_model,
            defaultConfigOptions: raw.defaultConfigOptions ?? raw.default_config_options,
            additionalDirectories: raw.additionalDirectories ?? raw.additional_directories,
            terminal: normalizeTerminalPolicy(raw.terminal),
            permissionPolicy: normalizePermissionPolicy(raw.permissionPolicy ?? raw.permission_policy),
          } satisfies AgentServerSettings];
        }
        const raw = value as AgentServerSettings & CommonRawSettings;
        return [id, {
          ...value,
          defaultMode: raw.defaultMode ?? raw.default_mode,
          defaultModel: raw.defaultModel ?? raw.default_model,
          defaultConfigOptions: raw.defaultConfigOptions ?? raw.default_config_options,
          additionalDirectories: raw.additionalDirectories ?? raw.additional_directories,
          terminal: normalizeTerminalPolicy(raw.terminal),
          permissionPolicy: normalizePermissionPolicy(raw.permissionPolicy ?? raw.permission_policy),
        } as AgentServerSettings];
      }),
    );
  };
  return {
    agentServers: normalize(config.agentServers ?? config.agent_servers),
  };
}

function normalizeTerminalPolicy(value: unknown): AgentServerSettings["terminal"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { enabled?: unknown; auth?: unknown };
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(typeof raw.auth === "boolean" ? { auth: raw.auth } : {}),
  };
}

function normalizePermissionPolicy(value: unknown): AgentServerSettings["permissionPolicy"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as {
    mode?: unknown;
    promptTimeoutMs?: unknown;
    prompt_timeout_ms?: unknown;
    onTimeout?: unknown;
    on_timeout?: unknown;
  };
  const mode = raw.mode === "auto_accept" || raw.mode === "auto_deny" || raw.mode === "prompt"
    ? raw.mode
    : "prompt";
  const timeoutRaw = typeof raw.promptTimeoutMs === "number" ? raw.promptTimeoutMs
    : typeof raw.prompt_timeout_ms === "number" ? raw.prompt_timeout_ms
    : undefined;
  const onTimeout = raw.onTimeout === "accept" || raw.onTimeout === "deny" ? raw.onTimeout
    : raw.on_timeout === "accept" || raw.on_timeout === "deny" ? raw.on_timeout
    : undefined;
  return {
    mode,
    ...(typeof timeoutRaw === "number" && timeoutRaw > 0 ? { promptTimeoutMs: timeoutRaw } : {}),
    ...(onTimeout ? { onTimeout } : {}),
  };
}

type CommonRawSettings = {
  default_mode?: string;
  default_model?: string;
  default_config_options?: Record<string, string | boolean>;
  additional_directories?: string[];
  permission_policy?: unknown;
  permissionPolicy?: unknown;
};

type RegistryRawSettings = Extract<AgentServerSettings, { type: "registry" }> & {
  registry_id?: string;
  installed_version?: string;
} & CommonRawSettings;

type HeadlessRawSettings = Extract<AgentServerSettings, { type: "headless" }> & {
  args_template?: string[];
  timeout_ms?: number;
} & CommonRawSettings;

// Re-export for backwards-compat in case downstream code referenced via deep import.
export type { AgentAvailableCommand, AgentServerCapabilitiesCache };
