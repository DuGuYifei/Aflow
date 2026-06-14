import type { CommandIO } from "./io";
import { parseCommonCommandOptions } from "./args";
import { runAflowAgent } from "../pi/pi-sdk-host";
import { buildCreateWorkflowPrompt, buildForkAdaptWorkflowPrompt, buildMigrateV2WorkflowPrompt } from "../pi/slash-prompts";
import { specflowResumeCommand } from "./commands/resume";
import { specflowResumeSessionCommand } from "./commands/resume-session";
import { specflowRunCommand } from "./commands/run";
import { aflowUpgradeCommand } from "./commands/upgrade";
import { specflowValidateCommand } from "./commands/validate";

export interface DirectCommandContext {
  cwd: string;
  io: CommandIO;
  nativeTerminalHandoff?: boolean;
}

const DIRECT_COMMANDS = new Set([
  "upgrade",
  "specflow-create",
  "specflow-fork-adapt",
  "specflow-validate",
  "specflow-run",
  "specflow-migrate-v2",
  "specflow-resume",
  "specflow-resume-session",
]);

export function isDirectAflowCommand(value: string | undefined): boolean {
  if (!value) return false;
  const command = normalizeCommandName(value);
  if (command === "upgrade") return value === "upgrade";
  return DIRECT_COMMANDS.has(command);
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
  if (command === "specflow-migrate-v2") {
    const { serverUrl, rest: migrateRest } = parseCommonCommandOptions(rest);
    const target = migrateRest[0];
    if (!target) throw new Error("Usage: /specflow-migrate-v2 <workflow-id|path/to/workflow.yaml> [--server URL]");
    if (migrateRest.length > 1) throw new Error(`Unexpected argument: ${migrateRest[1]}`);
    if (serverUrl) process.env["AFLOW_SPECFLOW_URL"] = serverUrl;
    await runAflowAgent([buildMigrateV2WorkflowPrompt(target)]);
    return;
  }
  await dispatchParsedCommand(command, rest, context);
}

async function dispatchParsedCommand(command: string, args: string[], context: DirectCommandContext): Promise<void> {
  if (command === "upgrade") {
    await aflowUpgradeCommand(args, context);
    return;
  }
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
