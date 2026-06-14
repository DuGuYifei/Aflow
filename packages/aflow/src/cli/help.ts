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
  aflow upgrade
  aflow /specflow-validate <workflow-id|path> [--server URL]
  aflow /specflow-migrate-v2 <workflow-id|path> [--server URL]
  aflow /specflow-run <workflow-id> [--context TEXT] [-Dspecflow_name=value] [--server URL]
  aflow /specflow-resume <run-id> [--server URL]
  aflow /specflow-resume-session <run-id> [--server URL]

Slash commands inside the TUI:
  /specflow-create            Create a Specflow v2 workflow from a business goal
  /specflow-fork-adapt        Copy a workflow to agentflows-local and adapt it as a v2 draft
  /specflow-validate          Validate a workflow after inferring or asking for the target
  /specflow-run               Run a workflow and ask missing specflow_* variables one by one
  /specflow-resume            Resume a cancelled or failed Specflow run
  /specflow-resume-session    Choose ACP/native resume for a recorded agent session

Direct /specflow-run options:
  -Dspecflow_name=value       Supply a declared workflow variable
  --context <text>            Optional freeform run context, separate from workflow variables
  --input <text>              Deprecated alias for --context

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
