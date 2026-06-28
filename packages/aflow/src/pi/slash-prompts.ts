import { CREATE_WORKFLOW_PROMPT, FORK_ADAPT_WORKFLOW_PROMPT } from "../prompt-content";

export function buildCreateWorkflowPrompt(args: string): string {
  return [
    CREATE_WORKFLOW_PROMPT,
    "",
    "User goal:",
    args.trim() || "(No goal text was supplied. Ask the user for the business goal and required workflow variables.)",
  ].join("\n");
}

export function buildForkAdaptWorkflowPrompt(args: string): string {
  return [
    FORK_ADAPT_WORKFLOW_PROMPT,
    "",
    "First use `specflow_fork_workflow_to_local` once the source workflow is known. Then edit or rewrite the copied local workflow.",
    "",
    "Adaptation request:",
    args.trim() || "(No adaptation request was supplied. Ask which workflow to adapt and what changed.)",
  ].join("\n");
}

export function buildValidateWorkflowPrompt(args: string): string {
  return [
    "Validate a Specflow workflow.",
    "",
    "Infer the workflow id or YAML path from the conversation and command arguments. If the target is missing or ambiguous, use `specflow_list_workflows` when helpful and then `ask_user` to choose the workflow.",
    commandGuidance("specflow_validate_workflow"),
    "",
    "User command arguments:",
    args.trim() || "(No explicit target supplied. Infer the intended workflow from context, or ask the user which workflow to validate.)",
  ].join("\n");
}

export function buildRunWorkflowPrompt(args: string): string {
  return [
    "Run a Specflow workflow.",
    "",
    "Infer the workflow id, optional run context, and known specflow_* variable values from the conversation and command arguments. If the workflow id is missing, ask the user which workflow to run. Once the workflow is identified, call `specflow_run_workflow`; it will ask required workflow variables one by one in the TUI and then ask the user to choose Normal run or Dynamic review unless the mode was already explicit.",
    "If the workflow id is missing or ambiguous, use `specflow_list_workflows` when helpful and then `ask_user` to choose one. Pass any already-known specflow_* variables as `variableValues` instead of asking for them again. Use `initialInput` only for freeform run context that is not one of the declared workflow variables.",
    "`specflow_run_workflow` is responsible for the full TUI run flow. In Normal run it displays node status, handles pauseAfterRun ACP interaction, and after completion lists recorded agent sessions. In Dynamic review it creates the run, pauses after the first activation, and returns the first checkpoint; later checkpoints are reached with `specflow_run_to_next_checkpoint`.",
    "Dynamic review is Aflow-driven checkpoint review, not user-driven stepping. Inspect completed node text, patch only the current run snapshot when needed, and continue without asking the user at every checkpoint unless pauseAfterRun, permission/elicitation, auth, missing variables, ambiguity, or high-risk actions require user input.",
    "If the user explicitly asks for dynamic optimization, pass dynamicReview: true; the TUI still confirms the run mode.",
    "Do not ask for a separate native command after a normal run just to repeat run-end choices; the run tool already offers native resume through the session picker.",
    "Do not execute shell `specflow run`. That is the standalone CLI path, rejects pauseAfterRun workflows, and does not provide Aflow's ACP pause interaction.",
    "",
    "User command arguments:",
    args.trim() || "(No explicit workflow id supplied. Infer it from context or ask the user.)",
  ].join("\n");
}

export function buildContinueWorkflowPrompt(args: string): string {
  return [
    "Continue a stopped or failed Specflow workflow run.",
    "",
    "`specflow_continue_workflow` creates a continuation run from a stopped or failed workflow run. It is not the same as resuming or inspecting an individual agent session; ACP Resume/Inspect is offered by the run-end session picker.",
    "Infer the run id from context only when it is clear. If it is missing or ambiguous, use `ask_user` instead of guessing.",
    commandGuidance("specflow_continue_workflow"),
    "",
    "User command arguments:",
    args.trim() || "(No explicit run id supplied. Infer the intended run from context, or ask the user which run to continue.)",
  ].join("\n");
}

export function buildResumeSessionPrompt(args: string): string {
  return [
    "Resume or inspect a recorded agent session from a Specflow run.",
    "",
    "Infer the run id from context only when it is clear. If it is missing or ambiguous, use `ask_user` instead of guessing.",
    "`specflow_resume_session` opens the full session resume picker when the TUI is available: ACP Resume, ACP Inspect, Native CLI in Aflow terminal, Show native resume command, or Skip.",
    "Do not guess native resume commands. Native commands are generated only by Aflow's built-in adapter table and returned by tools.",
    commandGuidance("specflow_resume_session"),
    "",
    "User command arguments:",
    args.trim() || "(No explicit run id supplied. Infer the intended run from context, or ask the user which run to resume.)",
  ].join("\n");
}

function commandGuidance(toolName: string): string {
  return [
    `Use the \`${toolName}\` tool after extracting enough arguments from the conversation.`,
    "If required information is missing, use `ask_user` instead of guessing.",
  ].join("\n");
}
