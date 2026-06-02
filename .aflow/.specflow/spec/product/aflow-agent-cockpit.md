# Aflow Agent Cockpit 方向

## 产品定位

Aflow 是 Specflow 之上的 workflow-aware TUI agent cockpit。它的主要职责是通过对话理解用户的业务目标、已有 workflow YAML、以及用户自定义 ACP agent 的能力，然后帮助用户创建、改写、验证、运行、恢复和检查 workflow。

Aflow 自身优先使用 `coding-agent` 作为 SDK，而不是从更底层的 `agent` package 重新构建。`coding-agent` 已经提供 agent session、工具执行、TUI 生命周期、slash command、session 管理和 system prompt 覆盖点。Aflow 应复用这些能力，重写 system-level prompt、命令、视觉风格和 Specflow 集成层。

Specflow 仍然是 workflow runtime 和 server。Aflow 启动时应启动或连接 Specflow server，然后通过 server API 完成 workflow 操作。Browser UI 和 TUI 都是同一个 server state 的客户端，但原生 terminal handoff 只属于 Aflow TUI。

## Aflow 命令

Aflow 应暴露一组 workflow 命令。LLM 负责判断缺少哪些参数，并通过对话补齐；命令本身负责调用 Specflow server。

- `/specflow-create`: 根据用户目标创建新 workflow。
- `/specflow-fork-adapt`: 将通用 workflow fork 或改写为适合当前问题的新 workflow。
- `/specflow-validate`: 验证 workflow YAML，并给出可执行的修复建议。
- `/specflow-run`: 启动 workflow run。
- `/specflow-resume`: 恢复 cancelled 或可恢复的 workflow run。

这些命令应该是 Specflow server 的薄编排层。LLM-facing 层负责理解意图和补参数，server-facing 层负责执行操作，并返回 TUI 可展示的结构化状态。

## 运行时交互

Workflow run 过程中的结构化控制应走 ACP。节点配置了 `pauseAfterRun` 时，Aflow 应在自己的 TUI 中暂停，并在 workflow 仍然活着时继续使用当前 active ACP session。Pause TUI 应清楚展示当前 workflow、node、agent 和 session，并允许用户发送 prompt 后继续 workflow。

运行时 pause 不提供原生 CLI 选择。原生 handoff 留给 run 结束后或显式 resume 场景，因为 ACP 才能让 workflow 状态、prompt 和 node 生命周期继续被 Specflow server 观察和管理。

如果 workflow 已经 stopped、cancelled，或用户后来重新打开程序，Aflow 应使用 workflow resume 语义，而不是把它当作同一个 live pause。Specflow 现有对 stale `running` / `cancelled` 状态的修复能力应被保留，并通过 Aflow TUI 暴露出来。

## 原生 Agent Handoff

Run 结束后，或用户显式要求把某个记录下来的 session 交给原 agent 继续时，Aflow 可以在真实 terminal 中 handoff 到该 agent 的 native CLI。

优先 handoff 模型是 `stdio: inherit`：

1. 停止或挂起 Aflow TUI 渲染。
2. 使用 inherited stdin/stdout/stderr spawn 原生 agent command。
3. 子进程拥有 terminal 期间，临时保护 Aflow 自己不被 `SIGINT` 等 terminal signal 一起杀掉。
4. 等待原生 CLI 退出。
5. 重启 Aflow TUI，并刷新 workflow/session 状态。

这能获得最接近原生 CLI 的体验，因为 child process 直接拥有真实 terminal。`Ctrl+C` 应主要到达 child process。Aflow 只会在 child 退出后恢复；如果 child 把 `Ctrl+C` 当作取消当前操作而不是退出，用户会继续留在该原生 CLI 里，直到它正常退出。

Browser client 不支持原生 handoff。后台进程或没有 TTY 的环境也不应尝试原生 handoff。Windows 下真实 terminal session 可以优先尝试 inherited stdio；只有在需要嵌入式控制、输出 replay、或强制 escape key 返回 Aflow 时，才考虑 `Bun.Terminal`、PTY 或 tmux-style relay。

## Native Adapter Table

原生 resume 能力不应该从 ACP registry 推断。ACP registry 描述 ACP agent 可用性，而 native resume 是另一套 CLI 能力。

Aflow 应把专门的 native adapter table 编译进项目。每个已知 native agent 至少记录：

- 如何检测当前机器是否存在 native CLI command。
- 是否支持 native resume。
- 如何从 Specflow/ACP session record 生成推荐 resume command。
- 需要哪些 session id、transcript path 或 result file。
- 当前 adapter 状态是 known、unsupported 还是 unknown。

Run 结束时，Aflow 应列出相关 session，并在 adapter 能生成命令时给出推荐 resume command。若无法推荐，TUI 应允许用户手动输入 command，并可选择记住 workspace override。

用户后续会提供 registry 全量 agent 的 native help/resume 表。该表应被整理成独立 adapter 文件，而不是塞回 ACP registry。

## Validate 策略

Validate 应在 run 前和显式 `validate` 命令中提前发现不兼容的交互式 workflow。

如果某个 node 需要通过 `pauseAfterRun` 等待用户交互，它不能绑定 headless-only agent。Headless agent 可以继续用于不需要运行时对话的自动节点，但不能用于 pause/resume interaction。

对于 registry 和 custom agent，validate 应检查 workflow 期待的 execution mode，并在 agent 无法提供交互式 ACP session 时给出明确错误。

## 并发与状态

Aflow 主要是本地单用户 cockpit，不需要全局的 "同一时间只能 run 一个 workflow" 锁。

重复操作应由状态语义控制：

- 同时启动同一个 workflow 会创建两个不同 run。
- cancel 已经 cancelled 的 run 是 no-op，并返回清晰状态。
- resume 已经 resumed 的 run 应拒绝，或指向当前 active resumed run。
- paused 状态下如果已有 prompt 正在 pending，应复用现有 pending-prompt guard。

Browser UI 和 TUI 可以同时观察和控制同一个 server state，但原生 handoff 仍然只属于 Aflow TUI，因为它需要用户真实 terminal。

## UX 边界

ACP 是结构化 runtime path：用于 workflow execution、live pause interaction、node status、logs 和 server-visible state。

Native CLI handoff 是沉浸式 continuation path：用于让用户在不切换 terminal 的情况下进入原 agent 体验。它应发生在 run 结束后，或用户显式选择 resume 某个 session 时，并在 native process 退出后回到 Aflow。

Aflow 不应承诺捕捉每一次 native CLI 交互，除非具体 handoff 实现明确支持 transcript capture。因此，native session 结束后的 workflow 更新建议，应基于已记录的 run state、session metadata、用户显式说明，或 native adapter 约定的 result/transcript contract。

## 待定问题

- 用户需要提供 registry 全量 agent 的 native help/resume 表。
- 每个 adapter 需要明确 detection command 和 resume command template。
- Unknown native command 需要一个 TUI 流程：能推荐就推荐，不能推荐就让用户手动输入。
- 如果未来一定要支持 `Shift+Esc` 立即返回 Aflow，就需要 PTY 或 tmux-style terminal ownership，而不是纯 inherited stdio。
