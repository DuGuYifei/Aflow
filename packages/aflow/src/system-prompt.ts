import { AFLOW_SYSTEM_PROMPT } from "./prompt-content";

export function withAflowSystemPrompt(args: string[]): string[] {
  if (process.env["AFLOW_DISABLE_SYSTEM_PROMPT"] === "1") return args;
  if (isHelpOrVersionRequest(args)) return args;

  if (hasOption(args, "--system-prompt")) {
    return [...args, "--append-system-prompt", AFLOW_SYSTEM_PROMPT];
  }

  return ["--system-prompt", AFLOW_SYSTEM_PROMPT, ...args];
}

function isHelpOrVersionRequest(args: string[]): boolean {
  return args.some((argument) => argument === "--help" || argument === "-h" || argument === "--version" || argument === "-v");
}

function hasOption(args: string[], longName: string): boolean {
  return args.some((argument) => argument === longName || argument.startsWith(`${longName}=`));
}
