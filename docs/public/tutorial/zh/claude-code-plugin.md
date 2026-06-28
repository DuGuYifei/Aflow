---
title: Claude Code 插件
description: 安装并使用 Specflow Claude Code 插件。
order: 41
updatedAt: 2026-06-28
---

# Claude Code 插件

Specflow Claude Code 插件让 Claude Code 通过 MCP 使用 Specflow workflow。插件
本身不打包 `specflow` 或 `aflow`，用户需要先安装 release binary。

## 前置条件

```sh
specflow --version
aflow --version
```

在 Claude Code 中打开目标仓库。该仓库应当已经包含，或可以初始化，
`.aflow/.specflow/`。

## MCP Server

插件会启动：

```sh
specflow mcp
```

这个 MCP 进程会定位或启动当前 workspace 的持久 Specflow server。Workflow run
存在于 server 中，而不是 MCP 进程中；所以只要 Specflow server 还活着，长时间
运行的任务就可以之后通过 `runId` 继续查询。

也可以手动先启动 server：

```sh
specflow serve
```

## 本地安装

本地开发时，从当前仓库直接加载 plugin：

```sh
claude --plugin-dir /path/to/aflow-specflow/plugins/specflow-claude
```

把 `/path/to/aflow-specflow` 换成你的本地 checkout 路径。

## GitHub Marketplace 安装

插件分支发布后，启动 Claude Code 并添加 marketplace：

```text
/plugin marketplace add DuGuYifei/Aflow#specflow-plugin
/plugin install specflow-claude
```

安装并启用 `specflow-claude`。

## 常用 Prompt

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

## Agent Server

Claude Code 可以列出已经配置的 agent server、查看 Specflow registry，并且在你
明确要求时安装或更新 registry-backed ACP agent。Registry 安装会使用 Specflow
registry 元数据，并走正常的 server install 路径。

Claude Code 不负责配置 custom 或 headless agent server JSON。对于不在 registry
里的 agent，请先自行安装，并在 Specflow UI 中添加配置，然后再让 Claude Code
使用配置好的 `agentServerId`。

Agent 认证在 Specflow UI 中完成。如果 Claude Code 报告需要认证，请先在 UI 中
完成认证，再重试 MCP tool。

## Dynamic 和 pauseAfterRun

Dynamic review 会在每次 activation 后暂停。Claude Code 可以检查 checkpoint 输出，
只 patch 当前 run snapshot，然后继续到下一个 checkpoint。

如果 run 到达 `pauseAfterRun` ACP 节点，Claude Code 应该：

1. 查询 paused nodes；
2. 需要时向 paused ACP node 发消息；
3. continue 这个 paused node；
4. 在 dynamic 模式下，用 `play: false` continue paused node，然后再 run 到下一个
   checkpoint。

不要用 `specflow run` 来做这些 workflow。那个命令是 standalone CLI runner，
有意不提供 Aflow Agent 的 dynamic/pause parity。
