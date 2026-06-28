import { mkdir, readdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { NodeStatus } from "@specflow/shared";
import type { WorkflowRunStatus } from "@specflow/workflow";
import { appendRunLogEvent, listRunLogEvents } from "./run-log-store";
import type { AgentFlowDoc, CanvasDoc, CanvasLayoutDoc } from "./canvas-doc";
import { splitCanvasDoc } from "./canvas-store";
import type { AgentInvocation } from "@specflow/workflow";
import type { AgentSessionRecord } from "./agent-session-store";
import { runsDir } from "../workspace-paths";

export type RunState = "running" | "paused" | "interrupted" | "success" | "error" | "pending" | "cancelled";
export type RunRecordStatus = "pending" | "running" | "paused" | "interrupted" | "success" | "error" | "stopped";

export type RunControlIntent =
  | {
      kind: "pause_after_activation";
      source: "player";
      nodeId: string;
      executionKey: string;
      requestedAt: string;
    }
  | {
      kind: "pause_at_safe_point";
      source: "player";
      requestedAt: string;
    }
  | {
      kind: "interrupting";
      source: "player";
      nodeId: string;
      agentInvocationId: string;
      requestedAt: string;
    };

export interface RunControlState {
  intent?: RunControlIntent;
  pauseRequested?: boolean;
  interruptedNodeId?: string;
  reason?: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  label: string;
  ticket?: string;
  status: RunRecordStatus;
  activeNode?: string;
  pausedNodeId?: string;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  agent: string;
  errorMsg?: string;
  nodeStates: Record<string, RunState>;
  nodeOutputs: Record<string, string>;
  agentInvocations: AgentInvocation[];
  agentSessions: AgentSessionRecord[];
  agentflowSnapshot: AgentFlowDoc;
  canvasSnapshot: CanvasLayoutDoc;
  initialInput: string;
  variableValues: Record<string, string>;
  control?: RunControlState;
  checkpoint?: Record<string, unknown>;
  snapshotRevision?: number;
  snapshotEditedAt?: string;
  snapshotEditSummary?: string;
  /** Set when this run was created by resuming another run; identifies the source. */
  resumedFromRunId?: string;
  /** Set on a source run once a continuation run has been created from it. */
  resumedByRunId?: string;
}

function runPath(id: string, root: string) {
  return join(runsDir(root), `${id}.json`);
}

function runYamlPath(id: string, root: string) {
  return join(runsDir(root), `${id}.yaml`);
}

const saveRunQueues = new Map<string, Promise<void>>();

export async function listRuns(workflowId: string | undefined, root: string): Promise<RunRecord[]> {
  const byId = new Map<string, RunRecord>();
  let files: string[];
  try {
    files = await readdir(runsDir(root));
  } catch {
    return [];
  }
  const runFiles = files
    .filter((file) => file.endsWith(".json") || file.endsWith(".yaml"))
    .sort((a, b) => Number(a.endsWith(".yaml")) - Number(b.endsWith(".yaml")));
  for (const file of runFiles) {
    try {
      const rawValue = await readFile(join(runsDir(root), file), "utf8");
      const runRecord = parseRunRecord(rawValue, file);
      normalizeRunRecord(runRecord);
      if (!workflowId || runRecord.workflowId === workflowId) {
        byId.set(runRecord.id, runRecord);
      }
    } catch {
      // skip malformed
    }
  }
  const results = [...byId.values()];
  results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return results;
}

export async function loadRun(id: string, root: string): Promise<RunRecord> {
  let rawValue: string;
  let path = runPath(id, root);
  try {
    rawValue = await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    path = runYamlPath(id, root);
    rawValue = await readFile(path, "utf8");
  }
  const runRecord = parseRunRecord(rawValue, path);
  normalizeRunRecord(runRecord);
  return runRecord;
}

export async function saveRun(record: RunRecord, root: string): Promise<void> {
  const path = runPath(record.id, root);
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const previous = saveRunQueues.get(path) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomically(path, contents);
  });
  saveRunQueues.set(path, write);
  try {
    await write;
  } finally {
    if (saveRunQueues.get(path) === write) saveRunQueues.delete(path);
  }
}

