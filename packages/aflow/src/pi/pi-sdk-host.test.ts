import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AflowUpdateInfo, StartedAflowUpdateCheck } from "./update-check";

let runAflowAgent: typeof import("./pi-sdk-host").runAflowAgent;
let events: string[] = [];
let startUpdateCalls = 0;
let dismissedUpdates: AflowUpdateInfo[] = [];
let selectChoice: string | undefined = "Skip";
let updateCheck: StartedAflowUpdateCheck = { cachedUpdate: undefined, refresh: undefined };

const originalStdoutWrite = process.stdout.write;

mock.module("@earendil-works/pi-coding-agent", () => ({
  main: async (_args: string[], options?: { extensionFactories?: ExtensionFactory[] }) => {
    const sessionStartHandlers: Array<(event: unknown, ctx: unknown) => Promise<void> | void> = [];
    const pi = {
      on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) {
        if (event === "session_start") sessionStartHandlers.push(handler);
      },
      registerCommand() {},
      registerTool() {},
      sendUserMessage() {},
    };
    for (const factory of options?.extensionFactories ?? []) factory(pi as never);
    for (const handler of sessionStartHandlers) {
      await handler({ type: "session_start", reason: "startup" }, {
        hasUI: true,
        ui: {
          setTitle() {},
          setStatus() {},
          setHeader() {},
          async select(title: string, choices: string[]) {
            events.push(`select:${title}:${choices.join("|")}`);
            return selectChoice;
          },
          notify() {},
        },
        shutdown() {
          events.push("shutdown");
        },
      });
    }
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
  createAflowPiExtension: () => () => {},
}));

mock.module("./update-check", () => ({
  startAflowUpdateCheck: () => {
    startUpdateCalls += 1;
    return updateCheck;
  },
  dismissAflowUpdate: (update: AflowUpdateInfo) => {
    dismissedUpdates.push(update);
  },
}));

beforeAll(async () => {
  ({ runAflowAgent } = await import("./pi-sdk-host"));
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  events = [];
  startUpdateCalls = 0;
  dismissedUpdates = [];
  selectChoice = "Skip";
  updateCheck = { cachedUpdate: undefined, refresh: undefined };
});

describe("runAflowAgent startup update notice", () => {
  test("asks in the TUI and dismisses a cached update when skipped", async () => {
    updateCheck = {
      cachedUpdate: { currentVersion: "0.0.4", latestVersion: "0.0.5" },
      refresh: Promise.resolve(),
    };

    await runAflowAgent(["hello"], {
      updatePrompt: async (update) => {
        events.push(`prompt:${update.latestVersion}`);
        return "skip";
      },
    });

    expect(startUpdateCalls).toBe(1);
    expect(events).toEqual([
      "banner",
      "prompt:0.0.5",
      "connect",
      "pi",
    ]);
    expect(dismissedUpdates).toEqual([{ currentVersion: "0.0.4", latestVersion: "0.0.5" }]);
  });

  test("shuts down the TUI and runs upgrade when selected", async () => {
    updateCheck = {
      cachedUpdate: { currentVersion: "0.0.4", latestVersion: "0.0.5" },
      refresh: Promise.resolve(),
    };

    await runAflowAgent(["hello"], {
      updatePrompt: async (update) => {
        events.push(`prompt:${update.latestVersion}`);
        return "upgrade";
      },
      upgradeCommand: async () => {
        events.push("upgrade");
      },
    });

    expect(events).toEqual([
      "banner",
      "prompt:0.0.5",
      "upgrade",
    ]);
    expect(dismissedUpdates).toEqual([]);
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
