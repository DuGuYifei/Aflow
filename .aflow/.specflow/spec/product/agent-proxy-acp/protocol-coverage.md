# ACP Protocol Coverage

本项目对 [Agent Client Protocol](https://agentclientprotocol.com/) schema 的实现覆盖情况,以及若干关键概念的解释。

代码位置:[packages/agent-proxy/src/runtimes/acp/](../../../packages/agent-proxy/src/runtimes/acp)

## Spawn 机制

ACP agent 子进程通过 Node.js 内置的 `child_process.spawn` 启动,使用 stdin/stdout 管道做 JSON-RPC 通信。**不使用 tmux,也不使用 node-pty**。

入口:[connection.ts](../../../packages/agent-proxy/src/runtimes/acp/connection.ts)

## Agent 端方法覆盖(client → agent 调用)

| ACP 方法 | 实现 | 位置 |
|---|---|---|
| `initialize` | ✅ | `AcpAgentClient.initialize` |
| `authenticate` | ✅ | `authenticateAcpAgent` |
| `session/new` | ✅ | `#createSession` / `runAcpAgent` / `probeAcpAgentCapabilities` |
| `session/load` | ✅ | `#restoreSession` / `restoreAcpAgentSession` / `AcpRestoredConversation.restore` |
| `session/resume` | ✅ | `#restoreSession` / `restoreAcpAgentSession` / `AcpRestoredConversation.restore` |
| `session/prompt` | ✅ | `#prompt` / `runAcpAgent` / `AcpRestoredConversation.prompt` |
| `session/cancel` | ✅ | prompt abort handling |
| `session/close` | ✅ | session/client close paths |
| `session/set_mode` | ✅ | `applyPerRequestOverrides` |
| `session/set_config_option` | ✅ | `applyPerRequestOverrides` |
| `session/list` | ❌ 未调用 | — |
| `logout` | ❌ 未调用 | — |

## Client 端处理器(agent → client 调用)

| ACP 方法 | 实现 | 位置 |
|---|---|---|
| `session/update` | ✅ | `AcpClientHandlers.sessionUpdate` |
| `session/request_permission` | ✅ | `AcpClientHandlers.requestPermission` |
| `fs/read_text_file` | ✅ | `AcpClientHandlers.readTextFile` |
| `fs/write_text_file` | ✅ | `AcpClientHandlers.writeTextFile` |
| `terminal/create` | ✅ | `AcpClientHandlers.createTerminal` |
| `terminal/output` | ✅ | `AcpClientHandlers.terminalOutput` |
| `terminal/wait_for_exit` | ✅ | `AcpClientHandlers.waitForTerminalExit` |
| `terminal/kill` | ✅ | `AcpClientHandlers.killTerminal` |
| `terminal/release` | ✅ | `AcpClientHandlers.releaseTerminal` |
| `elicitation/create` | ✅ | `AcpClientHandlers.unstable_createElicitation` |
| `elicitation/complete` | ✅ | `AcpClientHandlers.unstable_completeElicitation` |

## `terminal/*` 概念解释

ACP 里 agent 想执行终端命令有**两条独立路径**:

### 路径 A:agent 自己执行(不需要 ACP terminal/*)

agent 进程自己用 `child_process.spawn` 跑命令,这是 OS 能力,与 ACP 协议无关。Claude Code、Codex CLI 等内部都有自己的 Bash 工具。命令结果通过 `session/update` 作为 tool_call 推给 client 展示。**99% 的场景走这条路。**

### 路径 B:agent 委托 client 执行(`terminal/create`)

agent 主动请求 client 代跑命令。目的有三:

1. 让命令出现在用户的 IDE terminal pane(VS Code `Ctrl+\`` 那块面板、Zed/Cursor 底部 terminal tab 等),用户可围观、可 Ctrl+C、可输入密码
2. 借用 client 的真实 shell 环境(用户的 PATH、虚拟环境、SSH key、登录态)
3. 跑长任务时 agent 不必阻塞 —— 先 `create` 拿 id,再异步 `wait_for_exit` / `output` 轮询

时序:

```
1. client → agent: initialize { clientCapabilities: { terminal: true } }
2. (后续某次 prompt 中)
   agent → client: terminal/create { command: "npm test", cwd: "..." }
   client          : 启动进程,渲染到 UI,返回 { terminalId: "t-1" }
   agent → client: terminal/wait_for_exit { terminalId: "t-1" }
   agent → client: terminal/output { terminalId: "t-1" }
   agent → client: terminal/release { terminalId: "t-1" }
```

| | 谁的进程在跑命令 | 用户能看到实时输出 | 用户能交互 |
|---|---|---|---|
| 路径 A | agent 进程的子进程 | 只是 agent 转发的文本 | 否 |
| 路径 B | client 进程的子进程 | Specflow run log / terminal event stream | 当前命令执行面不可交互；auth terminal 是独立流程 |

### 关键点

- `terminal/create` **不是开关** —— 它不存在不阻止 agent 用路径 A 自己跑命令
- 它是**可选的协议特性**,只是另一种执行方式
- "显示给用户看"只是其中一个目的,还包括环境一致性和用户交互

## 本项目如何处理 `terminal/*`

agent-proxy 当前在 `initialize` 中声明 `clientCapabilities.terminal: true`,并实现 `terminal/create` / `output` / `wait_for_exit` / `kill` / `release`。agent 请求 client 代跑命令时,Specflow 会用 Bun 子进程执行:

- `cwd` 必须位于 workflow `cwd` 或 agent server 的 `additionalDirectories` 内。
- stdout/stderr 会进入 workflow terminal event stream 和 run log。
- `terminal/output` 返回累计输出,并按 ACP 请求中的 `outputByteLimit` 做截断。
- `release` 会 kill 子进程并删除本地 terminal 记录。

这仍然不阻止 agent 使用路径 A 自己 spawn 命令。两种路径可以共存:agent 自己执行的结果通常会作为 `session/update` 里的 tool call 文本出现;agent 委托 Specflow 执行的命令会额外产生真实 terminal 事件。

Specflow 也声明 `auth.terminal: true` 与 `_meta["terminal-auth"]`,用于 ACP auth 方法发现和浏览器可见的 terminal auth 流程。

## 数据结构覆盖

### `SessionUpdate` 变体处理([events.ts](../../../packages/agent-proxy/src/runtimes/acp/events.ts))

agent-proxy 自己**只对 `agent_message_chunk` 做特殊处理**(把 text 追加到输出流);其余变体全部通过 `onSessionUpdate` 回调原样转给上层调用方(bridge / 业务层)。

| 变体 | proxy 自身处理 | 透传给上层 |
|---|---|---|
| `agent_message_chunk` | ✅ 追加到 stdout | ✅ |
| `user_message_chunk` | — | ✅ |
| `agent_thought_chunk` | — | ✅ |
| `tool_call` / `tool_call_update` | — | ✅ |
| `plan` | — | ✅ |
| `available_commands_update` | — | ✅ |
| `current_mode_update` | — | ✅ |
| `config_option_update` | — | ✅ |
| `session_info_update` | — | ✅ |

设计意图:proxy 是协议传输层,UI/状态语义由上层决定。

### 透传项(proxy 不做语义处理,直接转发)

- **`McpServer`**(stdio / http / sse 三种 transport) — proxy 不校验类型,从 client 请求里取 `mcpServers` 数组原样传给 agent。三种 transport 是否被支持由具体 agent 的 `mcpCapabilities` 决定。
- **`StopReason`**(end_turn / max_tokens / max_turn_requests / refusal / cancelled) — 从 agent 响应里取出直接回传上层,proxy 不做分支处理。
- **`ContentBlock`** 各变体 — 见 `preparePromptBlocks`,会根据 agent 的 `promptCapabilities` 过滤(audio / image / embeddedContext)。

### 未使用的扩展机制

- `ExtRequest` / `ExtResponse` / `ExtNotification` — ACP 提供的自定义扩展通道,本项目未启用。

## Capability 探测与缓存

agent 在 `initialize` advertise `agentCapabilities`,在 `session/new` 响应里 advertise `modes` / `configOptions`,在 `available_commands_update` 通知里 advertise slash commands。Specflow 会持久化这些运行时探测结果,供 UI 和后续请求校验使用:

- **存储**:`.aflow/.specflow/cache/agents/capabilities.json`,由 [AgentServerStore](../../../packages/agent-proxy/src/store/agent-server-store.ts) 读写。结构 `AgentServerCapabilitiesCache`:`agentCapabilities` / `modes` / `configOptions` / `availableCommands` + `installedVersion` + `probedAt`。
- **写入时机**:[connection.ts](../../../packages/agent-proxy/src/runtimes/acp/connection.ts) 中 `AcpAgentConnection.#createSession` 与独立 `runAcpAgent` 成功创建 session 后,通过 `onCapabilities` 回调写入;`available_commands_update` 到达时重写一次以补全命令列表。
- **失效**:读取时对比缓存的 `installedVersion` 与当前解析出的版本,不一致则视为失效(返回 undefined),适配 registry agent 升级。custom / headless agent 不 pin 版本,改了 env / args 不会自动失效 —— 需手动 refresh。
- **手动 refresh**:`probeAcpAgentCapabilities` 启动一次性 `initialize + newSession + closeSession` 探测连接,等待最多 750ms 收集 `available_commands_update`。
- **API**:`GET /api/agent-servers/:id/capabilities`(404 表示未探测过)、`POST /api/agent-servers/:id/capabilities/refresh`(见 [api.ts](../../../packages/server/src/api.ts))。

## Per-node ACP overrides

节点级别可覆盖 ACP 的 mode / model / 其他 configOption;session 级别可配置 MCP。字段范围:

| 字段 | step 节点 | gate 节点 | 存储位置 |
|---|---|---|---|
| `modeId` | ✅ | ❌(YAML 校验报错) | `AgentNode.modeId` |
| `configOptions`(含 `model`、`thought_level` 等) | ✅ | ✅ | `AgentNode` / `GateNode.configOptions` |
| `mcpServers`(JSON 字符串) | session 级 | session 级 | `WorkflowSession.mcpServers` |

**优先级与 stickiness**:`applyPerRequestOverrides`([connection.ts](../../../packages/agent-proxy/src/runtimes/acp/connection.ts))在每个 prompt turn 之前运行。

- `request.modeId` 提供 → 先按 agent 广告的 mode 列表校验,再调用 `setSessionMode`。
- `request.configOptions` 中的每个 key 都会校验是否存在于 agent 广告的 `SessionConfigOption` 列表中,再调用 `setSessionConfigOption`。`model` 当前也按普通 config option 处理。
- **未提供则不调用** set* —— 同一 session 跨多节点时,前一节点设过的 mode/config 会**保持**(executor 仅在 `node.modeId` / `node.configOptions` 存在时才透传)。这就是"节点未配置 = 沿用上次"的语义来源。

## MCP 配置

- session 的 `mcpServers` 字段是一段 **JSON 字符串**(ACP `McpServer[]`),存在 workflow YAML 的 `sessions.<id>.mcpServers`。选这个形态是为了与 ACP schema 1:1,且方便从 Claude Desktop / Cursor 等复制粘贴。
- 解析与校验:YAML 解析时([agentflow-source.ts](../../../packages/server/src/agentflow-source.ts))做 JSON 有效性 + 数组形状检查;executor 边界([executor.ts](../../../packages/bridge/src/execution/executor.ts) `parseMcpServersField`)再 parse 一次塞进 `AgentRunRequest.mcpServers`。
- 透传到 ACP 的 `session/new` / `load` / `resume`(本来就支持,见上文 MCP 章节)。MCP 仍是 session 级,不可中途更改。

## Skills + Slash command

详见 [skills-and-slash.md](./skills-and-slash.md)。摘要:

- 从 `~/.agents/skills/<name>/SKILL.md`(global)与 `<repo>/.agents/skills/<name>/SKILL.md`(projectLocal)加载 skills,projectLocal 优先。
- prompt 中的 `/skill` 在 executor 发送前由 `resolveSlashCommands` 替换为 XML 包装的 skill body;`available_commands` 与未知命令原样透传给 agent。
- UI 在写 prompt 时实时校验 slash command,不能解析则在输入框下方红色警告(不阻塞发送)。

## 已知缺口

- `session/list` 未调用 — 不支持枚举 agent 已有会话(对应 `SessionCapabilities.list` 能力即使被 agent advertise 也用不到)
- `logout` 未调用 — 仅支持 authenticate 流程,登出靠外部清理凭证(对应 `AgentAuthCapabilities.logout` 能力被忽略)
- `terminal/*` 已实现,但不是浏览器内的交互式 shell。它是 agent 通过 ACP 请求 Specflow 代跑命令的 subprocess surface;用户交互式终端能力目前只用于 auth terminal 流程。
- **MCP prompt slash 分支**(`/<server>.<prompt>`)未实现 —— agent-proxy 不直接连 MCP server,v1 作为 passthrough,见 skills-and-slash.md
- **Capability 缓存粒度** 仅按 `installedVersion` 失效;改 env / args 需手动 refresh
