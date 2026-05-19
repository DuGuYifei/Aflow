import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TerminalOutputEvent } from "@specflow/workflow";
import type { NodeStatusEvent, RunInteraction, RunStatusEvent } from "@specflow/bridge";

export type RunLogEvent =
  | ({ type: "terminal" } & TerminalOutputEvent & { nodeId?: string })
  | ({ type: "node_status" } & NodeStatusEvent)
  | ({ type: "run_status" } & RunStatusEvent)
  | ({ type: "interaction" } & RunInteraction);

export function runLogsDir(root: string): string {
  return join(root, ".specflow", "run-logs");
}

export function runLogPath(root: string, runId: string): string {
  return join(runLogsDir(root), `${runId}.jsonl`);
}

export async function appendRunLogEvent(root: string, event: RunLogEvent): Promise<void> {
  const path = runLogPath(root, event.runId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event)}\n`, { flag: "a" });
}

export async function listRunLogEvents(root: string, runId: string): Promise<RunLogEvent[]> {
  let raw: string;
  try {
    raw = await readFile(runLogPath(root, runId), "utf8");
  } catch {
    return [];
  }
  const events: RunLogEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as RunLogEvent);
    } catch {
      // Skip malformed lines; the log is append-only and should remain readable.
    }
  }
  return events;
}

export async function deleteRunLog(root: string, runId: string): Promise<void> {
  await rm(runLogPath(root, runId), { force: true });
}
