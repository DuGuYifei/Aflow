# Specflow 能力矩阵

这份文档把 Specflow 的用户可见能力按三个入口对齐：

- Aflow agent：`packages/aflow` 里的原生 Pi/TUI agent 入口。
- UI：由 `specflow serve` 提供的浏览器应用。
- Codex plugin：`plugins/specflow-codex` 里的 Codex plugin，通过
  `specflow mcp` 工作。

相关架构入口见 `docs/architecture/system-architecture.md`。ACP 细节见
`docs/architecture/acp-capabilities.md`。

面向最终用户的简化版见：

- `docs/public/tutorial/zh/aflow-ui-codex-capabilities.md`
- `docs/public/tutorial/en/aflow-ui-codex-capabilities.md`

实现标签尽量短：

- `tool`：AI 可见 tool call。
- `command`：slash/native command。
- `REST`：HTTP API。
- `SSE`：server-sent event stream。
- `WS`：bridge/agent proxy 内部的 ACP 类 websocket 传输。
- `TUI`：terminal UI 交互。
- `UI`：浏览器交互。
- `MCP`：Codex MCP tool。
- `local`：本地文件或本地 package 逻辑。
- `server`：共享 Specflow server/runtime 逻辑。

## 能力表

| 功能 | Aflow agent | UI | Codex plugin |
|---|---|---|---|
| 启动 workspace server | 支持：`local` `connectOrStartSpecflowServer`；可 in-process 启动 server | 支持：用户运行 `specflow serve`，浏览器连接同一个进程 | 支持：`MCP` `specflow mcp`；按 `SPECFLOW_SERVER_URL`、workspace `server.json`、默认端口查找，找不到就启动 `specflow serve` |
| health/workspace 检查 | 支持：Aflow 包内 `specflow-client.ts` 调 `REST` `/api/health` | 支持：浏览器加载和后续 API 调用隐式检查 | 支持：`MCP` `specflow_health` -> `@specflow/client` -> `REST` `/api/health` |
| 列出 agentflow/workflow | 支持：`tool` `specflow_list_workflows` -> `REST` `/api/canvases` | 支持：`UI` sidebar -> `REST` `/api/canvases` | 支持：`MCP` `specflow_list_workflows` -> `REST` `/api/canvases` |
| 读取 YAML/source | 支持：`tool` `specflow_read_workflow` -> `REST` `/api/workflows/source/read` | 部分支持：editor 通过 `REST` 加载 canvas/agentflow doc；不是 raw YAML editor 主路径 | 支持：`MCP` `specflow_read_workflow` -> `REST` `/api/workflows/source/read` |
| 写入 YAML/source | 支持：`tool` `specflow_write_workflow` -> `REST` `/api/workflows/source/write` | 支持：canvas save -> `REST` `/api/canvases/:id`、`/agentflow`、`/layout` | 支持：`MCP` `specflow_write_workflow` -> `REST` `/api/workflows/source/write` |
| fork/adapt workflow | 支持：`command` `/specflow-fork-adapt` + `tool` `specflow_fork_workflow_to_local` | 手动为主：UI 主路径是编辑当前 canvas；复制/另存能力按 UI 暴露情况使用 | 支持：`MCP` `specflow_fork_workflow_to_local` -> `REST` `/api/workflows/source/fork` |
| 从需求创建 workflow | 支持：`command` `/specflow-create` + AI 用 tools 写 YAML | 支持：浏览器创建空 canvas 后可视化编辑 | 支持：skill 指导 Codex 用 MCP tools 写完整 YAML |
| validate workflow | 支持：`command` `/specflow-validate` + `tool` `specflow_validate_workflow` -> `REST` `/api/workflows/validate` | 支持：保存/diagnostics 走 server validation | 支持：`MCP` `specflow_validate_workflow` -> `REST` `/api/workflows/validate` |
| 拒绝 v1 workflow YAML | 支持：`server` validation 对非 v2 workflow source 报错 | 支持：通过保存/validate 路径返回 diagnostics/error | 支持：同一套 `server` validation，经 MCP 暴露 |
| prepare run 变量/auth | 支持：run tool prepare 后用 `TUI` 逐个询问变量；auth 由 UI/Aflow/server 处理 | 支持：run panel 通过 `REST` 检查变量/auth | 支持：`MCP` `specflow_prepare_run`；缺变量由聊天询问；auth 提示用户去 UI |
| normal run | 支持：`tool` `specflow_run_workflow` -> `REST` start + `SSE` monitor + `TUI` prompts | 支持：run button -> `REST` start + `SSE` events + browser panels | 支持：`MCP` `specflow_start_run` -> `REST`；bounded wait 后用 get/log 轮询或恢复 |
| 长时间 run 恢复上下文 | 支持：`tool` `specflow_get_run`、`specflow_get_run_logs` 查询已有/外部/丢上下文 run；自启动 run 主路径仍是 `SSE` | 支持：runs panel 通过 `REST` 重新加载 run record/logs | 支持：`MCP` `specflow_get_run`、`specflow_get_run_logs` 是主要轮询/恢复路径 |
| dynamic run | 支持：`tool` `specflow_run_workflow(dynamicReview)` 首次 activation 后暂停，然后 `specflow_run_to_next_checkpoint` | 部分/operator 支持：UI 能展示 paused/interrupted 状态和 runtime snapshot；没有自主 AI dynamic reviewer | 支持：`MCP` `specflow_start_run(dynamicReview)` + checkpoint tools |
| dynamic checkpoint inspect | 支持：`tool` `specflow_get_run_checkpoint` -> `REST` run/checkpoint 数据 | 支持：UI 从 run record/logs 展示当前节点状态 | 支持：`MCP` `specflow_get_run_checkpoint` |
| dynamic 单步推进 | 支持：`tool` `specflow_run_to_next_checkpoint` -> `REST` play + `SSE` wait | UI run controls 能 play/pause，但不是 AI 的 one-checkpoint loop | 支持：`MCP` `specflow_run_to_next_checkpoint` |
| runtime graph patch | 支持：`tool` `specflow_patch_run_graph` -> `REST` PATCH `/api/runs/:id/graph`；只改 run snapshot | 支持：runtime snapshot 编辑/可视化按 UI 暴露情况走 `REST` | 支持：`MCP` `specflow_patch_run_graph`；只改 run snapshot |
| 保存成功 run 为 best practice | 支持：tool 路径调用 server best-practice endpoint | 支持：operator/run UI 暴露时可用 | 支持：`MCP` `specflow_save_run_best_practice` |
| rerun existing run | 支持：client/server 支持；AI tool 已注册时可用 | 支持：run history 暴露时可用 | 支持：`MCP` `specflow_rerun` |
| delete run | 支持：client/server 支持；AI tool 已注册时可用 | 支持：run history 暴露时可用 | 支持：`MCP` `specflow_delete_run` |
| pause active run | 支持：`tool` `specflow_pause_run` -> `REST` `/api/runs/:id/pause`；用于已有 active run | 支持：run control button -> `REST` pause | 支持：`MCP` `specflow_pause_run` |
| play paused/interrupted run | 支持：`tool` `specflow_play_run` -> `REST` `/api/runs/:id/play`；继续同一个 run id | 支持：run control button -> `REST` play | 支持：`MCP` `specflow_play_run` |
| interrupt active ACP turn | 支持：`tool` `specflow_interrupt_run` -> `REST` `/api/runs/:id/interrupt` | 支持：run control button -> `REST` interrupt | 支持：`MCP` `specflow_interrupt_run` |
| stop run | 支持：`tool` `specflow_stop_run` -> `REST` `/api/runs/:id/stop`；这个 run id 进入 terminal 状态 | 支持：run control button -> `REST` stop | 支持：`MCP` `specflow_stop_run`；这个 run id 进入 terminal 状态 |
| continue stopped/error run | 支持：`command` `/specflow-continue` + `tool` `specflow_continue_workflow`；创建新的 continuation run | 支持：continue action 创建新 run | 支持：`MCP` `specflow_continue_workflow`；创建新的 continuation run |
| `pauseAfterRun` ACP 节点对话 | 支持：`SSE` 发现 paused node + `TUI` 对话 + continue | 支持：paused-node UI panel -> `REST` prompt/continue | 支持：`MCP` `specflow_list_paused_nodes`、`specflow_prompt_paused_node`、`specflow_continue_paused_node` |
| ACP permission/elicitation | 支持：`SSE` event + `TUI` response tool flow | 支持：interaction modal -> `REST` respond | 支持：`MCP` `specflow_list_pending_interactions`、`specflow_respond_interaction` |
| agent session list/inspect | 支持：`tool` + native resume picker 路径 -> `REST` `/api/agent-sessions` | 支持：sessions UI -> `REST` | 支持：`MCP` `specflow_list_agent_sessions`、`specflow_get_agent_session` |
| ACP session restore/inspect/continue | 支持：`/specflow-resume-session` + Aflow picker/native handoff + `REST` restore + `SSE` restore events | 支持：session restore UI -> `REST` + `SSE` | 支持：`MCP` `specflow_restore_agent_session`、prompt/cancel/close tools |
| native CLI resume command | 支持：Aflow picker 可展示 native command；`tool` `specflow_get_native_resume_commands` | 支持：server API 可提供 native resume command 数据，UI 可按需展示 | 支持：`MCP` `specflow_get_native_resume_commands`、`specflow_get_agent_session_native_resume_command` |
| agent server list | 支持：`tool` `specflow_list_agent_servers` -> `REST` | 支持：agent server manager -> `REST` | 支持：`MCP` `specflow_list_agent_servers` |
| agent registry list | 支持：`tool` `specflow_list_agent_registry` -> `REST` registry/CDN index | 支持：agent server manager -> `REST` | 支持：`MCP` `specflow_list_agent_registry` |
| install registry agent | 支持：`tool` `specflow_install_registry_agent`；只在用户明确要求时使用 | 支持：agent server manager 下载/配置 registry agent | 支持：`MCP` `specflow_install_registry_agent`；只在用户明确要求时使用 |
| update registry agent | 支持：`tool` `specflow_update_registry_agent`；只在用户明确要求时使用 | 支持：agent server manager update action | 支持：`MCP` `specflow_update_registry_agent`；只在用户明确要求时使用 |
| remove agent server override | 支持：`tool` `specflow_remove_agent_server`；只在用户明确要求时使用 | 支持：agent server manager remove action | 支持：`MCP` `specflow_remove_agent_server`；只在用户明确要求时使用 |
| custom/headless agent config | 支持：Aflow 可检查已有配置，但不应随手写 raw custom JSON | 支持：主要配置入口在 UI | 不直接支持 raw JSON MCP path；plugin 要求用户到 UI 配 custom/headless agent |
| agent capability cache/probe | 支持：`tool` `specflow_get_agent_capabilities`、`specflow_refresh_agent_capabilities` -> `REST`；用于 mode/model/permission/command 判断 | 支持：node panel/agent manager 使用 `REST` capabilities 和 refresh | 支持：`MCP` 同名 tools |
| capability dedupe/兼容清理 | 支持：server-side `agent-proxy` store 行为对 Aflow 生效 | 支持：同一 server-side store 行为 | 支持：同一 server-side store 行为，经 MCP 读取 |
| agent auth status | 支持：Aflow/server/UI 可检查 auth；Aflow 可引导用户认证 | 支持：主要 auth UX，包括 terminal auth modal/events | 有限支持：Codex 收到 auth-required 后提示用户去 UI；没有 MCP terminal auth tools |
| terminal/TUI auth | 支持：Aflow/server 可支持相关 auth flow | 支持：auth terminal modal -> `REST` + `SSE` terminal events | 不支持：MCP plugin 有意不暴露 terminal auth |
| asset import from browser files | 不作为常规 Aflow agent tool；Aflow 通常直接写相对路径 | 支持：upload/import assets -> `REST` `/api/canvases/:id/assets` | 支持但很少用：`MCP` `specflow_import_assets` 把外部文件复制进 workflow assets |
| repo 内文件引用 | 支持：AI 直接在 YAML 写 relative paths | 支持：用户/UI 可引用 project assets/paths | 支持：skill 明确要求优先 relative paths，不 import |
| 节点 prompt 中的 skills/slash commands | 支持：server prompt transformer 在 ACP 执行时解析 `/skill` 并保留 agent commands | 支持：rich prompt input autocomplete 显示 project/global skills 和 ACP commands；插入 slash 形式 | runtime 支持：这属于被选中的 ACP agent 行为，不是 plugin tool；Codex ACP 解析 slash prompt text |
| project/global skill discovery | 支持：server `SkillStore` 在 prompt transform 时加载 | 支持：`/api/skills` 和 capability APIs 供 autocomplete 使用 | 间接支持：Codex plugin 自己有 Codex skill；runtime ACP skills 属于 server/agent 行为 |
| Design app/project runtime | 通常不是 Aflow agent 主路径 | 支持：`packages/server/src/design` 和 `packages/ui/src/design` | 当前没有直接 MCP tools |
| static UI embedding in binary | 和 Aflow agent 行为无关 | 支持：`packages/server/src/static-ui-assets.generated.ts` 提供 built UI | 无关：plugin 不打包 UI |
| plugin 安装/发布 | 不适用 | 不适用 | 支持：`.codex-plugin/plugin.json`、`.mcp.json`、`skills/`；从 `codex-plugin` branch 分发，不内置 binary |

