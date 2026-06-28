---
title: Codex 插件
description: 安装并使用 Specflow Codex 插件。
order: 40
updatedAt: 2026-06-28
---

# Codex 插件

Specflow Codex 插件让 Codex 通过 MCP 使用 Specflow workflow。插件本身不
打包 `specflow` 或 `aflow`，用户需要先安装 release binary。

## 前置条件

```sh
specflow --version
aflow --version
```

在 Codex 中打开目标仓库。该仓库应当已经包含，或可以初始化，
`.aflow/.specflow/`。

## MCP Server

插件会启动：

```sh
specflow mcp
```

这个 MCP 进程会定位或启动当前 workspace 的持久 Specflow server。Workflow
run 存在于 server 中，而不是 MCP 进程中；所以只要 Specflow server 还活着，
长时间运行的任务就可以之后通过 `runId` 继续查询。

也可以手动先启动 server：

```sh
specflow serve
```

## Codex CLI 安装

本地开发时，从当前仓库添加 marketplace：

```sh
codex plugin marketplace add .
codex
/plugins
```

安装并启用 `specflow-codex`。

发布后，从插件分支安装：

```sh
codex plugin marketplace add DuGuYifei/Aflow --ref specflow-plugin
codex
/plugins
```

安装并启用 `specflow-codex`。

## Codex App 安装

在 **Add plugin marketplace** 中填写：

- Source: `github.com/DuGuYifei/Aflow`
- Git ref: `specflow-plugin`
- Sparse paths: 留空

安装 `specflow-codex` 后，在目标仓库中新开一个 local thread，然后要求 Codex
使用 Specflow 插件。如果当前 Codex App 版本不能启动 plugin-provided local
MCP server，则先使用 Codex CLI 或 IDE，直到 App 的 MCP 启动路径验证通过。

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

Codex 可以列出已经配置的 agent server、查看 Specflow registry，并且在你明确要求时
安装或更新 registry-backed ACP agent。Registry 安装会使用 Specflow registry
元数据，并走正常的 server install 路径。

Codex 不负责配置 custom 或 headless agent server JSON。对于不在 registry 里的
agent，请先自行安装，并在 Specflow UI 中添加配置，然后再让 Codex 使用配置好的
`agentServerId`。

Agent 认证也在 Specflow UI 中完成。如果 Codex 报告需要认证，请先在 UI 中完成认证，
再重试 MCP tool。

## Dynamic 和 pauseAfterRun

Dynamic review 会在每次 activation 后暂停。Codex 可以检查 checkpoint 输出，
只 patch 当前 run snapshot，然后继续到下一个 checkpoint。

如果 run 到达 `pauseAfterRun` ACP 节点，Codex 应该：

1. 查询 paused nodes；
2. 需要时向 paused ACP node 发消息；
3. continue 这个 paused node；
4. 在 dynamic 模式下，用 `play: false` continue paused node，然后再 run 到下一个
   checkpoint。

不要用 `specflow run` 来做这些 workflow。那个命令是 standalone CLI runner，
有意不提供 Aflow Agent 的 dynamic/pause parity。
