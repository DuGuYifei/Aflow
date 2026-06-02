import type { CommandIO } from "./io";
import { runAflowAgent } from "../pi/pi-sdk-host";
import { buildCreateWorkflowPrompt, buildForkAdaptWorkflowPrompt } from "../pi/slash-prompts";
import { specflowResumeCommand } from "./commands/resume";
import { specflowResumeSessionCommand } from "./commands/resume-session";
import { specflowRunCommand } from "./commands/run";
import { specflowValidateCommand } from "./commands/validate";

export interface DirectCommandContext {
  cwd: string;
  io: CommandIO;
  nativeTerminalHandoff?: boolean;
}

const DIRECT_COMMANDS = new Set([
  "specflow-create",
  "specflow-fork-adapt",
  "specflow-validate",
  "specflow-run",
  "specflow-resume",
  "specflow-resume-session",
]);

export function isDirectAflowCommand(value: string | undefined): boolean {
  return Boolean(value && DIRECT_COMMANDS.has(normalizeCommandName(value)));
}

export async function dispatchDirectAflowCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const [rawCommand, ...rest] = args;
  const command = normalizeCommandName(rawCommand);
  if (command === "specflow-create") {
    await runAflowAgent([buildCreateWorkflowPrompt(rest.join(" "))]);
    return;
  }
  if (command === "specflow-fork-adapt") {
    await runAflowAgent([buildForkAdaptWorkflowPrompt(rest.join(" "))]);
    return;
  }
  await dispatchParsedCommand(command, rest, context);
}

async function dispatchParsedCommand(command: string, args: string[], context: DirectCommandContext): Promise<void> {
  if (command === "specflow-validate") {
    await specflowValidateCommand(args, context);
    return;
  }
  if (command === "specflow-run") {
    await specflowRunCommand(args, context);
    return;
  }
  if (command === "specflow-resume") {
    await specflowResumeCommand(args, context);
    return;
  }
  if (command === "specflow-resume-session") {
    await specflowResumeSessionCommand(args, context);
    return;
  }
  throw new Error(`Unknown Aflow command: ${command}`);
}

function normalizeCommandName(value: string | undefined): string {
  return (value ?? "").replace(/^\/+/, "");
}
