import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome } from "../util";

export const SPECFLOW_AGENT_CACHE_DIR_ENV = "SPECFLOW_AGENT_CACHE_DIR";

export interface ResolveAgentCacheDirOptions {
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveAgentCacheDir(options: ResolveAgentCacheDirOptions = {}): string {
  const home = options.homeDir ?? homedir();
  const configured = nonEmptyString(options.cacheDir)
    ?? nonEmptyString((options.env ?? process.env)[SPECFLOW_AGENT_CACHE_DIR_ENV]);
  if (configured) return expandHome(configured, home);
  return join(home, ".aflow", ".specflow", "cache", "agents");
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
