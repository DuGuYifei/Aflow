import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const appendQueues = new Map<string, Promise<void>>();

export function acpEventLogPath(dir: string, id: string): string {
  return join(dir, `${id}.jsonl`);
}

export async function appendAcpEventLogEntry<T>(
  dir: string,
  id: string,
  event: T,
): Promise<void> {
  const path = acpEventLogPath(dir, id);
  const previous = appendQueues.get(path) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(event)}\n`, { flag: "a" });
    });
  appendQueues.set(path, write);
  try {
    await write;
  } finally {
    if (appendQueues.get(path) === write) appendQueues.delete(path);
  }
}

export async function listAcpEventLogEntries<T>(
  dir: string,
  id: string,
): Promise<T[]> {
  let rawValue: string;
  try {
    rawValue = await readFile(acpEventLogPath(dir, id), "utf8");
  } catch {
    return [];
  }
  const events: T[] = [];
  for (const line of rawValue.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as T);
    } catch {
      // Keep append-only logs readable even if a single line is corrupt.
    }
  }
  return events;
}

export interface AcpEventLogPage<T> {
  events: T[];
  total: number;
  startIndex: number;
}

export async function listAcpEventLogEntriesRange<T>(
  dir: string,
  id: string,
  options: { from?: number; to?: number; tail?: number } = {},
): Promise<AcpEventLogPage<T>> {
  const events = await listAcpEventLogEntries<T>(dir, id);
  const total = events.length;
  if (typeof options.tail === "number" && options.tail > 0) {
    const startIndex = Math.max(0, total - options.tail);
    return { events: events.slice(startIndex), total, startIndex };
  }
  const from = Math.max(0, options.from ?? 0);
  const toSequence = Math.min(total, options.to ?? total);
  if (toSequence <= from) return { events: [], total, startIndex: from };
  return { events: events.slice(from, toSequence), total, startIndex: from };
}

export async function deleteAcpEventLog(dir: string, id: string): Promise<void> {
  await rm(acpEventLogPath(dir, id), { force: true });
}
