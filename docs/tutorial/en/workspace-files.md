---
title: Workspace Files
description: Learn how workflows, canvas files, agent servers, run records, logs, caches, and assets are stored in a Specflow workspace.
category: tutorial
order: 3
updatedAt: "2026-06-02 22:10:35 CEST"
tags:
  - workspace
  - config
  - agent-server
---

# Workspace Files

Specflow workspace files live under `.aflow/.specflow/`.

## Overview

```text
.aflow/.specflow/
  agentflows/
  agentflows-local/
  canvas/
  agent-servers.json
  agent-servers.local.json
  assets/
  runs/
  run-logs/
  cache/
```

## Workflow YAML

```text
.aflow/.specflow/agentflows/*.yaml
```

These files are workflow-as-code and are suitable for version control.

```text
.aflow/.specflow/agentflows-local/*.yaml
```

These files are local workflow drafts, suitable for Aflow fork/adapt output, personal experiments, and variants that should not be committed yet. During workspace initialization, Specflow adds `agentflows-local/` to `.aflow/.specflow/.gitignore`. The server treats YAML files in `agentflows-local/` as readable and runnable workflows, but local versions should not overwrite shared files in `agentflows/`.

## Canvas Layout

```text
.aflow/.specflow/canvas/*.json
```

These files store browser canvas positions. Handwritten workflow YAML does not need to maintain them.

During workspace initialization, Specflow adds `canvas/` to `.aflow/.specflow/.gitignore`.

## Agent Server Configuration

```text
.aflow/.specflow/agent-servers.json
```

This file stores shared team agent server configuration. The `session.agentServerId` field in workflow YAML references an agent server key in this file. It does not necessarily equal the registry id.

Specflow supports three agent server types:

- `registry`: an ACP agent selected and resolved from the ACP registry, suitable for registry agents such as Codex, Claude, and Gemini.
- `custom`: an ACP agent with a startup command you provide. It must implement ACP over stdio.
- `headless`: a command-style agent that does not use an ACP session, suitable for simple non-interactive batch workflows.

The configuration file supports `agent_servers` and remains compatible with the older `agentServers` shape. Prefer camelCase fields such as `registryId` and `argsTemplate`; reading also supports some snake_case fields such as `registry_id` and `args_template`.

### Registry ACP Agent

Registry agents provide metadata and distribution information through the ACP registry. Specflow saves, installs, and attempts to run agents returned by the registry. The currently supported distribution types include `binary`, `npx`, and `uvx`. The existence of an agent in the registry does not guarantee it can run on the current machine; distribution, authentication, protocol, and runtime errors may still be reported by that agent path.

When the CLI starts, it prepares the workspace and prewarms registry agents declared in `.aflow/.specflow/agent-servers.json`. For binary distributions, this downloads and unpacks into the agent cache on demand. For `npx` or `uvx`, Specflow resolves the command, while the actual package retrieval still happens through `npx` or `uvx` at runtime. After prewarm succeeds, Specflow records the resolved registry version in the local `agent-servers.local.json`.

```json
{
  "agent_servers": {
    "codex-acp": {
      "type": "registry",
      "registryId": "codex-acp"
    },
    "claude-acp": {
      "type": "registry",
      "registryId": "claude-acp"
    }
  }
}
```

Registry agents can also use common fields such as `cwd`, `env`, and `additionalDirectories`:

```json
{
  "agent_servers": {
    "codex-acp": {
      "type": "registry",
      "registryId": "codex-acp",
      "cwd": ".",
      "additionalDirectories": ["../shared-workspace"]
    }
  }
}
```

### Custom ACP Agent

Custom agents are for connecting your own ACP server. The agent must read and write ACP messages over stdio.

```json
{
  "agent_servers": {
    "my-acp-agent": {
      "type": "custom",
      "command": "node",
      "args": ["./agents/my-agent.js", "--acp"],
      "cwd": ".",
      "env": {
        "MY_AGENT_API_KEY": "..."
      },
      "additionalDirectories": ["../shared-workspace"]
    }
  }
}
```

Common custom agent fields:

- `command`: the startup command.
- `args`: command arguments.
- `cwd`: the agent process working directory.
- `env`: environment variables passed to the agent process.
- `additionalDirectories`: additional work directories the agent may access.

### Headless Agent

Headless agents are command-style agents that do not create ACP sessions. They are useful for simple automation or batch processing, but they do not support ACP sessions, terminal auth, permission prompts, or other interactive capabilities. Nodes that use headless agents also cannot rely on manual pause interactions that require ACP sessions.

