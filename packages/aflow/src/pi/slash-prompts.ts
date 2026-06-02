import { CREATE_WORKFLOW_PROMPT, FORK_ADAPT_WORKFLOW_PROMPT } from "../prompt-content";

export function buildCreateWorkflowPrompt(args: string): string {
  return [
    CREATE_WORKFLOW_PROMPT,
    "",
    "User goal:",
    args.trim() || "(No goal text was supplied. Ask the user for the business goal and required inputs.)",
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
    "Infer the workflow id and initial input from the conversation and command arguments. If the workflow id is missing, ask the user which workflow to run. Once the workflow is identified, call `specflow_run_workflow`; it will ask required workflow input variables one by one in the TUI.",
    "If the workflow id is missing or ambiguous, use `specflow_list_workflows` when helpful and then `ask_user` to choose one. Pass any already-known specflow_* variables to `specflow_run_workflow` instead of asking for them again.",
    "`specflow_run_workflow` is responsible for the full TUI run flow: display node status with node titles, handle pauseAfterRun ACP interaction, and after completion list recorded agent sessions so the user can choose ACP Continue, ACP Inspect, Native CLI, or Skip.",
    "Do not call `specflow_native_resume_recommendation` after a normal run just to repeat run-end choices.",
    "Do not execute shell `specflow run`. That is the standalone CLI path, rejects pauseAfterRun workflows, and does not provide Aflow's ACP pause interaction.",
    "",
    "User command arguments:",
    args.trim() || "(No explicit workflow id supplied. Infer it from context or ask the user.)",
  ].join("\n");
}

export function buildResumeWorkflowPrompt(args: string): string {
  return [
    "Resume a cancelled or failed Specflow workflow run.",
    "",
    "`specflow_resume_workflow` resumes an interrupted workflow run. It is not the same as entering an individual agent session; ACP Continue/Inspect is offered by the run-end session picker.",
    "Infer the run id from context only when it is clear. If it is missing or ambiguous, use `ask_user` instead of guessing.",
    commandGuidance("specflow_resume_workflow"),
    "",
    "User command arguments:",
    args.trim() || "(No explicit run id supplied. Infer the intended run from context, or ask the user which run to resume.)",
  ].join("\n");
}

export function buildNativeResumePrompt(args: string): string {
  return [
    "Recommend a native external-agent resume command for a Specflow run.",
    "",
    "Use this only when the user explicitly asks for an external native CLI continuation. Do not use it as a normal follow-up to /specflow-run, because the run tool already offers Native CLI in the TUI session picker.",
    "Infer the run id from context and call `specflow_native_resume_recommendation`. If the run id or native session id is missing and cannot be inferred, ask the user. Do not claim native execution happened unless the direct CLI actually performed it.",
    "",
    "User command arguments:",
    args.trim() || "(No explicit run id supplied. Infer it from context or ask the user.)",
  ].join("\n");
}

function commandGuidance(toolName: string): string {
  return [
    `Use the \`${toolName}\` tool after extracting enough arguments from the conversation.`,
    "If required information is missing, use `ask_user` instead of guessing.",
  ].join("\n");
}
