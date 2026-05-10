import { TerminalEventStore, WorkflowExecutor } from "./execution";
import { createBridgeRuntime, type BridgeRuntime } from "./runtime";
import { SessionRegistry } from "./sessions";

export interface SpecflowBridge {
  runtime: BridgeRuntime;
  sessions: SessionRegistry;
  terminalEvents: TerminalEventStore;
  executor: WorkflowExecutor;
}

export function createSpecflowBridge(): SpecflowBridge {
  const terminalEvents = new TerminalEventStore();
  const executor = new WorkflowExecutor({ terminalEvents });

  return {
    runtime: createBridgeRuntime(),
    sessions: new SessionRegistry(),
    terminalEvents,
    executor,
  };
}
