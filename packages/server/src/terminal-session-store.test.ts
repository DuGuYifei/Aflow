import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { TerminalSessionStore, type TerminalSessionStreamEvent } from "./terminal-session-store";

describe("TerminalSessionStore", () => {
  test("streams PTY output and completes a successful command", async () => {
    const events: TerminalSessionStreamEvent[] = [];
    const store = new TerminalSessionStore();
    const sessionId = store.start({
      command: "bun",
      args: ["-e", "setTimeout(() => process.stdout.write('ready\\n'), 30); setTimeout(() => process.exit(0), 60);"],
      cwd: await mkdtemp(join(tmpdir(), "specflow-terminal-session-")),
      label: "Test terminal",
    });
    const unsubscribe = store.subscribe(sessionId, (event) => events.push(event));

    try {
      await waitFor(() => statusEvents(events).some((event) => event.status === "succeeded"));
    } finally {
      unsubscribe();
    }

    expect(outputText(events)).toContain("ready");
    expect(statusEvents(events).at(-1)).toMatchObject({
      status: "succeeded",
      exitCode: 0,
    });
  });

  test("writes browser input into the PTY", async () => {
    const events: TerminalSessionStreamEvent[] = [];
    const store = new TerminalSessionStore();
    const sessionId = store.start({
      command: "bun",
      args: [
        "-e",
        "process.stdin.setRawMode?.(true); process.stdin.on('data', (chunk) => { process.stdout.write('echo:' + chunk.toString()); process.exit(0); });",
      ],
      cwd: await mkdtemp(join(tmpdir(), "specflow-terminal-session-input-")),
      label: "Input terminal",
    });
    const unsubscribe = store.subscribe(sessionId, (event) => events.push(event));

    try {
      store.input(sessionId, "x");
      await waitFor(() => outputText(events).includes("echo:x"));
      await waitFor(() => statusEvents(events).some((event) => event.status === "succeeded"));
    } finally {
      unsubscribe();
      store.cancel(sessionId);
    }

    expect(outputText(events)).toContain("echo:x");
  });
});

function outputText(events: TerminalSessionStreamEvent[]): string {
  return events
    .filter((event): event is Extract<TerminalSessionStreamEvent, { type: "output" }> => event.type === "output")
    .map((event) => event.data)
    .join("");
}

function statusEvents(events: TerminalSessionStreamEvent[]): Array<Extract<TerminalSessionStreamEvent, { type: "status" }>> {
  return events.filter((event): event is Extract<TerminalSessionStreamEvent, { type: "status" }> => event.type === "status");
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for terminal event.");
}
