---
name: specflow
description: Use when the user asks Codex to create, inspect, validate, run, dynamically review, patch, pause, continue, or resume Specflow/Aflow agent workflows in the current repository.
---

# Specflow

Use the plugin-provided Specflow MCP tools for real workflow operations. Do not
shell out to `specflow run` when the user wants Aflow Agent parity; that command
is the standalone CLI runner and intentionally does not cover dynamic runtime
patching or `pauseAfterRun` ACP conversations.

## Workspace

- Work in the user's target repository, not in the plugin directory.
- Pass the repository path as `cwd` to MCP tools when it is known.
- If the user gives a `serverUrl`, pass it through. Otherwise let MCP locate or
  start the persistent workspace Specflow server.
- Treat returned `serverUrl` and `runId` as durable handles for follow-up tool
  calls.

## Workflow Authoring

- List workflows with `specflow_list_workflows`.
- Read YAML with `specflow_read_workflow`.
- Before adapting an existing workflow, fork it with
  `specflow_fork_workflow_to_local`.
- Write complete workflow YAML with `specflow_write_workflow`; local drafts
  should stay in `agentflows-local` unless the user explicitly wants a shared
  workflow.
- Usually reference files already in the repository by relative path instead of
  importing them.
- Use `specflow_import_assets` rarely: only when the user explicitly wants to
  copy files from outside the repository into
  `.aflow/.specflow/agentflow/assets/...` so the workflow is durable,
  shareable, commit-friendly, or reproducible.
- Validate with `specflow_validate_workflow` before running.

## Agent Servers

- Use `specflow_list_agent_servers` before writing workflow session
  `agentServerId` values.
- Use `specflow_list_agent_registry` when the user wants to inspect available
  registry agents.
- Use `specflow_install_registry_agent` or `specflow_update_registry_agent` only
  when the user explicitly asks to add or update a registry-backed agent server.
- Use `specflow_remove_agent_server` only when the user explicitly asks to
  remove an agent server.
- Do not treat workflow authoring as permission to change agent server config.
- For custom/headless or non-registry agents, ask the user to configure the
  agent in Specflow UI; do not write raw agent server JSON.
- Agent authentication is still handled in Specflow UI; after saving a server,
  ask the user to authenticate in the UI if prepare/start reports auth is
  required.
- Use `specflow_get_agent_capabilities` or
  `specflow_refresh_agent_capabilities` to inspect supported ACP modes,
  permissions, and config options before hard-coding them in workflow YAML.

## Running

- Prepare a run first with `specflow_prepare_run` when variables or auth may be
  missing.
- Ask the user for missing variables in chat, then call prepare/start again
  with `variableValues`.
- If prepare/start reports missing agent authentication, tell the user to open
  the Specflow UI and authenticate there, then retry. Codex does not drive
  terminal/TUI auth through this plugin.
- Start normal or dynamic runs with `specflow_start_run`.
- For long-running workflows, use bounded waits. If a tool returns before the
  run finishes, keep the `runId` and poll with `specflow_get_run` or continue
  with the relevant run tool.
- Use `specflow_rerun`, `specflow_delete_run`, and
  `specflow_save_run_best_practice` only when the user explicitly asks to rerun,
  delete, or preserve a successful runtime snapshot as a workflow.

## Dynamic Review

Dynamic review pauses after activations so Codex can inspect the completed node
text and optionally patch only the current run snapshot.

- Start with `dynamicReview: true`.
- Inspect with `specflow_get_run_checkpoint`.
- Patch only when there is clear evidence that future workflow behavior should
  change.
- Patch with structured `specflow_patch_run_graph` operations, not full YAML.
- Continue with `specflow_run_to_next_checkpoint`.

## pauseAfterRun ACP Conversations

`pauseAfterRun` is a server-owned ACP paused-node session, not MCP elicitation.

When a run reports paused nodes:

1. Call `specflow_list_paused_nodes` if needed.
2. Use `specflow_prompt_paused_node` for one or more messages to the paused ACP
   node.
3. Use `specflow_continue_paused_node` to close the authored pause.

In dynamic mode, call `specflow_continue_paused_node` with `play: false`, then
call `specflow_run_to_next_checkpoint` so the next activation is armed with
dynamic pause behavior.

## Permission, Elicitation, Sessions

- Use `specflow_list_pending_interactions` and
  `specflow_respond_interaction` for ACP permission or elicitation requests.
- Ask the user before selecting permission options unless their instruction is
  already explicit.
- Use session tools to list, restore, prompt, cancel, or close ACP sessions.
- Use `specflow_get_native_resume_commands` or
  `specflow_get_agent_session_native_resume_command` when the user asks how to
  resume a recorded session in a native agent CLI. Trust only returned verified
  commands; if unavailable, use ACP restore/inspect or ask the user.
- Do not look for MCP auth tools. Agent authentication is handled in Specflow UI
  or Aflow, then the Codex run can be retried.
