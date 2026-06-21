import { main as piMain, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { connectOrStartSpecflowServer } from "../server/connect-or-start";
import { withAflowSystemPrompt } from "../system-prompt";
import { printAflowStartupBanner } from "./aflow-banner";
import { createAflowPiExtension } from "./aflow-extension";
import { formatAflowUpdateNotice, startAflowUpdateCheck } from "./update-check";

export interface RunAflowAgentOptions {
  checkForUpdates?: boolean;
  extensionFactories?: ExtensionFactory[];
}

export async function runAflowAgent(args: string[], options: RunAflowAgentOptions = {}): Promise<void> {
  printAflowStartupBanner();
  const updateCheck = options.checkForUpdates === false ? undefined : startAflowUpdateCheck(args);
  if (updateCheck?.cachedUpdate) process.stdout.write(`${formatAflowUpdateNotice(updateCheck.cachedUpdate)}\n`);
  const extensionFactories = [
    createAflowPiExtension(),
    ...(options.extensionFactories ?? []),
  ];
  const specflow = await connectOrStartSpecflowServer({ cwd: process.cwd() });
  try {
    await piMain(withAflowSystemPrompt(args), { extensionFactories });
  } finally {
    if (specflow.started) specflow.server?.stop();
  }
}
