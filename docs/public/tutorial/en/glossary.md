---
title: Specflow Glossary
description: Fixed terms for workflow execution, run control, snapshots, and loop traversal.
category: tutorial
order: 6
updatedAt: "2026-06-13 06:27:21 CEST"
tags:
  - glossary
  - workflow
  - run-control
---

# Specflow Glossary

## Run Control

- `Pause`: request a planned pause. The current node or checkpoint completes first, then the same run stops at a scheduler-safe point.
- `Interrupt`: abort the current agent turn immediately and keep the same run resumable.
- `Play`: continue the same paused or interrupted run.
- `Stop`: terminate the workflow run. This is a terminal workflow-run state.
- `Continue`: create a new continuation run from a stopped or error run.
- `Resume`: agent session only. Use it for ACP session restoration or conversation continuation, not workflow-run continuation.

## Execution

- `Activation`: one scheduled node execution.
- `Traversal`: the count of repeated activations through a loop or bounded gate branch.
- `Run Snapshot`: the editable workflow copy stored on a run. Paused and interrupted runs edit this snapshot, not the original workflow YAML.
- `History Only`: a node or edge that has already contributed to this run and is not expected to affect remaining execution.
- `History + Future`: a completed node that can still run again, usually because a loop can reach it.
- `Loop-Closing Edge`: a derived runtime/UI marker for the edge that closes a cycle. It is highlighted in the canvas but is not an authored v2 `loopback` property.

