# 005 Dynamic Run And Runtime Graph Patch

Date: 2026-06-15

## Status

Accepted.

## Context

Specflow runs keep a workflow snapshot on each run record. Paused and interrupted runs must be editable without changing the saved workflow YAML/canvas. Aflow Dynamic run builds on that: it runs one activation, pauses, lets Aflow inspect the completed node text, optionally patches only the current run snapshot, then continues the same run to the next checkpoint.

The previous runtime snapshot editing shape had two problems:

- Editing a live run could save a disk record while the executor still held an older in-memory run record.
- Runtime edits were modeled as whole-snapshot replacement, which made topology edits, checkpoint migration, UI edits, and Aflow edits hard to keep consistent.

## Decision

Runtime editing uses one structured graph patch contract:

```text
PATCH /api/runs/:id/graph
```

Both the browser UI and Aflow agent tools use this endpoint. The endpoint accepts `RunGraphOperation[]`, validates the operations against the current run checkpoint, applies them to the run snapshot, migrates runtime scheduling state when topology changes, validates the resulting workflow, and saves the updated run atomically.

Aflow exposes the same capability as:

```text
specflow_patch_run_graph
```

It does not accept a full YAML replacement. YAML/canvas remain the persisted workflow formats; runtime editing is operation-level.

## Dynamic Run Flow

```text
specflow_run_workflow
  -> collect required workflow variables
  -> in TUI: ask Normal run or Dynamic run
       Normal run is the default first option
  -> if Normal:
       run normally, including authored pauseAfterRun TUI interactions
  -> if Dynamic:
       start run with pauseAfterFirstActivation
       wait for first paused checkpoint
       return Dynamic checkpoint context

Dynamic checkpoint context
  -> completedNodeText
  -> editable/non-editable runtime classes
  -> runtime graph summary
  -> guidance to either continue or patch

if no clear issue:
  specflow_run_to_next_checkpoint(runId)

if clear future-workflow issue:
  specflow_patch_run_graph(runId, operations, summary)
  specflow_run_to_next_checkpoint(runId)
```

`specflow_run_to_next_checkpoint` is only for an existing Dynamic run. If the run is paused/interrupted, it plays once and arms pause-after-next-activation internally. If the run is already running, it waits for the next checkpoint without playing again. Aflow does not expose `pauseAfterNextActivation` as a model-facing choice.

`specflow_get_run_checkpoint` only refreshes checkpoint context when the current Dynamic checkpoint may be stale or incomplete. It is not required after every `specflow_run_to_next_checkpoint`, because the continuation tool returns checkpoint context itself. When the run is still running, it returns `checkpointReady: false` and does not provide patch decision material.

## Prompt Boundaries

Aflow appends its domain prompt to Pi instead of replacing Pi's base prompt. Pi remains responsible for the core harness prompt, visible tool snippets, tool guidelines, skills, and project context.

Dynamic decision rules are scoped to Dynamic checkpoint tool results. Normal run summaries do not instruct the agent to patch or call `specflow_run_to_next_checkpoint`.

Static Dynamic tool snippets stay short:

- `specflow_run_to_next_checkpoint`: advance an existing Dynamic run to its next checkpoint.
- `specflow_patch_run_graph`: patch the current Dynamic run snapshot with structured operations.
- `specflow_get_run_checkpoint`: refresh an existing paused/interrupted Dynamic checkpoint.

The detailed checkpoint decision rule is returned only with Dynamic checkpoint context.

## Run Control Terms

Workflow run control uses:

- `Pause` / `Play`: same run, planned pause after a safe point.
- `Interrupt` / `Play`: same run, cancel the current ACP turn and re-enter.
- `Stop` / `Continue`: terminal workflow stop, then a new continuation run.

`Resume` and `Inspect` are agent-session actions only.

Aflow workflow continuation is exposed as:

```text
/specflow-continue
specflow_continue_workflow
```

