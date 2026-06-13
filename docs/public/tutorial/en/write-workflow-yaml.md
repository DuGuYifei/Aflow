---
title: "Deprecated: Workflow YAML v1 Authoring Tutorial"
description: Legacy v1 reference for Specflow agentflow YAML. New workflows should use version 2.
category: tutorial
order: 99
updatedAt: "2026-06-13 06:27:21 CEST"
tags:
  - workflow
  - yaml
  - agentflow
---

# Deprecated: Workflow YAML v1 Authoring Tutorial

This page documents the legacy `version: 1` workflow format. New workflows should use [Workflow YAML v2 Authoring Tutorial](write-workflow-yaml-v2.md). v1 remains readable for compatibility, and the Specflow UI will suggest migrating v1 workflows with Aflow Agent.

Committed workflow-as-code files live in `.aflow/.specflow/agentflow/agentflows/*.yaml`.
Local experiments and fork/adapt drafts should live in `.aflow/.specflow/agentflow/agentflows-local/*.yaml`; this directory is added to `.aflow/.specflow/.gitignore` by default and is not committed.
Each YAML file describes a runnable workflow graph, including sessions, nodes, edges, and optional runtime inputs.
Browser canvas coordinates are stored separately in `.aflow/.specflow/agentflow/canvas/*.json`, so handwritten YAML does not need to manage node positions.

The workflow file name becomes the workflow id. Use lowercase kebab-case, for example `code-review-flow.yaml`.
Session, node, and branch keys follow the same rule: they must start with a lowercase letter and may only contain lowercase letters, numbers, and `-`.

When adapting an existing workflow for a specific user or problem, copy the source YAML to `.aflow/.specflow/agentflow/agentflows-local/<new-workflow-id>.yaml` first, then edit the copy. Do not overwrite the source workflow unless you are explicitly maintaining the shared team version.

## Minimal Example

```yaml
version: 1
name: Code review flow

sessions:
  builder:
    agentServerId: codex-acp
  reviewer:
    agentServerId: claude-acp

nodes:
  plan:
    kind: step
    title: Plan the change
    session: builder
    prompt: |
      Read <specflow_task>.
      Produce a short implementation plan with files, risks, and checks.

  implement:
    kind: step
    title: Implement
    session: builder
    prompt: |
      Implement the approved plan.
      Keep the change focused and report the commands you ran.
    paths:
      - src/
      - tests/

  review:
    kind: step
    title: Review
    session: reviewer
    prompt: |
      Review <specflow_change_summary>.
      Focus on bugs, regressions, and missing tests.

  verdict:
    kind: gate
    title: Review verdict
    decisionCriteria: |
      Choose pass only if the change is ready.
      Choose rework if the implementation needs another edit pass.
    branches:
      pass:
      rework:
        label: needs rework
        description: Send the workflow back to implementation.

  done:
    kind: end
    title: Done

edges:
  - from: plan
    to: implement
  - from: implement
    to: review
    transmit: true
    outputTag: change_summary
    handoffPrompt: Summarize the implementation diff and verification results for review.
  - from: review
    to: verdict
  - from: verdict
    branch: pass
    to: done
  - from: verdict
    branch: rework
    to: implement
    loopback: true
    maxTraversals: 2
```

## Top-Level Fields

`version` must be `1`.

`name` is the workflow name shown in Specflow.

`sessions` defines logical sessions. Steps that reference the same session share context.
Each session should define `agentServerId`, which points to an agent server entry in `.aflow/.specflow/agent-servers.json`.
If an agent needs MCP configuration, set `mcpServers` to a JSON string containing an array of MCP server objects.

`nodes` defines workflow graph nodes. YAML supports four node kinds: `input`, `step`, `gate`, and `end`.
Only `step` and `gate` become runtime nodes. `input` provides variables, and `end` marks a process ending on the canvas.

`edges` defines directed connections between nodes. Edge ids are generated from `from`, `branch`, and `to`; you do not need to write them by hand.

`variables` is an optional variable record list. Runtime prompt replacement is primarily driven by `input` nodes. If a value must be passed at run time, prefer an `input` node.

