---
title: Aflow / UI / Codex Capabilities
description: Compare what Aflow Agent, Specflow UI, and the Codex plugin are best suited for.
order: 45
updatedAt: 2026-06-28
---

# Aflow / UI / Codex Capabilities

Specflow has three main surfaces:

- **Aflow Agent**: an interactive terminal workflow agent. Use it when you want
  AI to create, adapt, run, dynamically review, and resume workflows.
- **Specflow UI**: the browser operator and visual editor. Use it to inspect
  graphs, logs, runs, agent server config, auth, and manual run control.
- **Codex plugin**: lets Codex use the current repository's Specflow server
  through MCP. Use it from a Codex thread to read/write workflows, run dynamic
  workflows, inspect runs, and restore sessions.

All three operate on the same workspace and the same Specflow server/runtime.
The difference is the interaction model and the task each surface is best at.

## Capability Matrix

| Capability | Aflow Agent | Specflow UI | Codex plugin |
|---|---|---|---|
| Create workflow | Supported. Conversational authoring with Aflow tools. | Supported. Visual canvas authoring. | Supported. MCP tools write workflow YAML. |
| Read/edit workflow | Supported. Good for AI fork/adapt and YAML repair. | Supported. Good for manual canvas editing. | Supported. Good for Codex task-local workflow edits. |
| Fork/adapt workflow | Supported. Copies to a local draft before editing. | Mostly manual. | Supported. MCP forks to a local draft. |
| Validate workflow | Supported. Aflow can explain and help fix diagnostics. | Supported. Save/run paths show diagnostics. | Supported. Codex can validate before running. |
| Normal run | Supported. TUI shows live state. | Supported. Browser shows live state, logs, and canvas. | Supported. MCP starts a run; follow-up uses `runId`. |
| Dynamic run | Supported. Stops at each checkpoint; Aflow can inspect and patch the current run snapshot. | Partial. UI can inspect and manually control the run, but it is not an AI dynamic reviewer. | Supported. Stops at each checkpoint; Codex can inspect and patch the current run snapshot. |
| Runtime graph patch | Supported. Edits only the current run snapshot. | Supported where runtime snapshot UI is exposed. | Supported. Edits only the current run snapshot. |
| Historical run/log inspection | Supported. Useful for known run ids and context recovery. | Supported. Best surface for history, timeline, and logs. | Supported. Main recovery path for long Codex tasks. |
| pause / play / interrupt / stop | Supported for known active runs. | Supported. Best manual control surface. | Supported through MCP for known run ids. |
| Continue stopped/error run | Supported. Creates a new continuation run. | Supported. Creates a new continuation run. | Supported. Creates a new continuation run. |
| `pauseAfterRun` node chat | Supported in the Aflow TUI. | Supported in browser paused-node panels. | Supported through MCP paused-node tools. |
| Permission / elicitation | Supported through the Aflow TUI. | Supported through browser interaction modals. | Supported through MCP interaction tools. |
| Agent session resume/inspect | Supported. Aflow has a session picker and native handoff. | Supported. Browser session inspection and restore. | Supported. MCP restore/prompt/close tools. |
| Native CLI resume command | Supported. Can show commands or hand off in the Aflow terminal. | Supported by server data where UI exposes it. | Supported. Returns verified native resume commands; unknown agents are not guessed. |
| Agent server config | Partial helper support. Good for listing/installing/updating registry agents. | Supported. Recommended for custom/headless agents, auth, and complex environments. | Supports registry agent list/install/update/remove; custom/headless setup should use UI. |
| Agent auth | Supported through UI/Aflow/server auth paths. | Supported. Recommended auth surface, including terminal auth. | Does not drive terminal auth. If auth is required, authenticate in UI and retry. |
| Asset import | Usually unnecessary. Aflow can write repo-relative paths. | Supported through browser upload/import. | Supported but rare. Use only when explicitly copying external files into workflow assets. |
| Codex plugin installation | Not applicable. | Not applicable. | Supported. The plugin declares MCP and skill files; it does not bundle the `specflow` binary. |

## Which Surface Should I Use?

Use **Aflow Agent** when you want AI to operate on the workflow itself:

- create a workflow from a business goal;
- fork/adapt an existing workflow;
- run dynamic review;
- continue into an agent session after a run.

Use **Specflow UI** when you need manual visibility and configuration:

- inspect workflow graphs, run state, timeline, and logs;
- configure or authenticate agent servers;
- manually pause/play/interrupt/stop;
- handle terminal auth;
- edit canvas layout.

Use the **Codex plugin** when you are already working in Codex:

- ask Codex to read, edit, or validate workflows;
- ask Codex to start normal or dynamic runs;
- recover long-running work by `runId`;
- ask Codex to patch the current run snapshot based on run results.

## Intentional Differences

- The Codex plugin does not handle terminal auth. Authenticate in Specflow UI.
- Aflow usually does not need asset import; repo files should be referenced by
  relative path.
- UI is the richest manual operator surface; Aflow and Codex are AI/operator
  surfaces.
- Dynamic run patches edit only the current run snapshot. They do not
  automatically overwrite saved workflow YAML.

For engineering implementation details, see
`docs/architecture/capability-matrix.md`.
