# Aflow Agent Cockpit 方向

Last updated: 2026-06-02

## 产品定位

Aflow 是 Specflow 之上的 workflow-aware TUI agent cockpit。它的主要职责是通过对话理解用户的业务目标、已有 workflow YAML、以及用户自定义 ACP agent 的能力，然后帮助用户创建、改写、验证、运行、恢复和检查 workflow。

Aflow 自身优先使用 `@earendil-works/pi-coding-agent` 作为 SDK，而不是从更底层的 `agent` package 重新构建。`coding-agent` 已经提供 agent session、工具执行、TUI 生命周期、slash command、session 管理和 system prompt 覆盖点。Aflow 应复用这些能力，重写 system-level prompt、命令、视觉风格和 Specflow 集成层。

2026-06-02 已确认 `@earendil-works/pi-coding-agent@0.78.0` 可以通过 package manager 直接安装，并带有 `pi` binary。Aflow 不需要依赖本地 `/mnt/d/ProjectGit/pi` 构建产物；本仓库的 `packages/aflow` 作为 Pi SDK consumer 存在。

Specflow 仍然是 workflow runtime 和 server。Aflow 启动时应启动或连接 Specflow server，然后通过 server API 完成 workflow 操作。Browser UI 和 TUI 都是同一个 server state 的客户端，但原生 terminal handoff 只属于 Aflow TUI。

## Aflow 命令

Aflow 应暴露一组 workflow slash commands。它们是运行在 Aflow agent 会话里的意图入口，不是传统 CLI 子命令。LLM 负责根据当前对话、系统提示词和 slash command 参数提取需要的信息；如果发现 workflow id、run id、业务输入或 native session id 缺失，就通过 `ask_user` tool 询问用户。

- `/specflow-create`: 根据用户目标创建新 workflow。
- `/specflow-fork-adapt`: 将通用 workflow fork 或改写为适合当前问题的新 workflow。
- `/specflow-validate`: 验证 workflow YAML，并给出可执行的修复建议。
- `/specflow-run`: 启动 workflow run；确定 workflow 后，由 run tool 按 input node 一个个询问缺失变量。
- `/specflow-resume`: 恢复 cancelled 或可恢复的 workflow run。
- `/specflow-resume-session`: 根据 run 中记录的 agent session 打开统一 resume picker。

这些 slash commands 的 TUI 路径应该生成 agent prompt，再由 LLM 调用 workflow tools。Direct shell 路径可以保留确定性命令用于脚本、调试和 smoke test，但不能替代 Aflow TUI 的 LLM-driven 语义。

Aflow 当前注册的核心 tools：

- `ask_user`: 在 TUI 里向用户询问缺失信息，支持 text、choice 和 confirm。choice 最多展示 4 个选项；默认前 3 个是显式选项，最后 1 个进入自定义输入。
- `specflow_validate_workflow`: 验证 workflow id 或 YAML path。
- `specflow_run_workflow`: run saved workflow，并按缺失 input variable 逐个询问。
- `specflow_resume_workflow`: resume cancelled/failed run。
- `specflow_resume_session`: 针对某个 run 打开统一 resume picker，选择 ACP Resume、ACP Inspect、Native CLI in Aflow terminal、Show native resume command 或 Skip。

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
- 当前 adapter 状态是 `resume`、`continue`、`selector`、`acp-only`、`unknown` 还是 `unsupported`。

Run 结束时，Aflow 应列出相关 session，并复用统一 resume picker。picker 的第二层选项为：

- `ACP Resume`
- `ACP Inspect`
- `Native CLI in Aflow terminal`
- `Show native resume command`
- `Skip`

`Show native resume command` 只展示推荐命令，不接管当前 Aflow terminal，适合用户自己另开 terminal 执行。若 adapter 无法推荐命令，TUI 应展示 agent session id、ACP session id、run id 等可供用户手动执行自有命令的信息。

用户后续会提供 registry 全量 agent 的 native help/resume 表。该表应被整理成独立 adapter 文件，而不是塞回 ACP registry。

