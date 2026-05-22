import { AgentServerStore } from "./store/agent-server-store";
import type {
  AgentAuthenticationStatus,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentRunRequest,
  AgentRunResult,
} from "./types";
import {
  authenticateAcpAgent,
  inspectAcpAgentAuthentication,
  restoreAcpAgentSession,
  runAcpAgent,
} from "./runtimes/acp/connection";
import { runHeadlessAgent } from "./runtimes/headless/command";
import { withPolicyDirectories } from "./runtime-policy";
export { AgentProxySessionPool } from "./session-pool";

export type AgentCommandRequest = AgentRunRequest;
export type AgentCommandResult = AgentRunResult;
export type { AgentRestoreRequest, AgentRestoreResult, AgentRunRequest, AgentRunResult };
export type {
  AgentPermissionRequest,
  AgentPermissionResult,
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentLifecycleEvent,
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
    return runHeadlessAgent(resolved, request);
  }
  return runAcpAgent(resolved, withPolicyDirectories(resolved, request));
}

export async function restoreAgentSession(request: AgentRestoreRequest): Promise<AgentRestoreResult> {
  const store = new AgentServerStore({ root: request.cwd });
  const resolved = await store.resolve(request.agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime is not implemented: ${request.agentServerId}`);
  }
  return restoreAcpAgentSession(resolved, withPolicyDirectories(resolved, request));
}

export async function inspectAgentAuthentication(
  root: string,
  agentServerId: string,
): Promise<AgentAuthenticationStatus> {
  const resolved = await new AgentServerStore({ root }).resolve(agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime does not advertise ACP authentication: ${agentServerId}`);
  }
  return inspectAcpAgentAuthentication(resolved, root);
}

export async function authenticateAgentServer(
  root: string,
  agentServerId: string,
  methodId: string,
): Promise<AgentAuthenticationStatus> {
  const resolved = await new AgentServerStore({ root }).resolve(agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime does not advertise ACP authentication: ${agentServerId}`);
  }
  return authenticateAcpAgent(resolved, root, methodId);
}
