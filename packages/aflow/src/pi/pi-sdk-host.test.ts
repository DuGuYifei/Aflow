import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AflowUpdateInfo, StartedAflowUpdateCheck } from "./update-check";

let runAflowAgent: typeof import("./pi-sdk-host").runAflowAgent;
let events: string[] = [];
let startUpdateCalls = 0;
let updateCheck: StartedAflowUpdateCheck = { cachedUpdate: undefined, refresh: undefined };

const originalStdoutWrite = process.stdout.write;

mock.module("@earendil-works/pi-coding-agent", () => ({
  main: async () => {
    events.push("pi");
  },
}));

mock.module("../server/connect-or-start", () => ({
  connectOrStartSpecflowServer: async () => {
    events.push("connect");
    return { started: false };
  },
}));

mock.module("../system-prompt", () => ({
  withAflowSystemPrompt: (args: string[]) => args,
}));

mock.module("./aflow-banner", () => ({
  printAflowStartupBanner: () => {
    events.push("banner");
  },
}));

mock.module("./aflow-extension", () => ({
  createAflowPiExtension: () => ({}),
}));

mock.module("./update-check", () => ({
  startAflowUpdateCheck: () => {
    startUpdateCalls += 1;
    return updateCheck;
  },
  formatAflowUpdateNotice: (update: AflowUpdateInfo) => `notice ${update.latestVersion}`,
}));

beforeAll(async () => {
  ({ runAflowAgent } = await import("./pi-sdk-host"));
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  events = [];
  startUpdateCalls = 0;
  updateCheck = { cachedUpdate: undefined, refresh: undefined };
});

describe("runAflowAgent startup update notice", () => {
  test("prints a cached update notice before connecting to Specflow", async () => {
    updateCheck = {
      cachedUpdate: { currentVersion: "0.0.4", latestVersion: "0.0.5" },
      refresh: Promise.resolve(),
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      events.push(`write:${String(chunk).trim()}`);
      return true;
    }) as typeof process.stdout.write;

    await runAflowAgent(["hello"]);

    expect(startUpdateCalls).toBe(1);
    expect(events).toEqual(["banner", "write:notice 0.0.5", "connect", "pi"]);
  });

  test("skips cached notices and refreshes when update checks are disabled", async () => {
    updateCheck = {
      cachedUpdate: { currentVersion: "0.0.4", latestVersion: "0.0.5" },
      refresh: Promise.resolve(),
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      events.push(`write:${String(chunk).trim()}`);
      return true;
    }) as typeof process.stdout.write;

    await runAflowAgent(["hello"], { checkForUpdates: false });

    expect(startUpdateCalls).toBe(0);
    expect(events).toEqual(["banner", "connect", "pi"]);
  });
});
