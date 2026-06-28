---
title: Codex Plugin
description: Install and use the Specflow Codex plugin.
order: 40
updatedAt: 2026-06-28
---

# Codex Plugin

The Specflow Codex plugin lets Codex use Specflow workflows through MCP. It
does not bundle `specflow` or `aflow`; install the release binaries first.

## Prerequisites

```sh
specflow --version
aflow --version
```

Open the target repository in Codex. The repository should contain, or be ready
to create, `.aflow/.specflow/`.

## MCP Server

The plugin starts:

```sh
specflow mcp
```

That MCP process locates or starts a persistent workspace Specflow server. Runs
live in the server, not in the MCP process, so a long run can be inspected later
by `runId` as long as the Specflow server stays alive.

Optional manual server startup:

```sh
specflow serve
```

## Codex CLI Installation

For local development from this repository:

```sh
codex plugin marketplace add .
codex
/plugins
```

Install and enable `specflow-codex`.

For the published marketplace branch:

```sh
codex plugin marketplace add DuGuYifei/Aflow --ref specflow-plugin
codex
/plugins
```

Install and enable `specflow-codex`.

## Codex App Installation

Use **Add plugin marketplace**:

- Source: `github.com/DuGuYifei/Aflow`
- Git ref: `specflow-plugin`
- Sparse paths: leave empty

Install `specflow-codex`, start a new local repository thread, and ask Codex to
use the Specflow plugin. If the current Codex App version cannot start the
plugin-provided local MCP server, use Codex CLI or IDE until App MCP startup is
verified.

## Common Prompts

```text
Use the Specflow plugin. List workflows in this repository.
```

```text
Use the Specflow plugin. Prepare and run workflow <id> in dynamic mode.
```

```text
Use the Specflow plugin. Fork workflow <id> to a local draft, adapt it, validate it, and explain what changed.
```

```text
Use the Specflow plugin. List the agent registry and install <registry-id>.
```

```text
Use the Specflow plugin. Show native resume commands for run <run-id>.
```

## Agent Servers

Codex can list configured agent servers, inspect the Specflow registry, and
install or update registry-backed ACP agents when you explicitly ask it to do
so. Registry installs use Specflow registry metadata and the normal server
install path.

Codex does not configure custom or headless agent server JSON. For agents that
are not in the registry, install the agent yourself and add it in the Specflow
UI, then ask Codex to use the configured `agentServerId`.

Agent authentication is also handled in the Specflow UI. If Codex reports that
auth is required, authenticate in the UI and retry the MCP tool.

## Dynamic Runs and pauseAfterRun

Dynamic review pauses after activations. Codex can inspect checkpoint output,
patch only the current run snapshot, then continue to the next checkpoint.

If a run reaches a `pauseAfterRun` ACP node, Codex should:

1. list paused nodes;
2. prompt the paused ACP node if needed;
3. continue the paused node;
4. in dynamic mode, continue the paused node with `play: false`, then run to
   the next checkpoint.

Do not use `specflow run` for these workflows. That command is the standalone
CLI runner and intentionally does not provide Aflow Agent dynamic/pause parity.
