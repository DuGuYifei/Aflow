# ACP 当前实现能力

这份文档记录当前代码对 ACP agent 的支持边界。它按实现事实编写，旧的
`.aflow/.specflow/spec/product/agent-proxy-acp/*` 快照不再作为事实源。

## 代码位置

| 模块 | 职责 |
|---|---|
| `packages/agent-proxy/src/runtimes/acp/connection.ts` | ACP process lifecycle、initialize、session create/load/resume/fork、prompt、cancel、restore、capability probe、auth。 |
| `packages/agent-proxy/src/runtimes/acp/client-handlers.ts` | agent -> client handlers：permission、session update、filesystem、terminal、elicitation、extension methods。 |
| `packages/agent-proxy/src/session-pool.ts` | workflow session 到 ACP session 的池化与复用。 |
| `packages/bridge/src/execution/executor.ts` | 把 workflow node/gate/handoff 转成 agent invocation，并转发 mode/config/mcpServers。 |
| `packages/server/src/api.ts` | 把 run events、interactions、paused nodes、restore、auth、capability APIs 暴露给 UI/Aflow/Codex。 |

## Client -> Agent 方法

| ACP 能力 | 当前实现 | 说明 |
|---|---|---|
| `initialize` | 支持 | 发送 Specflow clientCapabilities，并校验 protocolVersion。 |
| `authenticate` | 支持 | 用于 ACP-native auth methods；包括 env_var 和 terminal auth 路径。 |
| `session/new` | 支持 | 创建 ACP session；传入 `cwd`、`additionalDirectories`、`mcpServers`。 |
| `session/load` | 支持 | restore/inspect 优先使用 `loadSession`，取决于 agent capabilities。 |
| `session/resume` | 支持 | 当不支持 load 但支持 `sessionCapabilities.resume` 时使用。 |
| `session/prompt` | 支持 | normal node、gate、handoff、restored conversation 都通过 prompt 执行。 |
| `session/cancel` | 支持 | abort signal 或 interrupt 时取消当前 prompt。 |
| `session/close` | 支持 | connection close 时 best-effort close 已知 ACP sessions。 |
| `session/set_mode` | 支持 | 节点 `modeId` 触发；会根据 session advertised modes 校验。 |
| `session/set_config_option` | 支持 | 节点 `configOptions` 触发；支持 select/boolean。 |
| `session/fork` | 条件支持 | 只有 agent advertised `sessionCapabilities.fork` 时调用 `unstable_forkSession`；否则复用 parent session 并记录 `sessionForked:false`。 |
| `session/list` | 不作为 Specflow runtime 路径 | 当前 workflow runtime 不依赖 ACP session/list；session 记录来自 run lifecycle。 |
| `logout` | 不支持 | 没有产品入口。 |

## Agent -> Client handlers

| ACP handler | 当前实现 | 说明 |
|---|---|---|
| `session/update` | 支持 | 输出、lifecycle、available commands 等 update 被记录并写入 run logs/capability cache。 |
| `session/request_permission` | 支持 | 进入 bridge interaction store，再由 UI/Aflow/Codex respond interaction。无 handler 时默认 cancel。 |
| `fs/read_text_file` | 支持 | 只能读取 `cwd` 和 `additionalDirectories` 允许 roots 内的文件。 |
| `fs/write_text_file` | 支持 | 只能写入允许 roots 内；自动创建父目录。 |
| `terminal/create` | 支持 | Bun spawn 子进程，cwd 受 allowed roots 限制。 |
| `terminal/output` | 支持 | 返回缓存输出，可按 outputByteLimit 截断。 |
| `terminal/wait_for_exit` | 支持 | 等待 terminal 进程退出。 |
| `terminal/kill` | 支持 | kill terminal 进程。 |
| `terminal/release` | 支持 | kill 并释放 terminal record。 |
| `elicitation/create` | 支持 | 进入 interaction store；无 handler 时默认 cancel。 |
| `elicitation/complete` | 支持 | 转发 completion notification。 |
| `extMethod` | 条件支持 | 有 handler 时转发，否则 method not found。 |
| `extNotification` | 条件支持 | 有 handler 时转发；否则忽略。 |

## Client capabilities advertised by Specflow

Specflow initialize 时声明：

| Capability | 值 |
|---|---|
| `fs.readTextFile` | true |
| `fs.writeTextFile` | true |
| `terminal` | true |
| `auth.terminal` | true |
| `elicitation.form` | supported |
| `elicitation.url` | supported |
| `positionEncodings` | `utf-8`, `utf-16`, `utf-32` |
| `_meta.terminal_output` | true |
| `_meta["terminal-auth"]` | true |

## Capability cache

Capability cache 保存：

- `InitializeResponse.agentCapabilities`
- `NewSessionResponse.modes`
- `NewSessionResponse.configOptions`
- `available_commands_update` 中的 commands
- `installedVersion`
- agent server settings fingerprint
- `probedAt`

刷新路径：

- 首次成功 initialize + newSession 后 best-effort 写入。
- `specflow_refresh_agent_capabilities` / UI refresh 会主动 probe。
- registry-backed agent 升级或 settings fingerprint 改变后，旧 cache 会被视为 stale。
- 相同 registry/settings fingerprint 的重复 capability key 会被兼容清理逻辑收敛。

## Slash commands 与 skills

当前行为：

- UI slash autocomplete 使用 `/api/skills` 和 selected agent capability cache。
- Project-local skills 来自 `<repo>/.agents/skills/*/SKILL.md`。
- Global skills 来自用户级 skills 目录。
- Server prompt transformer 先解析 Specflow skills。
- Agent-native slash commands 不在 Specflow 展开，按原文本传给 ACP agent。
- 某些 agent 暴露 `$command`；UI 可以归一成 slash 插入，但最终是否执行由 agent runtime 决定。

## MCP servers 透传

Workflow session 可以配置 raw JSON 字符串 `mcpServers`，运行时解析为
ACP `McpServer[]` 并传给：

- `session/new`
- `session/load`
- `session/resume`
- `session/fork`

约束：

- `mcpServers` 必须是 JSON array。
- 不支持包一层 `{"stdio": ...}` 的旧写法。
- malformed JSON 会在 run 时给出明确错误。

## Auth 支持边界

Server/UI/Aflow 支持 ACP auth：

- official ACP auth methods；
- env var auth；
- terminal auth；
- Zed-compatible `_meta["terminal-auth"]`；
- Gemini 临时 terminal auth shim。

Codex plugin 不暴露 terminal auth MCP tools。Codex 入口遇到 auth required 时，应提示用户去 Specflow UI 完成认证后再 retry。

## 已知边界

- `session/list` 不是当前 Specflow runtime 的 session 发现路径。
- `logout` 没有产品入口。
- ACP session fork 是条件能力；不支持 fork 的 agent 不会让 workflow 失败，而是复用 parent session。
- Elicitation 已有底层和 interaction 路径，但产品体验仍主要依赖 UI/Aflow/Codex interaction response。
- Native CLI resume 不从 ACP 自动推断；只用 `packages/native-resume` 的 verified adapter 表。