The server keeps compatibility for older HTTP paths where needed, but user-facing Aflow prompts and docs use Continue for workflow runs.

## Runtime Graph Operations

The current patch protocol supports:

```ts
type RunGraphOperation =
  | { op: "update_node"; nodeId: string; patch: Partial<AgentFlowNode> }
  | { op: "update_node_layout"; nodeId: string; position: Partial<CanvasNodeLayout> }
  | { op: "update_edge"; edgeId: string; patch: Partial<CanvasEdge> }
  | { op: "add_node"; node: AgentFlowNode; position?: Partial<CanvasNodeLayout> }
  | { op: "remove_node"; nodeId: string }
  | { op: "add_edge"; edge: CanvasEdge }
  | { op: "remove_edge"; edgeId: string }
  | { op: "replace_edge_endpoint"; edgeId: string; from?: string; to?: string }
  | { op: "add_session"; session: CanvasSession }
  | { op: "update_session"; sessionId: string; patch: Partial<CanvasSession> }
  | { op: "remove_session"; sessionId: string }
  | { op: "add_variable"; variable: CanvasVariable }
  | { op: "update_variable"; name: string; patch: Partial<CanvasVariable> }
  | { op: "remove_variable"; name: string }
  | {
      op: "insert_node_between";
      sourceNodeId: string;
      targetNodeId: string;
      node: AgentFlowNode;
      position?: Partial<CanvasNodeLayout>;
      incomingEdge?: Partial<CanvasEdge>;
      outgoingEdge?: Partial<CanvasEdge>;
    };
```

UI runtime editing builds these operations from canvas diffs. Aflow builds them directly.

## Editability Rules

Run graph patches are accepted only for paused or interrupted runs.

Editable classes:

- `current`
- `future`
- `history_future`

Rejected classes:

- `history_only`
- `inactive`

The current node id and kind are stable runtime anchors and cannot be changed. A paused current activation has already produced `completedNodeText`; editing that node does not change the already-produced output. If the current paused output is wrong, insert a future repair/review node or restructure reachable future flow.

An interrupted current activation is re-entered, so prompt/config edits to the current node can affect the retried activation.

## Checkpoint Migration

Topology-changing operations reset derived future scheduling state:

- Old future `queue` entries are discarded.
- Old future `pendingInputs` are discarded.
- `pendingCompletion` is preserved.
- Interrupted current activation input is preserved when present.
- Completed node outputs, gate decisions, branch traversal facts, and session history are not rewritten.

After Play, the executor uses the patched run snapshot and the migrated checkpoint to schedule future work through the new graph.

The response includes operation-level results and migration preview data:

```text
appliedOperations
rejectedOperations
migrationPreview
reachability
topologyCapabilities
snapshotRevision
```

Clients treat server response as authoritative. If an operation is rejected, revise the rejected operation rather than retrying the same patch unchanged.

## Live Run State

The server registers active run records by run id in `LiveRunRecordStore` while an executor is alive. Runtime graph patch loads the live record when present and falls back to disk when no live executor exists. This ensures executor reloads see the patched snapshot instead of an older disk-loaded copy.

Patch application is pure until validation succeeds: `RunGraphPatchService` returns a patched snapshot/checkpoint/migration preview without mutating the input run record. The API commits `agentflowSnapshot`, `canvasSnapshot`, migrated `checkpoint`, `nodeStates`, `snapshotRevision`, and edit metadata only after operation validation and workflow validation succeed.

## Consequences

- UI and Aflow share one runtime editing path.
- Dynamic run can restructure future workflow paths without changing saved workflows.
- Normal run does not carry Dynamic decision prompts.
- Workflow continuation terminology is separate from agent-session resume terminology.
- Future work should wrap active run records in a dedicated `LiveRunRecordController`, but the invariant is already fixed: runtime patch, executor reload, and run saving must read/write the same authoritative run record.
