import type { AgentServerCommand, CustomAcpAgentServerSettings } from "../types";
import { expandHome, normalizeEnv } from "../util";

export function resolveCustomAcpCommand(settings: CustomAcpAgentServerSettings): AgentServerCommand {
  return {
    command: expandHome(settings.command),
    args: settings.args ?? [],
    env: normalizeEnv(settings.env),
  };
}
