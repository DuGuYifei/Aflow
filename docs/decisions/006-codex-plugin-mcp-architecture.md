# 006 Codex Plugin MCP Architecture

Date: 2026-06-26

## Status

Accepted.

## Context

Aflow already provides a native interactive agent surface for Specflow workflows.
It uses local/in-process workflow parsing and validation, HTTP run control,
SSE event side channels, dynamic checkpoint tools, runtime graph patching,
`pauseAfterRun` ACP panels, session restore, and agent auth helpers.

Codex needs similar business capability through an installable plugin, but the
plugin must not depend on a source checkout or import `@specflow/server`.

## Decision

Codex uses an installable plugin that bundles:

- a Specflow skill;
- MCP server configuration that launches `specflow mcp`.

`specflow mcp` is a stdio MCP server inside the `specflow` binary. It uses HTTP
to connect to a persistent workspace Specflow server. If no matching server is
running, it starts `specflow serve` as a persistent workspace process.

The server is the business capability boundary. It exposes additive APIs for
workflow source read/write/fork, validation, prepare-run, run control,
dynamic checkpoints, runtime graph patching, paused ACP nodes, interactions,
sessions, auth, and capabilities.

Aflow remains native and is not forced through MCP.

## Runtime Semantics

Codex tool calls and the MCP process are control plane only. Workflow execution
state lives in the persistent Specflow server.

- If a Codex tool call returns or times out, the run can continue on the server.
- If Codex or the MCP process exits while the server survives, the run can be
  inspected later by `runId`.
- If the Specflow server process exits or is killed, the executor does not keep
  running. On restart, existing reconciliation marks interrupted running runs
  as stopped and session restore may still be available.

`pauseAfterRun` is modeled as server-owned ACP paused-node state, not MCP
elicitation. Codex relays prompts and continue actions through MCP tools.

In dynamic mode, paused-node interaction comes first:

1. prompt the paused ACP node as needed;
2. continue the paused node with `play: false`;
3. call the dynamic run-to-next-checkpoint tool.

## Consequences

- Aflow, Specflow CLI, Specflow UI, and Specflow Design keep their existing user
  behavior.
- Codex gets Aflow Agent parity through MCP without duplicating server logic.
- Plugin distribution only needs marketplace and plugin files on the
  `specflow-plugin` branch; binaries remain normal release artifacts. Codex and
  Claude Code can share that branch while keeping separate plugin directories.
- App support must be smoke-tested because CLI/IDE and App plugin startup can
  differ by Codex release.
