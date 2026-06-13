---
title: Workflow YAML v2 Authoring Tutorial
description: Learn how to write Specflow agentflow v2 YAML with explicit starts, global variables, derived loops, and bounded gate branches.
category: tutorial
order: 1
updatedAt: "2026-06-13 06:27:21 CEST"
tags:
  - workflow
  - yaml
  - agentflow
---

# Workflow YAML v2 Authoring Tutorial

Committed workflow-as-code files live in `.aflow/.specflow/agentflow/agentflows/*.yaml`.
Local drafts, fork/adapt variants, and experiments should live in `.aflow/.specflow/agentflow/agentflows-local/*.yaml`; this directory is ignored by default.
Each YAML file describes a runnable workflow graph: sessions, global runtime variables, explicit start nodes, step nodes, gate nodes, end nodes, and edges.

The workflow file name becomes the workflow id. Use lowercase kebab-case, for example `code-review-flow.yaml`.
Session, node, and branch keys follow the same rule: they must start with a lowercase letter and may only contain lowercase letters, numbers, and `-`.

## Minimal Example

```yaml
version: 2
name: Code review flow

variables:
  specflow_task:
    title: Task
    description: The request, ticket, or business goal.
    required: true

sessions:
  builder:
    agentServerId: codex-acp
  reviewer:
    agentServerId: claude-acp

nodes:
  start:
    kind: start
    title: Start

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
        maxTraversals: 2

  done:
    kind: end
    title: Done

edges:
  - from: start
    to: plan
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
```

## Top-Level Fields

`version` must be `2` for newly authored workflows.

`name` is the workflow name shown in Specflow.

`variables` is a top-level map of runtime values. Steps and gates can reference variables directly with XML-like tokens such as `<specflow_task>`.

`sessions` defines logical agent contexts. Steps that reference the same session share conversation context.
Each session should define `agentServerId`, which points to an agent server entry in `.aflow/.specflow/agent-servers.json`.

`nodes` defines workflow graph nodes. v2 YAML supports `start`, `step`, `gate`, and `end` nodes.

`edges` defines directed connections between nodes. Edge ids are generated from `from`, `branch`, and `to`; you do not need to write them by hand.

## Variables

Declare run-time values under top-level `variables`.
Variable names must match `specflow_[A-Za-z0-9_]+`.

```yaml
variables:
  specflow_task:
    title: Task
    description: The request, ticket, or business goal.
    required: true
    defaultValue: Fix the failing login test.
```

Prompts and gate criteria can reference variables with tokens:

```yaml
prompt: |
  Implement this request:
  <specflow_task>
```

If `required: true` and no `defaultValue` exists, Aflow and Specflow run configuration ask for a value before the workflow runs.

Do not create `kind: input` nodes in v2. Input nodes are v1 compatibility only.

## Start Nodes

Use `kind: start` to declare explicit entry points.

```yaml
nodes:
  start:
    kind: start
    title: Start

edges:
  - from: start
    to: plan
```

Start nodes are control-only markers. They do not run an agent and do not pass content.

Multiple start nodes are allowed for parallel starts, but their target steps must not share the same session. This avoids starting two independent prompts in one conversation at the same time.

Start edges must target step nodes. Edges must not target start nodes.

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
- `pauseAfterRun: true` pauses after the node runs, which lets a human inspect and then Play the same run. The current `specflow run` CLI does not support interactive Pause/Play; use the UI/server or Aflow run path for workflows that need manual run control.
- `paths` associates files or directories.
- `images` associates image resources. Each item includes `path` and optional `label` and `mimeType`.
- `modeId` sets the ACP session mode before this node prompt runs.
- `configOptions` passes ACP configuration overrides supported by the agent. Values must be strings or booleans.

## Gate Nodes

Use `kind: gate` when a workflow must choose a branch from upstream context.

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
        maxTraversals: 2
```

Every gate must define at least one branch.
Every edge that starts from a gate must specify `branch`.
Gate nodes may define `configOptions`, but they cannot define `modeId`.

Put retry limits on gate branches with `maxTraversals`. In v2, `maxTraversals` belongs to the branch, not the edge.

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
Do not add transmission fields to edges that start from start nodes, point to gates, or point to end nodes.

Do not write `loopback` or edge-level `maxTraversals` in v2 YAML.

## Loops

v2 loops are intentional graph cycles. Authors express them with normal edges plus bounded gate branches; Specflow derives the loop-closing edge for validation, execution, and UI highlighting.

```yaml
nodes:
  verdict:
    kind: gate
    title: Review verdict
    decisionCriteria: Choose pass or rework.
    branches:
      pass:
      rework:
        label: needs rework
        maxTraversals: 2

edges:
  - from: verdict
    branch: rework
    to: implement
```

Loop validation expects each cyclic strongly connected component to include a gate and have a single entry point. Gate branches that stay inside the loop must define `maxTraversals`.

The UI highlights derived loop-closing edges with a distinct loop color. You do not need to run a separate loop-detect command or add `loopback` by hand.

## Validation Checklist

Before running a workflow, check these rules:

- The file name without `.yaml` matches `[a-z][a-z0-9-]*`.
- `version` is `2`.
- The file includes `sessions`, `nodes`, and `edges`.
- The file has at least one `start` node.
- Start edges target step nodes.
- Multiple start nodes do not target steps in the same session.
- `variables` names start with `specflow_`.
- No node uses `kind: input`.
- Every session has an `agentServerId` before running.
- Every `step.session` references an existing session.
- Every `gate` defines branches, and every edge from a gate selects a branch.
- Edges do not target `start` nodes and do not start from `end` nodes.
- `transmit: true` is accompanied by `outputTag`.
- Edges do not define `loopback` or `maxTraversals`.
- Loop-control gate branches define positive `maxTraversals`.

Validate a workflow:

```sh
specflow validate .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`validate` only parses YAML and validates the workflow graph. It does not start agents.

For more Specflow command details, see [Specflow Commands](specflow-command.md).
