# Specflow Workflow YAML Authoring Guide

This is the plugin copy of Aflow's embedded workflow YAML authoring guide. Read it when creating, heavily adapting, rewriting, or schema-debugging workflow YAML. For simple list/read/run tasks, prefer SKILL.md and MCP tool descriptions.

Specflow workflow YAML authoring tutorial:

Purpose:
- A Specflow workflow YAML file describes a runnable agent workflow graph.
- It should be concrete enough to run: sessions identify agent servers, variables declare runtime values, start nodes declare entry points, step nodes contain agent prompts, gate nodes choose branches, and edges connect the graph.
- Do not rely on external docs while authoring. This embedded guide is the source of truth available to Aflow in packaged binaries.

Storage and ids:
- Shared/team workflows live in .aflow/.specflow/agentflow/agentflows/<workflow-id>.yaml and are suitable for git.
- Local drafts and fork/adapt outputs live in .aflow/.specflow/agentflow/agentflows-local/<workflow-id>.yaml and are gitignored.
- Canvas layout lives in .aflow/.specflow/agentflow/canvas/<workflow-id>.json. Do not hand-author layout for YAML-only work.
- The YAML filename without .yaml is the workflow id.
- workflow id, session keys, node keys, and branch keys must match [a-z][a-z0-9-]*.
- Use readable kebab-case ids such as code-review-flow, implement, review, verdict, needs-rework.
- variable names must match specflow_[A-Za-z0-9_]+ and must be unique.

Fork/adapt rule:
- When adapting an existing workflow for a new user, case, repository, or business problem, copy the source YAML to .aflow/.specflow/agentflow/agentflows-local/<new-workflow-id>.yaml first.
- Modify the local copy. Do not mutate the source workflow in place unless the user explicitly asks to maintain that shared workflow.

Minimal complete workflow example:

version: 2
name: Code review flow

variables:
  specflow_task:
    title: Task
    description: The user request or ticket text.
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

Top-level fields:
- version must be 2 for newly authored workflows.
- name is the display name shown by Specflow.
- sessions defines logical agent contexts. Step nodes that reference the same session share the same conversation context.
- variables defines global runtime values that any step or gate can reference with XML-like tokens such as <specflow_task>.
- nodes defines start, step, gate, and end nodes.
- edges defines directed graph connections. Edge ids are generated from from, branch, and to; do not hand-write edge ids.

Sessions syntax:
- Each session key maps to an object with agentServerId.
- agentServerId points to an entry in .aflow/.specflow/agent-servers.json.
- Optional fields may include agent and mcpServers.
- mcpServers must be a JSON string containing an array of MCP server objects, not a YAML object.

Example sessions:

sessions:
  writer:
    agentServerId: codex-acp
  reviewer:
    agentServerId: claude-acp
    mcpServers: '[{"name":"docs","command":"node","args":["server.js"]}]'

Session design and review independence:
- Do not add review nodes by default.
- Add a review node only when the workflow genuinely needs independent verification, approval, QA, critique, or a pass/rework decision.
- When a node's primary responsibility is review, verification, critique, approval, or deciding whether prior work passes, it should normally use a separate reviewer session from the session that produced the work.
- Do not convert ordinary planning, implementation, research, summarization, or handoff steps into review nodes just to create a reviewer session.
- If independent review is useful but the workflow shape is ambiguous, ask_user before adding a review node.
- When a review step uses a different session, pass only the necessary upstream output through a transmit/outputTag edge, and make the review prompt reference that token explicitly.

Variable syntax:
- variables is a top-level map from variable name to metadata.
- Variable names must match specflow_[A-Za-z0-9_]+.
- title, description, required, and defaultValue are optional.
- Prompts and gate criteria can reference variables with XML-like tokens such as <specflow_task>, <specflow_customer>, and <specflow_target_repo>.
- If required is true and no defaultValue exists, Aflow should ask the user for the value during /specflow-run.
- Do not create input nodes in v2 workflows.

Example variables:

variables:
  specflow_task:
    title: Task
    description: The request, ticket, or business goal.
    required: true

Start node syntax:
- kind must be start.
- Start nodes are explicit workflow entry points and are not runtime agent nodes.
- A start node must connect to a step node.
- Multiple start nodes are allowed for parallel starts, but their target steps must not be in the same session.
- Edges must not target start nodes.

Example start:

nodes:
  start:
    kind: start
    title: Start

