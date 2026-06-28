---
title: Specflow Commands
description: Learn what specflow, specflow validate, and specflow run do, and how to pass workflow variables.
category: tutorial
order: 2
updatedAt: "2026-06-15 00:00:00 CEST"
tags:
  - cli
  - command
  - workflow
---

# Specflow Commands

## Start The UI

```sh
specflow
```

With no arguments, Specflow starts the server and prints the browser UI URL.

## Validate A Workflow

```sh
specflow validate .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`validate` parses the YAML and checks whether the workflow is runnable. It does not start any agent.

It checks structural rules for sessions, variables, nodes, edges, gates, loops, and `agentServerId` fields. Workflow YAML must use `version: 2`, explicit start nodes, top-level variables, derived loop-closing edges, and branch-level `maxTraversals`. Validation also reads the workspace agent server configuration. If a `pauseAfterRun: true` node uses a headless agent, validation fails because headless agents do not provide interactive sessions.

If the workflow has required variables, `validate` still does not need `-D` values. Variable values belong to a specific run, not to the workflow structure.

## Run A Workflow

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`run` validates the workflow, checks required variable values and agent authentication status, then executes the workflow.

The current `specflow run` path is a direct CLI path. It does not start the localhost server or open the browser UI. During execution it only prints concise node progress in the terminal; the UI run list, run log, SSE replay, and pause interaction are not connected to this CLI run.

When the workflow completes successfully, the CLI exits. When it fails or is stopped, the CLI also exits and returns a non-zero exit code.

If the workflow contains a `pauseAfterRun: true` node, the current CLI run path does not support interactive Pause/Play. It rejects the workflow before starting the agent. Use the UI/server or Aflow run path when a workflow needs manual Pause, Interrupt, Play, Stop, or Continue control. See [Specflow Glossary](glossary.md) for the fixed run-control terms.

## Pass Workflow Variable Values

If a v2 workflow has a required variable:

```yaml
version: 2
variables:
  specflow_task:
    title: Task
    required: true
```

Pass values with `-D`:

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dtask="Fix the failing login test"
```

The CLI recommends the short name without the `specflow_` prefix, such as `-Dtask=...`. Specflow maps it to the internal variable `specflow_task`.

The full variable name is also supported:

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dspecflow_task="Fix the failing login test"
```

For multiple variables, pass multiple `-D` values:

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dtask="Fix login" -Daudience="frontend team"
```

If the workflow has no required variables, no input arguments are required:

```sh
specflow run .aflow/.specflow/agentflow/agentflows/nightly-review.yaml
```

## Skip Confirmation

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dtask="Fix login" --yes
```

`--yes` or `-y` skips the pre-run confirmation.

## View Version

```sh
specflow --version
specflow -v
specflow version
```

All three commands print the current Specflow version.
