---
title: Workspace 文件
description: 了解 Specflow workspace 中 workflow、canvas、agent server、运行记录、日志、缓存和资源文件的作用。
category: tutorial
order: 3
tags:
  - workspace
  - config
  - agent-server
---

# Workspace 文件

Specflow 的 workspace 文件保存在 `.aflow/.specflow/` 下。

## 总览

```text
.aflow/.specflow/
  agentflows/
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

这些文件是 workflow-as-code，适合提交到版本控制中。

## Canvas 布局

```text
.aflow/.specflow/canvas/*.json
```

这些文件保存浏览器画布位置。手写 workflow YAML 时不需要维护它们。

初始化 workspace 时，Specflow 会把 `canvas/` 加入 `.aflow/.specflow/.gitignore`。

## Agent server 配置

```text
.aflow/.specflow/agent-servers.json
```

这个文件保存团队共享的 agent server 配置，例如 agent 类型、启动命令、参数和工作目录。

自定义 ACP agent 示例：

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

Agent server 条目只保存进程启动需要的设置，例如 `type`、`command`、`args`、`cwd`、`env` 和 `additionalDirectories`。

自定义 ACP agent 需要通过 stdio 实现 ACP。认证、terminal capability 和 permission prompt 由 ACP 在运行时驱动。Mode、model、reasoning 和 config override 应该配置在 workflow 或节点级别，而不是 agent server 配置里。

## 本地覆盖

```text
.aflow/.specflow/agent-servers.local.json
```

这个文件保存本地密钥和机器相关设置。它会按 agent id 与 `.aflow/.specflow/agent-servers.json` 深度合并。

本地密钥示例：

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

## VPN 和代理

如果 VPN 或代理导致 agent 进程无法访问网络，在对应 agent server 的 `env` 中添加 `http_proxy` 和 `https_proxy`。

通常应该写在 `.aflow/.specflow/agent-servers.local.json`：

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

如果 agent 同时需要 API key 和代理，也放在同一个 `env` 中：

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

## Workflow 资源

```text
.aflow/.specflow/assets/<workflowId>/images/
.aflow/.specflow/assets/<workflowId>/resources/
```

这些文件来自 UI 中上传或关联到 workflow 的图片、目录和资源文件。

如果 workflow YAML 中引用了这些资源，并且团队或 CI 需要复现该 workflow，应把相关资源一并保存。

## Run 记录

```text
.aflow/.specflow/runs/<runId>.json
```

这些文件保存每次 run 的摘要、状态、节点输出、agent invocation、agent session、workflow snapshot、canvas snapshot 和运行时变量值。

旧版本可能存在：

```text
.aflow/.specflow/runs/<runId>.yaml
```

Specflow 会兼容读取旧的 YAML run record。

初始化 workspace 时，Specflow 会把 `runs/` 加入 `.aflow/.specflow/.gitignore`。

## Run 日志

```text
.aflow/.specflow/run-logs/<runId>.jsonl
```

这些文件是 append-only 的运行事件日志，每行一个 JSON event。它们保存 terminal output、node status、run status、agent lifecycle、interaction 和 restore attempt 等事件。

UI 的 run log、事件回放和部分恢复诊断会读取这里的内容。

## Cache

```text
.aflow/.specflow/cache/agents/
```

这里保存 agent server 相关缓存，例如：

- `capabilities.json`：agent capability probe 的缓存结果。
- `registry.json`：registry agent 索引缓存。
- `archives/`：registry agent distribution 下载和解包缓存。

也可以通过 `SPECFLOW_AGENT_CACHE_DIR` 把 agent cache 放到其他目录。

缓存文件可以删除；删除后 Specflow 会在需要时重新 probe 或下载。
