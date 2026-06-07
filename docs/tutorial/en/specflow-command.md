---
title: Specflow Commands
description: Learn what specflow, specflow validate, and specflow run do, and how to pass workflow inputs.
category: tutorial
order: 2
updatedAt: "2026-06-02 22:10:35 CEST"
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

With no arguments, Specflow starts the server and opens the browser UI.

## Validate A Workflow

```sh
specflow validate .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`validate` parses the YAML and checks whether the workflow is runnable. It does not start any agent.

It checks structural rules for sessions, nodes, edges, gates, loopbacks, input variable names, and `agentServerId` fields. It also reads the workspace agent server configuration. If a `pauseAfterRun: true` node uses a headless agent, validation fails because headless agents do not provide interactive sessions.

If the workflow has required input nodes, `validate` still does not need `-D` values. Input values belong to a specific run, not to the workflow structure.

## Run A Workflow

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`run` validates the workflow, checks required input values and agent authentication status, then executes the workflow.

The current `specflow run` path is a direct CLI path. It does not start the localhost server or open the browser UI. During execution it only prints concise node progress in the terminal; the UI run list, run log, SSE replay, and pause interaction are not connected to this CLI run.

When the workflow completes successfully, the CLI exits. When it fails or is cancelled, the CLI also exits and returns a non-zero exit code.

If the workflow contains a `pauseAfterRun: true` node, the current CLI run path does not support interactive pause. It rejects the workflow before starting the agent. Use the UI/server path when a workflow needs manual pause and continue.

## Pass Input Node Values

If a workflow has an input node:

```yaml
nodes:
  task-input:
    kind: input
    title: Task
    variableName: specflow_task
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

For multiple input nodes, pass multiple `-D` values:

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dtask="Fix login" -Daudience="frontend team"
```

If the workflow has no input nodes, no input arguments are required:

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
