import { describe, expect, test } from "bun:test";
import { AFLOW_UPGRADE_COMMAND, aflowUpgradeCommand } from "./upgrade";
import type { CommandIO } from "../io";

describe("aflow upgrade direct command", () => {
  test("runs the stable installer pipeline and exits", async () => {
    const messages: string[] = [];
    const commands: string[] = [];
    await aflowUpgradeCommand([], {
      cwd: "/repo",
      io: captureInfo(messages),
    }, async (command) => {
      commands.push(command);
      return 0;
    });

    expect(commands).toEqual([AFLOW_UPGRADE_COMMAND]);
    expect(commands[0]).toContain("set -o pipefail");
    expect(commands[0]).toContain("/master/install/install.sh");
    expect(commands[0]).not.toContain("/install-v2/");
    expect(messages.join("\n")).toContain("latest stable version");
  });

  test("rejects extra arguments", async () => {
    await expect(aflowUpgradeCommand(["now"], {
      cwd: "/repo",
      io: captureInfo([]),
    }, async () => 0)).rejects.toThrow("Usage: aflow upgrade");
  });
});

function captureInfo(messages: string[]): CommandIO {
  return {
    info(message) {
      messages.push(message);
    },
    success() {},
    warn() {},
    error() {},
  };
}