## 有意不完全一致的地方

- Codex plugin 不暴露 terminal auth。安全路径是：Codex 报告需要 auth，
  用户去 Specflow UI 完成认证，然后 Codex 重试。
- Codex plugin 不写任意 custom/headless agent server JSON。registry-backed
  install/update/remove 暴露给 Codex；non-registry setup 属于 UI。
- Aflow agent 不需要常规 asset import tool。它可以直接把 repo 相对路径写进
  workflow YAML。Codex 保留 asset import 只是为了“把仓库外文件固化进 assets，
  方便分享/提交/复现”这个少见场景。
- UI 是最完整的人工 operator surface。Aflow 和 Codex 是同一个 server runtime
  上的 AI/operator surface，只是交互模型不同。

## 当前命名地图

| 词 | 在项目里的含义 | 用户影响 |
|---|---|---|
| Agentflow | 用户可见的 Specflow flow 文件，位于 `.aflow/.specflow/agentflow`；server 里也有 `packages/server/src/agentflow` 模块 | 外部概念保持稳定 |
| Workflow | 共享执行模型和 `packages/workflow` TypeScript package；很多 API 仍用 workflow 表示通用 flow source/run 逻辑 | 内部/通用术语 |
| Canvas | UI layout/document，包含位置和视觉元数据 | 浏览器/editor 术语 |
| Run | 一次执行记录，包含 status、logs、snapshot、checkpoint、sessions | Aflow/UI/Codex 共享 |
| Run snapshot | 存在 run 上的可编辑副本，和保存的 YAML 分离 | dynamic/runtime patch 的目标 |