async function writeFileAtomically(path: string, contents: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

/**
 * Mark any run records left in "running" state as stopped. Called on server
 * startup so a previous crash or kill -9 doesn't leave runs stuck pretending
 * to be live. The ACP session itself may still be recoverable via the agent
 * session restore flow.
 */
export async function reconcileInterruptedRuns(root: string, reason: string): Promise<string[]> {
  const runs = await listRuns(undefined, root);
  const interrupted: string[] = [];
  const completedAt = new Date().toISOString();
  for (const runRecord of runs) {
    let changed = false;
    const wasRunning = runRecord.status === "running";
    const unsupportedSuspended = (runRecord.status === "paused" || runRecord.status === "interrupted") && !runRecord.checkpoint;
    const effectiveCompletedAt = runRecord.completedAt ?? completedAt;
    if (wasRunning || unsupportedSuspended) {
      runRecord.status = "stopped";
      runRecord.errorMsg = reason;
      runRecord.completedAt = completedAt;
      runRecord.duration = formatDuration(runRecord.startedAt, completedAt);
      delete runRecord.control;
      changed = true;
    }
    for (const [nodeId, state] of Object.entries(runRecord.nodeStates)) {
      if (runRecord.status === "stopped" && (state === "running" || state === "paused" || state === "interrupted")) {
        runRecord.nodeStates[nodeId] = "cancelled";
        changed = true;
      } else if (runRecord.status === "error" && state === "running") {
        runRecord.nodeStates[nodeId] = "error";
        changed = true;
      }
    }
    for (const invocation of runRecord.agentInvocations) {
      if (invocation.status !== "running") continue;
      if (runRecord.status === "stopped") {
        invocation.status = "cancelled";
        invocation.error ??= runRecord.errorMsg ?? reason;
        invocation.completedAt ??= effectiveCompletedAt;
        changed = true;
      } else if (runRecord.status === "error") {
        invocation.status = "failed";
        invocation.error ??= runRecord.errorMsg;
        invocation.completedAt ??= effectiveCompletedAt;
        changed = true;
      }
    }
    await appendMissingTerminalLogEvents(runRecord, root, effectiveCompletedAt);
    if (changed) {
      await saveRun(runRecord, root);
      interrupted.push(runRecord.id);
    }
  }
  return interrupted;
}

async function appendMissingTerminalLogEvents(record: RunRecord, root: string, at: string): Promise<void> {
  if (record.status === "running") return;
  const events = await listRunLogEvents(root, record.id);
  const latestNodeStatus = new Map<string, string>();
  let latestRunStatus: string | undefined;
  for (const event of events) {
    if (event.type === "node_status") latestNodeStatus.set(event.nodeId, event.status);
    if (event.type === "run_status") latestRunStatus = event.status;
  }
  for (const [nodeId, state] of Object.entries(record.nodeStates)) {
    const status = nodeStatusFromRunState(state);
    if (!status || latestNodeStatus.get(nodeId) === status) continue;
    await appendRunLogEvent(root, {
      type: "node_status",
      runId: record.id,
      nodeId,
      status,
      at,
    });
  }
  const runStatus = workflowStatusFromRecordStatus(record.status);
  if (runStatus && latestRunStatus !== runStatus) {
    await appendRunLogEvent(root, {
      type: "run_status",
      runId: record.id,
      workflowId: record.workflowId,
      status: runStatus,
      error: record.errorMsg,
      at,
    });
  }
}

function nodeStatusFromRunState(state: RunState): NodeStatus | undefined {
  switch (state) {
    case "success": return "done";
    case "error": return "failed";
    case "cancelled": return "cancelled";
    case "interrupted": return "interrupted";
    case "paused": return "paused";
    case "running": return "running";
    default: return undefined;
  }
}

function workflowStatusFromRecordStatus(status: RunRecord["status"]): WorkflowRunStatus | undefined {
  switch (status) {
    case "success": return "done";
    case "error": return "failed";
    case "stopped": return "cancelled";
    case "paused": return "paused";
    case "interrupted": return "interrupted";
    default: return undefined;
  }
}

export async function deleteRun(id: string, root: string): Promise<void> {
  try {
    await unlink(runPath(id, root));
  } catch {
    // already gone — ok
  }
  try {
    await unlink(runYamlPath(id, root));
  } catch {
    // already gone — ok
  }
}

export function formatDuration(startedAt: string, completedAt: string): string {
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeRunRecord(runRecord: RunRecord): void {
  const legacy = runRecord as Omit<RunRecord, "status"> & { status?: RunRecordStatus | "cancelled" };
  if (legacy.status === "cancelled") {
    legacy.status = "stopped";
  }
  for (const [nodeId, state] of Object.entries(runRecord.nodeStates ?? {})) {
    if (state === "cancelled") continue;
    runRecord.nodeStates[nodeId] = state;
  }
  if (!runRecord.nodeOutputs) runRecord.nodeOutputs = {};
  if (!runRecord.agentInvocations) runRecord.agentInvocations = [];
  if (!runRecord.agentSessions) runRecord.agentSessions = [];
  if (!runRecord.initialInput) runRecord.initialInput = "";
  if (!runRecord.variableValues) runRecord.variableValues = {};

  const maybeLegacy = runRecord as RunRecord & {
    agentflowSnapshot?: AgentFlowDoc;
    canvasSnapshot?: CanvasLayoutDoc | CanvasDoc;
  };
  if (!maybeLegacy.agentflowSnapshot && maybeLegacy.canvasSnapshot && "id" in maybeLegacy.canvasSnapshot) {
    const legacySnapshot = maybeLegacy.canvasSnapshot as CanvasDoc;
    const { agentflow, layout } = splitCanvasDoc(legacySnapshot);
    maybeLegacy.agentflowSnapshot = agentflow;
    maybeLegacy.canvasSnapshot = layout;
  }
}

function parseRunRecord(rawValue: string, path: string): RunRecord {
  return path.endsWith(".json")
    ? JSON.parse(rawValue.replace(/\0+$/u, "")) as RunRecord
    : parse(rawValue) as RunRecord;
}
