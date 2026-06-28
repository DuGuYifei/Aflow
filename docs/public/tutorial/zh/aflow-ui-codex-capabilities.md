---
title: Aflow / UI / Codex 能力对比
description: 对比 Aflow Agent、Specflow UI 和 Codex 插件分别适合做什么。
order: 45
updatedAt: 2026-06-28
---

# Aflow / UI / Codex 能力对比

Specflow 有三个主要入口：

- **Aflow Agent**：终端里的交互式 workflow agent，适合让 AI 帮你创建、改写、
  运行、动态检查和恢复 workflow。
- **Specflow UI**：浏览器里的人工 operator 和可视化编辑器，适合看图、看日志、
  配置 agent server、认证和手动控制 run。
- **Codex 插件**：让 Codex 通过 MCP 使用当前仓库里的 Specflow server，适合在
  Codex 会话里读写 workflow、运行 dynamic run、查看 run 和恢复 session。

它们操作的是同一套 workspace 和同一个 Specflow server/runtime。区别主要在入口、
交互方式和适合的任务。

## 能力对比

| 功能 | Aflow Agent | Specflow UI | Codex 插件 |
|---|---|---|---|
| 创建 workflow | 支持。通过对话和 Aflow tools 写 YAML。 | 支持。通过浏览器 canvas 可视化创建。 | 支持。通过 MCP tools 写 workflow YAML。 |
| 读取/修改 workflow | 支持。适合让 AI fork/adapt 或修 YAML。 | 支持。适合人工编辑和查看画布。 | 支持。适合 Codex 在当前任务里改 workflow。 |
| fork/adapt workflow | 支持。优先复制到本地草稿再改。 | 手动为主。 | 支持。通过 MCP fork 到本地草稿。 |
| validate workflow | 支持。Aflow 会解释并帮助修复。 | 支持。保存和运行前会显示 diagnostics。 | 支持。Codex 可先 validate 再运行。 |
| normal run | 支持。TUI 展示实时状态。 | 支持。浏览器展示实时状态、日志和画布。 | 支持。MCP 启动 run，之后用 runId 查询。 |
| dynamic run | 支持。每个 checkpoint 停一次，由 Aflow 检查并可 patch 当前 run snapshot。 | 部分支持。UI 能看状态和手动控制，但不是 AI dynamic reviewer。 | 支持。每个 checkpoint 停一次，由 Codex 检查并可 patch 当前 run snapshot。 |
| runtime graph patch | 支持。只改当前 run snapshot。 | 支持查看/操作 runtime snapshot 的 UI 能力。 | 支持。只改当前 run snapshot。 |
| 查看历史 run / logs | 支持。适合调试已有 runId 或恢复上下文。 | 支持。最适合浏览历史、timeline 和日志。 | 支持。Codex 长任务恢复上下文的主要方式。 |
| pause / play / interrupt / stop | 支持。适合控制已知 active run。 | 支持。最直接的手动控制入口。 | 支持。通过 MCP 控制已知 runId。 |
| continue stopped/error run | 支持。创建新的 continuation run。 | 支持。创建新的 continuation run。 | 支持。创建新的 continuation run。 |
| `pauseAfterRun` 节点对话 | 支持。Aflow TUI 里继续和该节点 agent 对话。 | 支持。浏览器 paused-node 面板。 | 支持。通过 MCP paused-node tools。 |
| permission / elicitation | 支持。Aflow TUI 响应交互。 | 支持。浏览器 interaction modal。 | 支持。Codex 通过 MCP tools 响应。 |
| agent session resume/inspect | 支持。Aflow 有 session picker 和 native handoff。 | 支持。浏览器查看和恢复 session。 | 支持。MCP restore/prompt/close tools。 |
| native CLI resume command | 支持。可显示或在 Aflow terminal 中 handoff。 | 支持 server 侧信息，UI 可展示时使用。 | 支持。返回已验证的 native resume command；未知 agent 不猜。 |
| agent server 配置 | 支持部分辅助能力。适合列出、安装、更新 registry agent。 | 支持。推荐配置 custom/headless agent、认证和复杂环境。 | 支持 registry agent 的列出/安装/更新/删除；custom/headless 建议去 UI 配。 |
| agent auth | 支持 UI/Aflow/server 认证路径。 | 支持。推荐认证入口，包含 terminal auth。 | 不直接处理 terminal auth。遇到 auth required 时提示去 UI。 |
| asset import | 通常不需要。Aflow 直接写 repo 相对路径。 | 支持浏览器上传/import。 | 支持但很少用。仅当用户明确要把仓库外文件固化进 workflow assets 时使用。 |
| Codex plugin 安装 | 不适用。 | 不适用。 | 支持。插件只声明 MCP 和 skill，不打包 `specflow` binary。 |

## 怎么选择入口

优先用 **Aflow Agent**，如果你想让 AI 帮你推进 workflow 本身：

- 从业务目标创建 workflow；
- fork/adapt 现有 workflow；
- 运行 dynamic review；
- 运行结束后进入某个 agent session 继续处理。

优先用 **Specflow UI**，如果你需要人工观察和配置：

- 看 workflow 图、run 状态、timeline 和日志；
- 配置或认证 agent server；
- 手动 pause/play/interrupt/stop；
- 处理 terminal auth；
- 编辑 canvas 布局。

优先用 **Codex 插件**，如果你已经在 Codex 里工作：

- 让 Codex 读取、修改、validate workflow；
- 让 Codex 运行 normal/dynamic run；
- 长时间任务后用 runId 恢复上下文；
- 让 Codex 根据 run 结果 patch 当前 run snapshot。

## 有意不一致的地方

- Codex 插件不处理 terminal auth。认证请去 Specflow UI。
- Aflow 通常不需要 asset import；仓库内文件直接写相对路径。
- UI 是最完整的人工 operator surface；Aflow 和 Codex 是 AI/operator surface。
- Dynamic run 的 patch 只修改当前 run snapshot，不会自动覆盖保存的 workflow YAML。

工程实现细节版见 `docs/architecture/capability-matrix.md`。
