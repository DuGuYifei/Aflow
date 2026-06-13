---
title: Aflow Agent Tutorial
description: Learn how to use Aflow Agent to create, adapt, validate, run, and resume Specflow workflows.
category: tutorial
order: 4
updatedAt: "2026-06-09 01:12:49 CEST"
tags:
  - aflow
  - agent
  - workflow
---

# Aflow Agent Tutorial

Aflow Agent is Specflow's terminal workflow agent. It runs in your project directory and uses conversation to understand business goals, help you create workflows, fork/adapt existing workflows into local variants, validate YAML, run workflows, and continue into an agent session associated with a workflow node after the run finishes.

Unlike direct `specflow run`, Aflow is designed for interactive collaboration. It asks when required information is missing, collects required workflow variables before a workflow run, and keeps node status, pause interaction, and session resume inside the same TUI.

You do not have to memorize slash commands. If you say in chat that you want to turn a process into a workflow, run something with Specflow, or adapt a general workflow to a specific business case, Aflow can understand the intent and call workflow tools to create, copy, adapt, or validate the workflow.

## Starting Aflow

Start Aflow with no arguments:

```sh
aflow
```

Aflow starts the agent TUI directly.

To start the browser workspace UI without opening an Aflow agent conversation, use:

```sh
specflow
```

The Designer UI is served by the same Specflow server at `/design`; start `specflow` and open the printed server URL with `/design`.

## Aflow-Specific Capabilities

### Create Workflows Through Conversation

In Aflow, enter:

```text
/specflow-create
```

Aflow first understands your business goal, required agents, inputs and outputs, branch decisions, and human interaction points. When information is missing, it asks through the TUI instead of guessing a workflow.

A more natural pattern is to chat first so Aflow can understand the business context, constraints, existing tools, team process, and any general workflow you want to reuse. Once the goal is clear, say "create this as a workflow", or ask Aflow to adapt an existing workflow into a local version for the current business case.

Created workflows are written to `.aflow/.specflow/agentflow/agentflows-local/`, which is suitable for local drafts for the current project or user. Once a workflow should become shared team workflow-as-code, move it into `.aflow/.specflow/agentflow/agentflows/`.

### Fork/Adapt Existing Workflows

In Aflow, enter:

```text
/specflow-fork-adapt
```

Aflow reads an existing workflow, copies it into `.aflow/.specflow/agentflow/agentflows-local/`, and edits the copy for the new goal. It should not overwrite the source workflow unless the user explicitly asks to maintain the shared team version.

Good fork/adapt use cases include:

- Turning a general code review workflow into a release review workflow for the current project.
- Adapting an existing frontend workflow to backend, docs, or test-focused work.
- Creating a temporary variant with local prompts, paths, and agent choices.

### Validate Workflows

In Aflow, enter:

```text
/specflow-validate
```

Aflow infers which workflow to validate from context. If the path or workflow id is missing, it asks the user. Validation checks YAML structure, variables, node/edge relationships, agent server references, and whether pause nodes use interactive agents.

### Run Workflows

In Aflow, enter:

```text
/specflow-run
```

Aflow runs workflows through the Specflow server. Before running, it validates the workflow. If the workflow has required variables, Aflow asks for those values one by one.

During execution, the TUI shows concise status for each node and prioritizes node titles so users can understand the current business step. When nodes complete, fail, skip, or wait for human interaction, Aflow updates the current interface.

### Pause Node Interaction

When a workflow reaches a `pauseAfterRun: true` node, Aflow switches the interface into the ACP interaction TUI for that node. The interface keeps the necessary workflow information and shows recent context messages so the user can see what the agent has done so far.

The user can continue chatting with that agent in the pause interface, or confirm that the workflow should continue. This is useful for human confirmation, business judgment, and inspecting intermediate artifacts.

### Resume Workflow Runs

In Aflow, enter:

```text
/specflow-resume
```

This resumes a workflow run that was cancelled, failed, or interrupted. Aflow reads the run state from the Specflow server, repairs running/cancelled state when needed, and continues from a recoverable point.

### Resume Node Agent Sessions

In Aflow, enter:

```text
/specflow-resume-session
```

This enters an agent session associated with a node from a workflow run. Aflow lists resumable sessions and shows the session id, agent, node title, and recommended operations.

Common choices include:

- Continue the session through ACP inside Aflow.
- Start the agent's native command in Aflow's terminal interface.
- Only show the recommended native resume command so the user can run it in another terminal.
- Skip session resume.

If a custom agent has no verified native resume command, Aflow does not pretend it can resume it natively. It shows the session information or tries the ACP path.

### Run-End Session Picker

After a workflow run finishes, if the run recorded agent sessions, Aflow lists those sessions in the TUI and lets the user choose whether to enter the code tool associated with a node. The list tries to show node title, session id, agent server, and agent type, so the user does not have to identify sessions from opaque ids alone.

Each session usually provides these options:

- `ACP Resume`: continue the session through ACP inside Aflow.
- `ACP Inspect`: inspect the session inside Aflow without necessarily sending a new task.
- `Native CLI in Aflow terminal`: start the agent's native command in the current Aflow terminal; when the native command exits, control returns to Aflow.
- `Show native resume command`: only show the recommended command, useful when the user wants to run it in another terminal.
- `Skip`: do not enter any session.

