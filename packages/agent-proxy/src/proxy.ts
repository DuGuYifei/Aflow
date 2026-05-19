import { AgentServerStore } from "./store/agent-server-store";
import type { AgentRunRequest, AgentRunResult } from "./types";
import { runAcpAgent } from "./runtimes/acp/connection";
export { AgentProxySessionPool } from "./session-pool";

export type AgentCommandRequest = AgentRunRequest;
export type AgentCommandResult = AgentRunResult;
export type { AgentRunRequest, AgentRunResult };
export type {
  AgentPermissionRequest,
  AgentPermissionResult,
  AgentServerCommand,
  AgentServerConfigFile,
  AgentServerSettings,
  AgentSessionUpdateEvent,
  AgentTerminalEvent,
  AgentTerminalStream,
} from "./types";
export { AgentServerStore };

export async function runAgentCommand(request: AgentRunRequest): Promise<AgentRunResult> {
  const store = new AgentServerStore({ root: request.cwd });
  const resolved = await store.resolve(request.agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime is not implemented: ${request.agentServerId}`);
  }
  return runAcpAgent(resolved, request);
}
