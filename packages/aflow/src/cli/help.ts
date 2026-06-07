import { getAflowVersion } from "../bootstrap/runtime-package";

export function isHelpRequest(args: string[]): boolean {
  return args.length === 0 ? false : args.some((arg) => arg === "--help" || arg === "-h");
}

export function isVersionRequest(args: string[]): boolean {
  return args.some((arg) => arg === "--version" || arg === "-v");
}

export function printAflowVersion(): void {
  console.log(getAflowVersion());
}

export function printAflowHelp(): void {
  console.log(`Aflow - Specflow workflow-building agent

Usage:
  aflow [options] [@files...] [messages...]
  aflow /specflow-validate <workflow-id|path> [--server URL]
  aflow /specflow-run <workflow-id> [--input TEXT] [-Dname=value] [--server URL]
  aflow /specflow-resume <run-id> [--server URL]
  aflow /specflow-resume-session <run-id> [--server URL]

Slash commands inside the TUI:
  /specflow-create            Create a workflow from a business goal
  /specflow-fork-adapt        Copy a workflow to agentflows-local and adapt it
  /specflow-validate          Validate a workflow after inferring or asking for the target
  /specflow-run               Run a workflow and ask missing inputs one by one
  /specflow-resume            Resume a cancelled or failed Specflow run
  /specflow-resume-session    Choose ACP/native resume for a recorded agent session

Pi-compatible options:
  --model <pattern>           Select model, supports provider/model and :thinking
  --models <patterns>         Limit Ctrl+P model cycling
  --thinking <level>          off, minimal, low, medium, high, xhigh
  --provider <name>           Provider name
  --api-key <key>             Runtime API key for selected provider
  --print, -p                 Non-interactive mode
  --mode <text|json|rpc>      Output mode
  --resume, -r                Select an Aflow/Pi chat session to resume
  --continue, -c              Continue the latest local chat session
  --session <path|id>         Open a specific chat session
  --fork <path|id>            Fork a chat session
  --session-dir <dir>         Override chat session storage
  --tools <names>             Enable only these tools
  --exclude-tools <names>     Disable specific tools
  --extension, -e <path>      Load Pi extension files
  --skill <path>              Load Pi skills
  --theme <path>              Load Pi themes
  --offline                   Disable startup network operations
  --version, -v               Show version
  --help, -h                  Show this help

Workflow files:
  Shared workflows: .aflow/.specflow/agentflow/agentflows/
  Local drafts:     .aflow/.specflow/agentflow/agentflows-local/
`);
}
