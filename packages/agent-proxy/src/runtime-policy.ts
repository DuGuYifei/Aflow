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
  const all = [...configured, ...requested]
    .map((dir) => {
      const expanded = expandHome(dir);
      return isAbsolute(expanded) ? expanded : resolve(request.cwd, expanded);
    });
  return all.length > 0 ? [...new Set(all)] : undefined;
}
