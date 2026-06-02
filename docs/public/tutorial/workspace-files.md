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

这个文件保存团队共享的 agent server 配置。workflow YAML 里的 `session.agentServerId` 引用的是这里的 agent server key，而不是一定等于 registry id。

Specflow 支持三类 agent server：

- `registry`：从 ACP registry 选择并解析的 ACP agent，适合 Codex、Claude、Gemini 等 registry agent。
- `custom`：你自己提供启动命令的 ACP agent，要求通过 stdio 实现 ACP。
- `headless`：不走 ACP session 的命令式 agent，适合简单的非交互批处理流程。

配置文件支持 `agent_servers`，也兼容旧的 `agentServers`。字段优先使用 camelCase，例如 `registryId`、`argsTemplate`；读取时也兼容部分 snake_case 字段，例如 `registry_id`、`args_template`。

### Registry ACP agent

Registry agent 由 ACP registry 提供元数据和 distribution。Specflow 会保存、安装并尝试运行 registry 返回的 agent；当前支持的 distribution 类型包括 `binary`、`npx` 和 `uvx`。Registry 中存在某个 agent 不代表它一定能在当前机器运行，distribution、认证、协议和运行时错误仍可能由对应 agent 路径报告。

CLI 启动时会先准备 workspace，并预热 `.aflow/.specflow/agent-servers.json` 中声明的 registry agent。对于 binary distribution，这会按需下载并解包到 agent cache；对于 `npx` 或 `uvx` distribution，Specflow 会解析出对应命令，具体包获取仍由 `npx` 或 `uvx` 在运行时处理。预热成功后，Specflow 会在本机的 `agent-servers.local.json` 中记录这次实际解析到的 registry version。

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

registry agent 也可以配置通用字段，例如 `cwd`、`env` 和 `additionalDirectories`：

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

### Custom ACP agent

Custom agent 适合接入你自己实现的 ACP server。它需要通过 stdio 读写 ACP 消息。

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

Custom agent 常用字段：

- `command`：启动命令。
- `args`：命令参数。
- `cwd`：agent 进程工作目录。
- `env`：传给 agent 进程的环境变量。
- `additionalDirectories`：允许 agent 访问的额外工作目录。

### Headless agent

Headless agent 是命令式 agent，不创建 ACP session。它适合简单的自动化或批处理，但不支持 ACP session、terminal auth、permission prompt 等交互能力。使用 headless agent 的节点也不能依赖需要 ACP session 的人工暂停交互。

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

Headless agent 常用字段：

- `command`：启动命令。
- `argsTemplate`：命令参数模板。
- `timeoutMs`：可选超时时间。
- `cwd`、`env`、`additionalDirectories`：与其他 agent server 类型相同的通用字段。

Agent server 条目只保存进程启动和解析需要的设置。认证、terminal capability 和 permission prompt 由 ACP 在运行时驱动。Mode、model、reasoning 和 config override 应该配置在 workflow 或节点级别，而不是 agent server 配置里。

## 本地覆盖

```text
.aflow/.specflow/agent-servers.local.json
```

这个文件保存本地密钥和机器相关设置。它会按 agent id 与 `.aflow/.specflow/agent-servers.json` 深度合并；嵌套对象也会合并，因此常见做法是把共享配置提交到 `agent-servers.json`，把 API key、代理、个人路径等放到 `agent-servers.local.json`。

Specflow 预热或 UI 保存 registry agent 时可能会在本地配置里记录 `installedVersion`。这个字段只是本地安装/解析时留下的 audit stamp，主要用于 UI 更新提示和 capability cache 失效判断；它不是版本锁，也不会控制团队共享安装。不要把 `installedVersion`、`installed_version` 或 `version` 写进共享的 `agent-servers.json`。如果共享文件里出现这类字段，Specflow 在启动预热下载时会打印 warning。

共享配置：

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

本地覆盖：

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

最终运行时，`codex-acp.env` 会同时包含 `SPECFLOW_SHARED` 和 `OPENAI_API_KEY`。

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
- `registry.json`：registry agent 索引的 fallback 快照；正常情况下 Specflow 会优先读取 CDN 最新 registry。
- `archives/`：registry agent distribution 下载和解包缓存。

也可以通过 `SPECFLOW_AGENT_CACHE_DIR` 把 agent cache 放到其他目录。

缓存文件可以删除；删除后 Specflow 会在启动预热或运行需要时重新 probe 或下载。Registry agent 的本地 `installedVersion` audit stamp 变化时，旧的 capability cache 会被视为过期。
