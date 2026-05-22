import { createSpecflowBridge, type AgentAuthenticationStatus, type AgentTerminalEvent } from "@specflow/bridge";

export async function ensureAgentServerInstalled(root: string, agentServerId: string): Promise<void> {
  await createSpecflowBridge().ensureAgentServerInstalled(root, agentServerId);
}

export async function inspectAgentServerAuthentication(
  root: string,
  agentServerId: string,
): Promise<AgentAuthenticationStatus> {
  return createSpecflowBridge().inspectAgentAuthentication(root, agentServerId);
}

export async function authenticateAgentServer(
  root: string,
  agentServerId: string,
  methodId: string,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): Promise<AgentAuthenticationStatus> {
  return createSpecflowBridge().authenticateAgentServer(root, agentServerId, methodId, onTerminalEvent);
}
