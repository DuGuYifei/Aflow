---
title: Aflow Agent 使用教程
description: 学习如何用 Aflow Agent 创建、改写、校验、运行和继续 Specflow workflows。
category: tutorial
order: 4
updatedAt: "2026-06-16 00:00:00 CEST"
tags:
  - aflow
  - agent
  - workflow
---

# Aflow Agent 使用教程

Aflow Agent 是 Specflow 的终端工作流 Agent。它运行在项目目录中，通过对话理解业务目标，帮助你创建 workflow、基于已有 workflow fork/adapt 出本地变体、校验 YAML、运行 workflow，并在运行结束后继续进入某个节点对应的 agent session。

和直接使用 `specflow run` 不同，Aflow 的重点是交互式协作。它会在缺少必要信息时询问用户，在 workflow 运行前逐个收集 required 变量，并在运行过程中把节点状态、pause 交互、workflow continuation 和 session resume 放在同一个 TUI 里。

Aflow 不要求用户必须记住 slash command。只要你在聊天中表达出“想把这个过程沉淀成 workflow”、“想用 Specflow 跑一套流程”、“基于某个通用 workflow 改成当前业务版本”等意图，Aflow 就可以理解目标，并自行调用 workflow 工具完成创建、复制、改写或校验。

## 启动 Aflow

无参数启动 Aflow：

```sh
aflow
```

Aflow 会直接进入 agent TUI。

如果只想打开浏览器 workspace UI，不启动 Aflow agent 对话，使用：

```sh
specflow
```

Designer UI 由同一个 Specflow server 提供，路径是 `/design`；先启动 `specflow`，再打开打印出来的 server URL 加 `/design`。

## Aflow 特有能力

### 对话创建 workflow

在 Aflow 里输入：

```text
/specflow-create
```

Aflow 会先理解你的业务目标、需要使用的 agent、输入输出、分支判断和人工交互点。信息不足时，它会通过 TUI 询问用户，而不是直接猜一个 workflow。

更常见的使用方式是先正常聊天，让 Aflow 理解业务背景、约束、已有工具、团队流程和你希望复用的通用 workflow。等目标变清楚后，你可以明确说“把它创建成 workflow”，或让 Aflow 基于某个已有 workflow 做一个适配当前业务的本地版本。

创建出来的 workflow 会写入 `.aflow/.specflow/agentflow/agentflows-local/`，适合作为当前项目或当前用户的本地草稿。确认要成为团队共享 workflow 后，再移动到 `.aflow/.specflow/agentflow/agentflows/`。

### Fork/adapt 现有 workflow

在 Aflow 里输入：

```text
/specflow-fork-adapt
```

Aflow 会读取已有 workflow，先复制一份新的 YAML 到 `.aflow/.specflow/agentflow/agentflows-local/`，再修改副本来适配新目标。它不应该直接覆盖源 workflow，除非用户明确要求维护团队共享版本。

适合 fork/adapt 的场景包括：

- 把通用代码审查 workflow 改成当前项目的发布审查 workflow。
- 把已有 frontend workflow 改成 backend、docs 或测试专项 workflow。
- 为某个临时任务创建带有本地 prompt、路径和 agent 选择的变体。

### 校验 workflow

在 Aflow 里输入：

```text
/specflow-validate
```

Aflow 会根据上下文推断要校验哪个 workflow。缺少路径或 workflow id 时，它会询问用户。校验会检查 YAML 结构、variables、节点边关系、agent server 引用，以及 pause 节点是否使用了可交互 agent。

### 运行 workflow

在 Aflow 里输入：

```text
/specflow-run
```

Aflow 会通过 Specflow server 跑 workflow。运行前它会先校验 workflow；如果 workflow 有 required variables，Aflow 会逐个询问输入值。

运行过程中，TUI 会显示每个节点的简要状态，并优先显示 node title，便于用户理解当前跑到哪个业务步骤。节点完成、失败、跳过、等待人工交互时，Aflow 会把状态更新回当前界面。

在有 TUI 时，`/specflow-run` 会询问使用 `Normal run` 还是 `Dynamic run`。默认是 `Normal run`。`Dynamic run` 会在每次 activation 后暂停，让 Aflow 读取刚完成节点的文本输出；只有当它明确发现业务目标偏离、必要信息缺失、分支可能错误或后续会发生可避免失败时，才会 patch 本次 run 的 snapshot 后继续。Dynamic patch 不会修改已保存的 workflow YAML/canvas。