If Aflow has not verified an agent's native resume behavior, it still shows the recorded session id and node information, but it does not invent a command. Custom agent servers fall into this category by default. They can use ACP Resume/Inspect, or the user can restore them manually with their own agent command.

### Known Native Resume Commands

Aflow's native command recommendations come from a built-in adapter table. `{sessionId}` is replaced with the session id recorded by the run. If the agent's native command uses another native thread or checkpoint id, Aflow shows a caveat.

| Agent | Recommended command |
| --- | --- |
| Amp | `amp threads continue {sessionId}`; Amp uses thread ids, so ACP session ids may not equal native thread ids. |
| Auggie | `auggie --resume {sessionId}`; without a session id, try `auggie session resume`. |
| Autohand | `autohand resume {sessionId}`. |
| Claude | `claude --resume {sessionId}`; without a session id, `claude --resume` can open the native selector. |
| Cline | `cline --id {sessionId}`. |
| Codebuddy | `codebuddy --resume {sessionId}`. |
| Codex | `codex resume {sessionId}`; without a session id, try `codex resume`. |
| Cortex | `cortex --resume {sessionId}`. |
| Cursor Agent | `cursor-agent --resume {sessionId}`; Cursor thread ids may differ from ACP session ids. |
| DeepAgents | `dcode --resume {sessionId}`. |
| DimCode | `dim exec resume {sessionId}`; without a session id, try `dim exec resume --last`. |
| Factory Droid | `droid --resume {sessionId}`. |
| fast-agent | `fast-agent go --resume {sessionId}`; without a session id, try `fast-agent go --resume latest`. |
| Gemini CLI | `gemini --resume {sessionId}`; without a session id, try `gemini --resume`. |
| GitHub Copilot | `copilot --resume={sessionId}`; without a session id, try `copilot --resume`. |
| Goose | `goose session --resume {sessionId}`. |
| Grok | `grok --resume {sessionId}`. |
| Junie | `junie --session-id {sessionId}`; Junie also exposes `/history` in its native TUI. |
| Kilo | `kilo --continue {sessionId}`. |
| Kimi | `kimi --resume {sessionId}`. |
| Minion | `minion-code main --resume {sessionId}`. |
| Mistral Vibe | `vibe --resume {sessionId}`. |
| Nova | `nova start --continue {sessionId}`. |
| OpenCode | `opencode --session {sessionId}`; OpenCode also supports `--continue`, but prefer `--session` when a known native session id is available. |
| Poolside | `pool --resume {sessionId}`. |
| Qoder | `qodercli --resume {sessionId}`. |
| Qwen Code | `qwen --resume {sessionId}`. |
| Stakpak | `stakpak -c {sessionId}`; the id must be a checkpoint id. |
| VT Code | `vtcode --resume {sessionId}`. |

GLM and Pi are currently treated as ACP-only. Dirac is recorded as having native history selection rather than a direct resume command. Agoragentic and siGit are still marked as unknown for native restore.

### Workflow Tools

Aflow tools can read, create, copy, validate, run, and resume workflows. The model should only write workflows when doing so is necessary for the user's goal. If the user only asks for syntax, existing configuration, or an explanation, the agent should read and explain first instead of creating files without a reason.

## General Pi Capabilities

General terminal agent capabilities come from Pi. Pi documentation: <https://pi.dev/docs/latest>.

Aflow keeps most of the Pi coding-agent harness capabilities, so it is not only a workflow runner. It can also act as a general terminal coding agent.

### Files And Commands

Aflow can read project files, edit files, create files, run shell commands, and use the results for later reasoning. You can ask it to analyze code, fix issues, generate documentation, organize configuration, or explain project structure.

### Sessions

Aflow supports Pi's session model, including continuing existing sessions, forking sessions, viewing session information, compacting context, and restoring historical conversations. Common capabilities include:

- Resume or specify sessions through CLI options.
- Manage sessions through slash commands in the TUI.
- Compact older context in long conversations while keeping important progress.

### Skills, Extensions, And Themes

Aflow inherits Pi's skills, extensions, and themes mechanisms. Skills give the agent specialized capabilities that load on demand. Extensions can add tools, commands, event handling, and custom TUI. Themes customize the terminal interface.

Pi extension documentation: <https://pi.dev/docs/latest/extensions>.

### Models And Authentication

Aflow supports Pi's general provider, model, login, and settings paths. You can choose models and providers through environment variables, authentication commands, or settings.

Pi model and configuration documentation: <https://pi.dev/docs/latest/models>.

## A Typical Flow

```text
/specflow-create
```

First describe the goal to Aflow, for example: "I want a frontend ticket workflow that understands requirements, implements the change, reviews it, and updates docs."

```text
/specflow-validate
```

Confirm that the new YAML can be parsed and run by Specflow.

```text
/specflow-run
```

Run the workflow. Aflow asks for missing variables, shows node status, and lets you enter the corresponding agent at pause nodes.

```text
/specflow-resume-session
```

After the run finishes, choose a session if you want to continue inspecting or editing the output of a node agent.