当前第一版 adapter table 已落在 `packages/aflow/src/native/native-agent-adapters.ts`。它包含 Claude、Codex、Gemini、Qwen、Cursor、Goose、OpenCode、Amp 等常见 agent 的 resume template，也明确把 Pi/GLM 这类 native resume 不适配的 agent 标记为 `acp-only`。所有推荐都带 caveat：ACP session id 不保证等于 native CLI session id。

Adapter table 是工程事实，不应完整塞进 Aflow system prompt。Prompt 只要求 LLM 不要猜 native resume 命令，并使用 tool/adapter 返回值。`custom` agent server 默认不能自动 native resume，即使命令名看起来像 Codex/Claude；除非未来显式配置 native resume override，否则 Aflow 只能提供 ACP Resume/Inspect 或记录下来的 session ids，让用户自行运行原生命令。

## 当前实现快照

`packages/aflow` 的第一版实现如下：

- Aflow CLI 默认调用 Pi `main(args, { extensionFactories })`，保留 Pi 的 `--resume`、`--continue`、`--session`、`--fork`、model/tool/system-prompt/skills/theme 等能力。
- Aflow 通过 Pi extension 注册 `/specflow-create`、`/specflow-fork-adapt`、`/specflow-validate`、`/specflow-run`、`/specflow-resume`、`/specflow-resume-session`。这些 slash commands 会把结构化任务提示送给 LLM，而不是在 TUI command handler 里直接执行。
- Aflow 注册 `ask_user` 和 workflow tools；LLM 用这些 tools 提取参数、询问缺失信息并调用 Specflow server。
- Aflow shell 入口也支持直接运行 `/specflow-validate`、`/specflow-run`、`/specflow-resume`、`/specflow-resume-session`。
- Aflow 系统提示词和 workflow YAML authoring guide 内嵌在 `packages/aflow/src/prompt-content.ts`，保证 `aflow` 二进制放到任意项目根目录运行时仍有完整规则。
- Aflow create/fork-adapt prompts 使用内嵌 workflow authoring guide；fork/adapt 默认先复制源 YAML 到 `.aflow/.specflow/agentflows-local/<new-workflow-id>.yaml` 再修改副本。
- Aflow 与 Specflow server 的连接逻辑在 `packages/aflow/src/server/connect-or-start.ts`。它优先连接同 workspace 的已有 server，连不上才启动。
- Specflow `/api/health` 已追加 `workspaceRoot`、`serverId`、`apiVersion`，用于 Aflow 防止连错 server。
- Native handoff skeleton 使用 inherited stdio，并在 handoff 前后打印小号绿色 Aflow guard line。当前 `--execute` 只在 direct Aflow CLI 中启用；Pi-backed TUI extension 先只推荐命令，因为 Pi extension API 尚未暴露可安全暂停 renderer/raw mode 的 handoff 钩子。
- 构建产物应包含两个可移动二进制：`specflow` 和 `aflow`。`aflow` 不能依赖本仓库源码或 docs 目录存在。

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

Native CLI handoff 是沉浸式 resume path：用于让用户在不切换 terminal 的情况下进入原 agent 体验。它应发生在 run 结束后，或用户显式选择 resume 某个 agent session 时，并在 native process 退出后回到 Aflow。

Aflow 不应承诺捕捉每一次 native CLI 交互，除非具体 handoff 实现明确支持 transcript capture。因此，native session 结束后的 workflow 更新建议，应基于已记录的 run state、session metadata、用户显式说明，或 native adapter 约定的 result/transcript contract。

## 待定问题

- 用户需要提供 registry 全量 agent 的 native help/resume 表。
- 每个 adapter 需要明确 detection command 和 resume command template。
- Unknown native command 需要一个 TUI 流程：能推荐就推荐，不能推荐就让用户手动输入。
- 如果未来一定要支持 `Shift+Esc` 立即返回 Aflow，就需要 PTY 或 tmux-style terminal ownership，而不是纯 inherited stdio。
- 自研完整 cockpit TUI 仍在下一阶段；当前第一版保留 Pi TUI，并通过 extension 注入 Aflow header/status/commands。真正的 in-TUI native handoff 需要 Aflow-owned terminal lifecycle，或 Pi SDK 暴露可暂停/恢复 interactive renderer 的公开 API。