当 Dynamic run 成功结束时，Aflow 会先询问是否把最终 run snapshot 保存成一个新的本地 workflow，然后再进入 run 结束后的 session 选择器。保存会基于最终 snapshot 新建 workflow，不会覆盖原始 workflow。

### Pause 节点交互

当 workflow 跑到 `pauseAfterRun: true` 的节点时，Aflow 会把界面切到该节点的 ACP 交互 TUI。这个界面会保留必要的 workflow 信息，并显示最近的上下文消息，方便用户知道 agent 前面做了什么。

用户可以在 pause 界面里继续给该 agent 发消息，也可以确认继续 workflow。适合需要人工确认、补充业务判断、检查中间产物的节点。

### Continue workflow run

在 Aflow 里输入：

```text
/specflow-continue
```

这个命令会从 stopped 或 failed 的源 run 创建一个 continuation run。Aflow 会从 Specflow server 读取 run 状态，必要时修复陈旧的 running/stopped 状态，并从可恢复的位置继续。

### 恢复节点 agent session

在 Aflow 里输入：

```text
/specflow-resume-session
```

这个命令用于进入某次 workflow run 中某个节点对应的 agent session。Aflow 会列出可恢复的 session，并显示 session id、agent、node title 和推荐操作。

常见选择包括：

- 用 ACP 在 Aflow 内继续该 session。
- 在 Aflow 的终端界面中启动该 agent 的原生命令。
- 只显示推荐的原生 resume 命令，让用户自己在额外 terminal 中执行。
- 跳过本次恢复。

如果某个 custom agent 没有明确的原生 resume 方案，Aflow 不会假装能恢复它，只会显示 session 信息或尝试 ACP 路径。

### Run 结束后的 session 选择

workflow run 结束后，如果本次 run 记录到了 agent session，Aflow 会在 TUI 中列出这些 session，让用户选择是否进入某个节点对应的代码工具继续工作。对于 Dynamic run，可选的最终 snapshot 保存询问会先于这个 session 选择器出现。列表会尽量显示 node title、session id、agent server 和 agent 类型，避免用户只能凭一串 id 判断。

每个 session 通常会提供这些选项：

- `ACP Resume`：在 Aflow 内通过 ACP 继续该 session。
- `ACP Inspect`：在 Aflow 内查看该 session，不一定继续发送新任务。
- `Native CLI in Aflow terminal`：在当前 Aflow 终端中启动该 agent 的原生命令；原生命令退出后回到 Aflow。
- `Show native resume command`：只展示推荐命令，适合用户想在额外 terminal 中自己执行。
- `Skip`：不进入任何 session。

如果 Aflow 没有验证过某个 agent 的原生 resume 方式，它仍会展示已记录的 session id 和节点信息，但不会编造原生命令。custom agent server 默认属于这种情况；它可以走 ACP Resume/Inspect，或由用户根据自己的 agent 命令手动恢复。

### 已知原生 resume 命令

Aflow 的原生命令推荐来自内置 adapter 表。`{sessionId}` 会替换成该 run 记录到的 session id；如果 agent 的原生命令使用的是另一套 native thread/checkpoint id，Aflow 会显示 caveat。