Step node syntax:
- kind must be step.
- session and prompt are required.
- session must reference an existing session key.
- prompt is the instruction sent to the agent.
- alias, title, pauseAfterRun, paths, images, modeId, and configOptions are optional.
- paths attaches relevant files or directories.
- images attaches image resources. Each image needs path and may include label and mimeType.
- modeId sets ACP session mode before the node prompt runs.
- configOptions passes ACP configuration overrides. Values must be strings or booleans.
- pauseAfterRun: true pauses after the node finishes so a human can inspect or continue.
- Headless agents cannot be used with pauseAfterRun.
- The standalone shell command specflow run rejects workflows with pauseAfterRun. Inside Aflow, use /specflow-run or the specflow_run_workflow tool, which goes through the server API and Aflow TUI pause interaction.

Example step:

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
      network: true

Gate node syntax:
- kind must be gate.
- decisionCriteria is required.
- branches must contain at least one branch.
- branches is a map from branch id to optional label, description, and maxTraversals.
- Every edge leaving a gate must specify branch.
- Gate nodes choose a branch from upstream context; they should not be written as implementation prompts.
- Gate nodes may define configOptions, but must not define modeId.
- Use branch maxTraversals for bounded retry paths and loop-control branches.

Example gate:

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

End node syntax:
- kind must be end.
- End nodes mark terminal points for readability and canvas display.
- End nodes are not runtime agent nodes.
- Edges must not leave end nodes.

Edges and context transfer:
- A normal edge only controls execution order.
- A step node may have multiple outgoing normal edges; this is queued fan-out, so every target will run. Use it only when all branches should execute.
- If only one path should execute based on conditions, add a gate node and put one outgoing edge on each gate branch.
- Fan-out branches may intentionally reuse the same session, but review whether the queued order and shared conversation context are correct before doing so.
- Edges cannot target start nodes.
- Edges cannot leave end nodes.
- Edges from start nodes should only target step nodes and should not declare transmit, outputTag, or handoffPrompt.
- Edges into gate nodes should not declare transmit, outputTag, or handoffPrompt.
- Edges into end nodes should not declare transmit, outputTag, or handoffPrompt.
- Same-session step-to-step edges should not declare transmit, outputTag, or handoffPrompt because context is already shared.
- Use transmit: true only when a downstream step in a different session needs upstream output.
- transmit requires outputTag.
- The downstream prompt receives transmitted content as <specflow_outputTag>. For outputTag: change_summary, use <specflow_change_summary>.
- handoffPrompt is optional and asks the source session to summarize or transform output for transfer.
- Do not write loopback on edges in v2.
- Do not write maxTraversals on edges in v2. Put traversal limits on gate branches.

Normal edge example:

edges:
  - from: plan
    to: implement

Cross-session transfer example:

edges:
  - from: implement
    to: review
    transmit: true
    outputTag: change_summary
    handoffPrompt: Summarize the implementation diff and test results.

Loop syntax:
- v2 allows intentional loops without authored loopback flags.
- Loops should normally be controlled by a gate branch.
- A cyclic strongly connected component must include a gate and have a single entry point.
- Put a positive maxTraversals on loop-control gate branches to bound retry paths such as review to rework.
- Specflow derives the loop-closing edge at validation/runtime for UI highlighting.

Loop example:

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

Authoring checklist before writing YAML:
- Choose a kebab-case workflow id and filename.
- Decide whether the workflow is shared or local. Use agentflows-local for fork/adapt drafts.
- Define sessions first, one per logical agent context.
- Add top-level variables for every run-time value the user must provide.
- Add explicit start nodes and connect them to first steps.
- Write step prompts that reference workflow variable tokens and transmitted output tokens explicitly.
- Add gates only for meaningful branch decisions.
- Add an end node for readable completion.
- Add edges in execution order.
- Use transmit/outputTag only for cross-session step output that downstream prompts need.
- Put retry limits on gate branches, not edges.
- Use pauseAfterRun only when human interaction is genuinely needed.

Validation checklist:
- version is 2.
- filename/workflow id matches [a-z][a-z0-9-]*.
- sessions, nodes, and edges are present.
- at least one start node exists.
- start edges target step nodes.
- multiple start targets do not use the same session.
- every runnable session has agentServerId.
- every step.session references an existing session.
- every gate has branches.
- every gate outgoing edge specifies branch.
- edge does not target a start node.
- edge does not leave an end node.
- intentional loops have a gate, a single entry point, and bounded loop-control branches.
- transmit implies outputTag.
- variable names start with specflow_ and are unique.
- no node uses kind: input.
- no edge uses loopback or maxTraversals.
- pauseAfterRun is not used with headless agents.