```json
{
  "agent_servers": {
    "echo-headless": {
      "type": "headless",
      "command": "node",
      "argsTemplate": ["./agents/echo.js", "{{prompt}}"],
      "cwd": ".",
      "timeoutMs": 30000
    }
  }
}
```

Common headless agent fields:

- `command`: the startup command.
- `argsTemplate`: command argument template.
- `timeoutMs`: optional timeout.
- `cwd`, `env`, and `additionalDirectories`: common fields shared with other agent server types.

Agent server entries only store settings needed to start and resolve the process. Authentication, terminal capability, and permission prompts are driven by ACP at runtime. Mode, model, reasoning, and config overrides should be configured at the workflow or node level, not in the agent server configuration.

## Local Overrides

```text
.aflow/.specflow/agent-servers.local.json
```

This file stores local secrets and machine-specific settings. It is deep-merged by agent id with `.aflow/.specflow/agent-servers.json`; nested objects are also merged. A common pattern is to commit shared configuration in `agent-servers.json` and keep API keys, proxies, and personal paths in `agent-servers.local.json`.

Specflow may record `installedVersion` in local config when it prewarms or saves registry agents from the UI. This field is only an audit stamp left by local install/resolve work. It is mainly used for UI update hints and capability cache invalidation. It is not a version lock and does not control shared team installation. Do not write `installedVersion`, `installed_version`, or `version` into the shared `agent-servers.json`. If these fields appear in the shared file, Specflow prints a warning during startup prewarm downloads.

Shared configuration:

```json
{
  "agent_servers": {
    "codex-acp": {
      "type": "registry",
      "registryId": "codex-acp",
      "env": {
        "SPECFLOW_SHARED": "1"
      }
    }
  }
}
```

Local override:

```json
{
  "agent_servers": {
    "codex-acp": {
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

At runtime, `codex-acp.env` contains both `SPECFLOW_SHARED` and `OPENAI_API_KEY`.

Local secret example:

```json
{
  "agent_servers": {
    "codex-acp": {
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## VPN And Proxies

If a VPN or proxy prevents agent processes from reaching the network, add `http_proxy` and `https_proxy` to the corresponding agent server `env`.

This usually belongs in `.aflow/.specflow/agent-servers.local.json`:

```json
{
  "agent_servers": {
    "codex-acp": {
      "env": {
        "http_proxy": "http://127.0.0.1:7890",
        "https_proxy": "http://127.0.0.1:7890"
      }
    }
  }
}
```

If an agent needs both an API key and a proxy, keep them in the same `env`:

```json
{
  "agent_servers": {
    "codex-acp": {
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "http_proxy": "http://127.0.0.1:7890",
        "https_proxy": "http://127.0.0.1:7890"
      }
    }
  }
}
```

## Workflow Assets

```text
.aflow/.specflow/assets/<workflowId>/images/
.aflow/.specflow/assets/<workflowId>/resources/
```

These files come from images, directories, and resource files uploaded or associated with a workflow in the UI.

If the workflow YAML references these assets and the team or CI needs to reproduce the workflow, keep the related resources together with the workflow.

## Run Records

```text
.aflow/.specflow/runs/<runId>.json
```

These files store each run's summary, status, node outputs, agent invocations, agent sessions, workflow snapshot, canvas snapshot, and runtime variable values.

Older versions may contain:

```text
.aflow/.specflow/runs/<runId>.yaml
```

Specflow remains compatible with old YAML run records.

During workspace initialization, Specflow adds `runs/` to `.aflow/.specflow/.gitignore`.

## Run Logs

```text
.aflow/.specflow/run-logs/<runId>.jsonl
```

These files are append-only run event logs, with one JSON event per line. They store terminal output, node status, run status, agent lifecycle, interactions, and restore attempts.

The UI run log, event replay, and some restore diagnostics read from this directory.

## Cache

```text
.aflow/.specflow/cache/agents/
```

This directory stores agent server related caches, such as:

- `capabilities.json`: cached agent capability probe results.
- `registry.json`: fallback snapshot of the registry agent index; normally Specflow reads the latest registry from the CDN first.
- `archives/`: download and unpack cache for registry agent distributions.

You can also set `SPECFLOW_AGENT_CACHE_DIR` to put the agent cache somewhere else.

Cache files can be deleted. Specflow probes or downloads again when startup prewarm or a run needs them. When a registry agent's local `installedVersion` audit stamp changes, the old capability cache is treated as stale.
