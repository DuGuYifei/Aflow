import { emitKeypressEvents } from "node:readline";
import { main as piMain, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { aflowUpgradeCommand } from "../cli/commands/upgrade";
import { consoleCommandIO } from "../cli/io";
import { connectOrStartSpecflowServer } from "../server/connect-or-start";
import { withAflowSystemPrompt } from "../system-prompt";
import { printAflowStartupBanner } from "./aflow-banner";
import { createAflowPiExtension } from "./aflow-extension";
import { dismissAflowUpdate, startAflowUpdateCheck, type AflowUpdateInfo } from "./update-check";

type AflowUpdateAction = "skip" | "upgrade";

export interface RunAflowAgentOptions {
  checkForUpdates?: boolean;
  extensionFactories?: ExtensionFactory[];
  updatePrompt?: (update: AflowUpdateInfo) => Promise<AflowUpdateAction | undefined>;
  upgradeCommand?: () => Promise<void>;
}

export async function runAflowAgent(args: string[], options: RunAflowAgentOptions = {}): Promise<void> {
  printAflowStartupBanner();
  const updateCheck = options.checkForUpdates === false ? undefined : startAflowUpdateCheck(args);
  if (updateCheck?.cachedUpdate) {
    const action = await (options.updatePrompt ?? promptAflowUpdateChoice)(updateCheck.cachedUpdate);
    if (action === "upgrade") {
      await runUpgradeCommand(options);
      return;
    }
    if (action === "skip") {
      try {
        dismissAflowUpdate(updateCheck.cachedUpdate);
      } catch {
        // Cache writes should not block startup.
      }
    }
  }
  const specflow = await connectOrStartSpecflowServer({ cwd: process.cwd() });
  const extensionFactories = [
    createAflowPiExtension({ specflowUrl: specflow.url }),
    ...(options.extensionFactories ?? []),
  ];
  try {
    await piMain(withAflowSystemPrompt(args), { extensionFactories });
  } finally {
    if (specflow.started) specflow.server?.stop();
  }
}

async function runUpgradeCommand(options: RunAflowAgentOptions): Promise<void> {
  await (options.upgradeCommand ?? (() => aflowUpgradeCommand([], {
    cwd: process.cwd(),
    io: consoleCommandIO,
    nativeTerminalHandoff: true,
  })))();
}

async function promptAflowUpdateChoice(update: AflowUpdateInfo): Promise<AflowUpdateAction | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;

  const choices: Array<{ label: string; action: AflowUpdateAction }> = [
    { label: "Skip", action: "skip" },
    { label: "Upgrade now", action: "upgrade" },
  ];
  let selected = 0;
  let renderedLines = 0;
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;

  return new Promise((resolve) => {
    const render = () => {
      if (renderedLines > 0) process.stdout.write(`\x1b[${renderedLines}A`);
      const lines = [
        `Aflow ${update.latestVersion} is available. Current version: ${update.currentVersion}.`,
        "Use Up/Down and Enter.",
        ...choices.map((choice, index) => `${index === selected ? ">" : " "} ${choice.label}`),
      ];
      for (const line of lines) {
        process.stdout.write(`\x1b[2K\r${line}\n`);
      }
      renderedLines = lines.length;
    };

    const finish = (action: AflowUpdateAction | undefined) => {
      stdin.off("keypress", onKeypress);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write("\x1b[?25h");
      process.stdout.write(action === "upgrade" ? "Upgrading now...\n" : "Continuing with current version.\n");
      resolve(action);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        finish(undefined);
        return;
      }
      if (key.name === "escape") {
        finish(undefined);
        return;
      }
      if (key.name === "up" || key.name === "k") {
        selected = (selected + choices.length - 1) % choices.length;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j" || key.name === "tab") {
        selected = (selected + 1) % choices.length;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(choices[selected]?.action);
      }
    };

    process.stdout.write("\n\x1b[?25l");
    emitKeypressEvents(stdin);
    stdin.on("keypress", onKeypress);
    stdin.setRawMode(true);
    stdin.resume();
    render();
  });
}