| Agent | 推荐命令 |
| --- | --- |
| Amp | `amp threads continue {sessionId}`，但 Amp 使用 thread id，ACP session id 可能不等于 native thread id。 |
| Auggie | `auggie --resume {sessionId}`，没有 session id 时可尝试 `auggie session resume`。 |
| Autohand | `autohand resume {sessionId}`。 |
| Claude | `claude --resume {sessionId}`，没有 session id 时 `claude --resume` 可打开原生选择器。 |
| Cline | `cline --id {sessionId}`。 |
| Codebuddy | `codebuddy --resume {sessionId}`。 |
| Codex | `codex resume {sessionId}`，没有 session id 时可尝试 `codex resume`。 |
| Cortex | `cortex --resume {sessionId}`。 |
| Cursor Agent | `cursor-agent --resume {sessionId}`，但 Cursor thread id 可能不同于 ACP session id。 |
| DeepAgents | `dcode --resume {sessionId}`。 |
| DimCode | `dim exec resume {sessionId}`，没有 session id 时可尝试 `dim exec resume --last`。 |
| Factory Droid | `droid --resume {sessionId}`。 |
| fast-agent | `fast-agent go --resume {sessionId}`，没有 session id 时可尝试 `fast-agent go --resume latest`。 |
| Gemini CLI | `gemini --resume {sessionId}`，没有 session id 时可尝试 `gemini --resume`。 |
| GitHub Copilot | `copilot --resume={sessionId}`，没有 session id 时可尝试 `copilot --resume`。 |
| Goose | `goose session --resume {sessionId}`。 |
| Grok | `grok --resume {sessionId}`。 |
| Junie | `junie --session-id {sessionId}`，也可在原生 TUI 中使用 `/history`。 |
| Kilo | `kilo --continue {sessionId}`。 |
| Kimi | `kimi --resume {sessionId}`。 |
| Minion | `minion-code main --resume {sessionId}`。 |
| Mistral Vibe | `vibe --resume {sessionId}`。 |
| Nova | `nova start --continue {sessionId}`。 |
| OpenCode | `opencode --session {sessionId}`；OpenCode 也支持 `--continue`，有明确 native session id 时优先使用 `--session`。 |
| Poolside | `pool --resume {sessionId}`。 |
| Qoder | `qodercli --resume {sessionId}`。 |
| Qwen Code | `qwen --resume {sessionId}`。 |
| Stakpak | `stakpak -c {sessionId}`，这里的 id 必须是 checkpoint id。 |
| VT Code | `vtcode --resume {sessionId}`。 |

另外，GLM 和 Pi 当前按 ACP-only 处理；Dirac 目前只记录为原生历史选择器能力，不推荐直接 resume 命令；Agoragentic 和 siGit 的原生恢复方式仍标记为 unknown。

### Workflow 工具

Aflow 的 tool 能读取、创建、复制、校验、运行和继续 workflow。模型只有在确实需要完成用户目标时才应该写 workflow；如果只是解释语法、查看已有配置或回答问题，应优先读取和说明，不要无理由创建新文件。

## 通用 Pi 能力

通用终端 Agent 能力来自 Pi。Pi 文档入口：<https://pi.dev/docs/latest>。

Aflow 保留 Pi coding-agent harness 的大部分基础能力，因此它不只是 workflow runner，也可以作为普通终端 coding agent 使用。

### 文件和命令

Aflow 可以读取项目文件、编辑文件、创建新文件、运行 shell 命令，并把结果用于后续推理。你可以让它分析代码、修复问题、生成文档、整理配置或解释项目结构。

### 会话能力

Aflow 支持 Pi 的会话模型，包括继续已有会话、fork 会话、查看 session 信息、压缩上下文和按需恢复历史对话。常见能力包括：

- 使用 CLI 参数恢复或指定 session。
- 在 TUI 中通过 slash command 管理 session。
- 在长对话中压缩旧上下文，保留关键进展。

### Skills、extensions 和 themes

Aflow 继承 Pi 的 skills、extensions 和 themes 机制。Skills 用来给 Agent 提供按需加载的专门能力；extensions 可以添加工具、命令、事件处理和自定义 TUI；themes 用于调整终端界面风格。

Pi 的扩展开发文档见：<https://pi.dev/docs/latest/extensions>。

### 模型和认证

Aflow 支持 Pi 的 provider、model、login、settings 等通用配置路径。可以通过环境变量、认证命令或 settings 选择模型和 provider。

Pi 的模型与配置文档见：<https://pi.dev/docs/latest/models>。

## 一个典型流程

```text
/specflow-create
```

先和 Aflow 说明目标，例如“我想做一个前端 ticket 从理解需求、实现、review 到补充文档的 workflow”。

```text
/specflow-validate
```

确认新建的 YAML 能被 Specflow 解析和运行。

```text
/specflow-run
```

运行 workflow。Aflow 会询问缺失变量，显示节点状态，并在 pause 节点让你进入对应 agent。

```text
/specflow-resume-session
```

运行结束后，如果想继续查看或修改某个节点 agent 的产物，可以选择对应 session 继续。
