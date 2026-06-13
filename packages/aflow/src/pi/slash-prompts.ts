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
    "Infer the workflow id, optional run context, and known specflow_* variable values from the conversation and command arguments. If the workflow id is missing, ask the user which workflow to run. Once the workflow is identified, call `specflow_run_workflow`; it will ask required workflow variables one by one in the TUI.",
    "If the workflow id is missing or ambiguous, use `specflow_list_workflows` when helpful and then `ask_user` to choose one. Pass any already-known specflow_* variables as `variableValues` instead of asking for them again. Use `initialInput` only for freeform run context that is not one of the declared workflow variables.",
    "`specflow_run_workflow` is responsible for the full TUI run flow: display node status with node titles, handle pauseAfterRun ACP interaction, and after completion list recorded agent sessions so the user can choose ACP Resume, ACP Inspect, Native CLI in Aflow terminal, Show native resume command, or Skip.",
    "Do not ask for a separate native command after a normal run just to repeat run-end choices; the run tool already offers native resume through the session picker.",
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
    "`specflow_resume_workflow` resumes an interrupted workflow run. It is not the same as resuming an individual agent session; ACP Resume/Inspect is offered by the run-end session picker.",
    "Infer the run id from context only when it is clear. If it is missing or ambiguous, use `ask_user` instead of guessing.",
    commandGuidance("specflow_resume_workflow"),
    "",
    "User command arguments:",
    args.trim() || "(No explicit run id supplied. Infer the intended run from context, or ask the user which run to resume.)",
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

export function buildMigrateV2WorkflowPrompt(target: string): string {
  return [
    "Migrate a Specflow Agentflow workflow from version 1 to version 2.",
    "",
    "Target workflow:",
    target,
    "",
    "Read the workflow first with `specflow_read_workflow`. Create a local migrated copy unless the user explicitly requested in-place shared maintenance. For a UI-launched migration, prefer a local draft in `.aflow/.specflow/agentflow/agentflows-local/` with a new kebab-case id ending in `-v2` when needed.",
    "",
    "Required v2 changes:",
    "- Set `version: 2`.",
    "- Add one or more `kind: start` nodes and connect each start node to the intended first step. Do not rely on inferred initial nodes.",
    "- Replace v1 `kind: input` nodes with top-level `variables:` entries. Preserve `variableName`, title, required, defaultValue, and description where present. Prompts may keep using `<specflow_...>` tokens.",
    "- Remove authored edge `loopback`. In v2 loop-closing edges are derived by validation/runtime and shown by the UI.",
    "- Move gate branch traversal limits from edge `maxTraversals` to the matching gate branch `maxTraversals` field.",
    "- Remove edge `maxTraversals` from all edges.",
    "- Start edges are control-only and should target step nodes.",
    "",
    "Validation expectations:",
    "- Use `specflow_validate_workflow` after writing the migrated workflow.",
    "- If validation reports a loop-internal gate branch missing `maxTraversals`, add a conservative branch bound based on the v1 edge limit or ask the user if the business limit is ambiguous.",
    "- Do not teach or reintroduce v1 input nodes, edge loopback, or edge maxTraversals.",
    "",
    "After validation, summarize the new workflow id/path and the specific v1 keys that were removed or moved.",
  ].join("\n");
}

function commandGuidance(toolName: string): string {
  return [
    `Use the \`${toolName}\` tool after extracting enough arguments from the conversation.`,
    "If required information is missing, use `ask_user` instead of guessing.",
  ].join("\n");
}
