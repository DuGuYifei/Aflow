# 工程术语表

这份术语表面向代码维护者。面向用户的运行控制术语见
`docs/public/tutorial/zh/glossary.md` 和 `docs/public/tutorial/en/glossary.md`。

## 核心对象

| 术语 | 含义 |
|---|---|
| Specflow | 本地优先的 workflow/runtime/server 系统。 |
| Aflow | 建在 Specflow 之上的 Pi/TUI agent cockpit，负责通过对话创建、验证、运行、继续和恢复 Specflow workflows。 |
| Agentflow | 用户可见的 flow 概念和 workspace 文件夹名：`.aflow/.specflow/agentflow`。 |
| Workflow | 内部通用执行/source model。`packages/workflow` 是纯模型层，server/client/MCP API 也常用 workflow 表示通用 flow 操作。 |
| Canvas | UI document/layout model，包含节点位置、宽度、viewport 等视觉信息。 |
| AgentFlowDoc | 不带 layout 的可保存 agentflow 内容：sessions、nodes、edges、variables。 |
| CanvasDoc | UI 使用的完整文档：AgentFlowDoc + layout 字段。 |
| CanvasLayoutDoc | 独立保存的 layout 文档，位于 `.aflow/.specflow/agentflow/canvas/*.json`。 |

## Workspace 文件

| 路径 | 含义 |
|---|---|
| `.aflow/.specflow/agentflow/agentflows/` | shared/canonical workflow YAML。 |
| `.aflow/.specflow/agentflow/agentflows-local/` | local draft、fork/adapt、实验 workflow，默认不提交。 |
| `.aflow/.specflow/agentflow/canvas/` | UI canvas/layout JSON，默认不提交。 |
| `.aflow/.specflow/agentflow/assets/` | 被固化进 workflow 的 durable assets，默认不提交，除非项目决定分享这些 assets。 |
| `.aflow/.specflow/agentflow/runs/` | run records。 |
| `.aflow/.specflow/agentflow/run-logs/` | run JSONL event logs。 |
| `.aflow/.specflow/server.json` | 当前 workspace running server registry。 |
| `.aflow/.specflow/agent-servers.json` | shared agent server config。 |
| `.aflow/.specflow/agent-servers.local.json` | local agent server override，默认不提交。 |
| `.agents/skills/` | project-local skills。 |

## Workflow/Canvas 节点

| 术语 | 含义 |
|---|---|
| `start` node | v2 workflow 显式入口，不执行 agent。 |
| `step` node | 调用 agent 的工作节点，运行时转换为 `agent` node。 |
| `gate` node | 根据上游上下文选择 branch 的节点，运行时保留为 `gate` node。 |
| `end` node | UI/authoring 终点标记，运行时移除。 |
| `input` node | 旧结构；v2 中不应使用，输入应写成顶层 `variables`。 |
| Session | workflow 里的逻辑 agent 上下文；同 session 的节点共享 agent conversation。 |
| Agent Server | 可运行 agent 的配置项，来源可以是 `registry`、`custom`、`headless`。 |
| ACP Session | 外部 ACP agent 返回的真实 session id。 |

## Run 与控制

| 术语 | 含义 |
|---|---|
| Run | 一次 workflow 执行记录，包含 status、node states、outputs、snapshot、sessions、logs。 |
| Activation | 一次节点调度执行。 |
| Traversal | loop 或有上限 gate branch 中重复经过的次数。 |
| Run Snapshot | 保存在 run 上的 workflow 副本。runtime patch 修改它，不修改原始 YAML。 |
| Dynamic Run | Aflow/Codex 的 AI review mode：每个 checkpoint 暂停一次，检查输出，必要时 patch run snapshot，再推进下一个 checkpoint。 |
| Runtime Graph Patch | 对 run snapshot 的结构化修改，server 负责保留已完成历史并迁移 checkpoint。 |
| Pause | 计划性暂停：当前节点/checkpoint 完成后停在安全点。 |
| Interrupt | 立即打断当前 ACP prompt turn，但同一个 run 仍可 play。 |
| Play | 继续同一个 paused/interrupted run。 |
| Stop | 终止当前 run id；stop 后不能 play。 |
| Continue | 从 stopped/error run 创建新的 continuation run。 |
| Resume | agent session 恢复/检查，不是 workflow run control。 |

## ACP/Agent 交互

| 术语 | 含义 |
|---|---|
| ACP | Agent Client Protocol，用于 Specflow 和外部 agent CLI 通信。 |
| Agent Proxy | `packages/agent-proxy`，负责 registry/custom/headless agent 解析、进程启动、ACP client handlers、capability cache。 |
| Bridge | `packages/bridge`，负责 runtime graph execution、gate routing、loop traversal、agent invocation、permission/elicitation routing。 |
| Capability Cache | agent 初始化和 probe 后保存的 capabilities、modes、configOptions、availableCommands。 |
| `pauseAfterRun` | 节点配置。节点完成一次 agent turn 后，server 保留 ACP paused-node 状态，允许用户继续对话后再继续 workflow。 |
| Permission | ACP agent 请求用户批准某个 tool/action。 |
| Elicitation | ACP agent 请求用户填写结构化输入。 |
| Native Resume | 使用外部 agent 原生命令恢复 session，例如 `codex resume <id>`；只使用 server 验证过的 adapter 结果，不猜。 |
| Headless Agent | 非 ACP 的 command-template agent runtime，适合确定性命令式执行。 |

## AI 入口

| 术语 | 含义 |
|---|---|
| Aflow PI tools | Aflow agent 可调用的 tools，带 description、schema、promptSnippet、promptGuidelines。 |
| Aflow slash commands | Aflow TUI 的命令入口，会生成 follow-up prompt，让 LLM 提取上下文并调用 tools。 |
| Codex MCP tools | Codex plugin 暴露的 MCP tools，通过 `specflow mcp` 调 server REST/SSE。 |
| Codex skill | `plugins/specflow-codex/skills/specflow/SKILL.md`，指导 Codex 何时、如何使用 Specflow MCP tools。 |
| Runtime slash command | 写在节点 prompt 里的 `/skill` 或 agent-native slash command。Specflow 会先解析本地 skills，剩余命令传给 ACP agent。 |
