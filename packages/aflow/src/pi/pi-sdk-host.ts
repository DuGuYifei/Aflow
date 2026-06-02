import { main as piMain, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { withAflowSystemPrompt } from "../system-prompt";
import { createAflowPiExtension } from "./aflow-extension";

export interface RunAflowAgentOptions {
  extensionFactories?: ExtensionFactory[];
}

export async function runAflowAgent(args: string[], options: RunAflowAgentOptions = {}): Promise<void> {
  const extensionFactories = [
    createAflowPiExtension(),
    ...(options.extensionFactories ?? []),
  ];
  await piMain(withAflowSystemPrompt(args), { extensionFactories });
}