## Step Nodes

Use `kind: step` for one unit of agent work.

```yaml
nodes:
  write-spec:
    kind: step
    alias: "01"
    title: Write spec
    session: writer
    prompt: |
      Convert <specflow_task> into a concise implementation spec.
    pauseAfterRun: true
    paths:
      - docs/
    images:
      - path: .aflow/.specflow/agentflow/assets/wireframe.png
        label: wireframe.png
        mimeType: image/png
    modeId: plan
    configOptions:
      model: preferred-model
      thought_level: high
```

Common fields:

- `session` must reference an existing session key.
- `prompt` is the instruction sent to the agent.
- `pauseAfterRun: true` pauses after the node runs, which lets a human inspect and then Play the same run. The current `specflow run` CLI does not support interactive Pause/Play; workflows with pause nodes are rejected before the agent starts. Use the UI/server path when manual run control is required.
- `paths` associates files or directories.
- `images` associates image resources. Each item includes `path` and optional `label` and `mimeType`.
- `modeId` sets the ACP session mode before this node prompt runs.
- `configOptions` passes ACP configuration overrides supported by the agent. Values must be strings or booleans.

## Gate Nodes

Use `kind: gate` when a workflow must choose a branch based on upstream output.

```yaml
nodes:
  quality-check:
    kind: gate
    title: Quality check
    decisionCriteria: |
      Choose pass when the answer is complete and verified.
      Choose revise when important issues remain.
    branches:
      pass:
      revise:
        label: revise
        description: Return to the previous work step.
```

Before a workflow can run, every gate must define at least one branch.
Every edge that starts from a gate must specify `branch`.
Gate nodes may define `configOptions`, but they cannot define `modeId`.

## Input Nodes

Use `kind: input` when a workflow must receive values from a run command or the UI.
The input `variableName` must match `specflow_[A-Za-z0-9_]+`.

```yaml
nodes:
  task-input:
    kind: input
    title: Task
    variableName: specflow_task
    description: The user request or ticket text.
    required: true
```

Prompts and gate criteria can reference input values with XML-like tokens:

```yaml
prompt: |
  Implement this request:
  <specflow_task>
```

When running through the CLI, pass values with `-D`:

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dtask="Fix the failing login test"
```

## Edges And Context Transmission

Normal edges only control execution order:

```yaml
edges:
  - from: plan
    to: implement
```

When two steps use different sessions and the downstream prompt needs upstream output, enable transmission:

```yaml
edges:
  - from: implement
    to: review
    transmit: true
    outputTag: change_summary
    handoffPrompt: Summarize the implementation diff and test results.
```

The transmitted content becomes available to the target prompt as `<specflow_change_summary>`.
`outputTag` must be an XML-safe tag name. `handoffPrompt` is optional.

Do not add transmission fields to edges within the same session, because the next step already has the same conversation context.
Do not add transmission fields to edges that point to gates, start from inputs, or point to end nodes.

## Loops

Loops must be explicitly marked as loopbacks and must be controlled by a gate branch.

```yaml
edges:
  - from: verdict
    branch: rework
    to: implement
    loopback: true
    maxTraversals: 2
```

`maxTraversals` is only allowed on edges that start from a gate, and it must be a positive integer.
It is useful for limiting retry paths such as review-to-rework loops.

## Validation Checklist

Before running a workflow, check these rules:

- The file name without `.yaml` matches `[a-z][a-z0-9-]*`.
- `version` is `1`.
- The file includes `sessions`, `nodes`, and `edges`.
- Every session has an `agentServerId` before running.
- Every `step.session` references an existing session.
- Every `gate` defines branches, and every edge from a gate selects a branch.
- Edges do not point to `input` nodes and do not start from `end` nodes.
- The graph formed by non-loopback edges has no cycles.
- `transmit: true` is accompanied by `outputTag`.
- `input.variableName` starts with `specflow_` and is unique within the workflow.

Validate a workflow:

```sh
specflow validate .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`validate` only parses YAML and validates the workflow graph. It does not start agents.

For more Specflow command details, see [Specflow Commands](specflow-command.md).
