import {
  AgentServerStore,
  ensureCacheDir,
  loadRegistryIndex,
  restoreAgentSession,
  type AgentRestoreRequest,
  type AgentRestoreResult,
  type AgentServerSettings,
  type RegistryIndex,
} from "@specflow/agent-proxy";
import { RunInteractionStore, TerminalEventStore, WorkflowExecutor } from "./execution";
import { createBridgeRuntime, type BridgeRuntime } from "./runtime";
import { SessionRegistry } from "./sessions";

export type {
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentServerSettings,
  RegistryAgent,
  RegistryIndex,
} from "@specflow/agent-proxy";

export interface SpecflowBridge {
  runtime: BridgeRuntime;
  sessions: SessionRegistry;
  terminalEvents: TerminalEventStore;
  interactions: RunInteractionStore;
  executor: WorkflowExecutor;
  restoreAgentSession(request: AgentRestoreRequest): Promise<AgentRestoreResult>;
  listAgentServers(root: string): Promise<Array<{ id: string; settings: AgentServerSettings }>>;
  listAgentRegistry(root: string): Promise<RegistryIndex>;
}

export function createSpecflowBridge(): SpecflowBridge {
  const terminalEvents = new TerminalEventStore();
  const interactions = new RunInteractionStore();
  const executor = new WorkflowExecutor({ terminalEvents, interactions });

  return {
    runtime: createBridgeRuntime(),
    sessions: new SessionRegistry(),
    terminalEvents,
    interactions,
    executor,
    restoreAgentSession,
    listAgentServers,
    listAgentRegistry,
  };
}

async function listAgentServers(root: string): Promise<Array<{ id: string; settings: AgentServerSettings }>> {
  return new AgentServerStore({ root }).listAgentServers();
}

async function listAgentRegistry(root: string): Promise<RegistryIndex> {
  const cacheDir = await ensureCacheDir(`${root}/.specflow/cache/agents`);
  return loadRegistryIndex(cacheDir);
}
