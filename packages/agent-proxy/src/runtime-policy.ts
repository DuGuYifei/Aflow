import { isAbsolute, resolve } from "node:path";
import type { AgentRestoreRequest, AgentRunRequest, ResolvedAgentServer } from "./types";
import { expandHome } from "./util";

export function withPolicyDirectories<T extends AgentRunRequest | AgentRestoreRequest>(
  resolved: ResolvedAgentServer,
  request: T,
): T {
  return {
    ...request,
    additionalDirectories: effectiveAdditionalDirectories(resolved, request),
  };
}

function effectiveAdditionalDirectories(
  resolved: ResolvedAgentServer,
  request: AgentRunRequest | AgentRestoreRequest,
): string[] | undefined {
  const configured = resolved.settings.additionalDirectories ?? [];
  const requested = request.additionalDirectories ?? [];
  const directories = [...configured, ...requested]
    .map((directory) => {
      const expanded = expandHome(directory);
      return isAbsolute(expanded) ? expanded : resolve(request.cwd, expanded);
    });
  return directories.length > 0 ? [...new Set(directories)] : undefined;
}
