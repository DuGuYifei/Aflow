---
title: "已废弃：Workflow YAML v1 编写教程"
description: Specflow agentflow YAML 的 v1 兼容参考。新 workflow 应使用 version 2。
category: tutorial
order: 99
updatedAt: "2026-06-13 06:27:21 CEST"
tags:
  - workflow
  - yaml
  - agentflow
---

# 已废弃：Workflow YAML v1 编写教程

本页记录旧版 `version: 1` workflow 格式。新 workflow 应使用 [Workflow YAML v2 编写教程](write-workflow-yaml-v2.md)。v1 仍可兼容读取；在 Specflow UI 中打开 v1 workflow 时，会建议使用 Aflow Agent 迁移。

Specflow 的可提交 workflow-as-code 文件保存在 `.aflow/.specflow/agentflow/agentflows/*.yaml`。
本地实验、fork/adapt 草稿应保存在 `.aflow/.specflow/agentflow/agentflows-local/*.yaml`；这个目录会写入 `.aflow/.specflow/.gitignore`，默认不提交。
每个 YAML 文件描述一个可运行的工作流图，包括 sessions、nodes、edges，以及可选的运行输入。
浏览器画布坐标单独保存在 `.aflow/.specflow/agentflow/canvas/*.json`，因此手写 YAML 时不需要维护节点位置。

workflow 文件名会成为 workflow id。文件名应使用小写 kebab-case，例如 `code-review-flow.yaml`。
session、node、branch 的 key 也遵循同一规则：必须以小写字母开头，只能包含小写字母、数字和 `-`。

改写已有 workflow 时，如果目标是为当前用户或当前问题创建一个变体，应先把源 YAML 复制到 `.aflow/.specflow/agentflow/agentflows-local/<new-workflow-id>.yaml`，再修改副本。不要直接覆盖源 workflow，除非明确是在维护团队共享版本。

## 最小示例

```yaml
version: 1
name: Code review flow

sessions:
  builder:
    agentServerId: codex-acp
  reviewer:
    agentServerId: claude-acp

nodes:
  plan:
    kind: step
    title: Plan the change
    session: builder
    prompt: |
      Read <specflow_task>.
      Produce a short implementation plan with files, risks, and checks.

  implement:
    kind: step
    title: Implement
    session: builder
    prompt: |
      Implement the approved plan.
      Keep the change focused and report the commands you ran.
    paths:
      - src/
      - tests/

  review:
    kind: step
    title: Review
    session: reviewer
    prompt: |
      Review <specflow_change_summary>.
      Focus on bugs, regressions, and missing tests.

  verdict:
    kind: gate
    title: Review verdict
    decisionCriteria: |
      Choose pass only if the change is ready.
      Choose rework if the implementation needs another edit pass.
    branches:
      pass:
      rework:
        label: needs rework
        description: Send the workflow back to implementation.

  done:
    kind: end
    title: Done

edges:
  - from: plan
    to: implement
  - from: implement
    to: review
    transmit: true
    outputTag: change_summary
    handoffPrompt: Summarize the implementation diff and verification results for review.
  - from: review
    to: verdict
  - from: verdict
    branch: pass
    to: done
  - from: verdict
    branch: rework
    to: implement
    loopback: true
    maxTraversals: 2
```

## 顶层字段

`version` 必须是 `1`。

`name` 是 Specflow 中展示的工作流名称。

`sessions` 定义逻辑会话。引用同一个 session 的 step 会共享上下文。
每个 session 应定义 `agentServerId`，它指向 `.aflow/.specflow/agent-servers.json` 中的 agent server 条目。
如果需要给 agent 配置 MCP，也可以设置 `mcpServers`，它是一个 JSON 字符串，内容应为 MCP server 对象数组。

`nodes` 定义工作流图节点。YAML 支持 `input`、`step`、`gate` 和 `end` 四类节点。
其中只有 `step` 和 `gate` 会成为运行时节点；`input` 用于提供变量，`end` 用于在画布中标记流程结束。

`edges` 定义节点之间的有向连接。edge id 会根据 `from`、`branch` 和 `to` 自动生成，不需要手写。

`variables` 是可选的变量记录列表。运行时 prompt 替换主要由 `input` 节点驱动；如果某个值需要在运行时传入，优先使用 `input` 节点。

## Step 节点

用 `kind: step` 表示一次 Agent 工作。

```yaml
nodes:
  write-spec:
    kind: step
    alias: "01"
    title: Write spec
    session: writer
    prompt: |
      Convert <specflow_task> into a concise implementation spec.
    pauseAfterRun: true
    paths:
      - docs/
    images:
      - path: .aflow/.specflow/agentflow/assets/wireframe.png
        label: wireframe.png
        mimeType: image/png
    modeId: plan
    configOptions:
      model: preferred-model
      thought_level: high
```

常用字段：

- `session` 必须引用一个已存在的 session key。
- `prompt` 是发送给 Agent 的指令。
- `pauseAfterRun: true` 会在节点执行后暂停，方便人工检查后 Play 同一个 run。当前 `specflow run` CLI 不支持交互式 Pause/Play；包含 pause 节点的 workflow 会在启动 agent 前被拒绝运行，需要人工运行控制时应通过 UI/server 路径运行。
- `paths` 用于关联文件或目录。
- `images` 用于关联图片资源，每项包含 `path`，以及可选的 `label`、`mimeType`。
- `modeId` 会在该节点 prompt 执行前设置 ACP session mode。
- `configOptions` 会传入 Agent 支持的 ACP 配置覆盖项，值只能是字符串或布尔值。

## Gate 节点

当工作流需要根据上游输出选择分支时，用 `kind: gate`。

```yaml
nodes:
  quality-check:
    kind: gate
    title: Quality check
    decisionCriteria: |
      Choose pass when the answer is complete and verified.
      Choose revise when important issues remain.
    branches:
      pass:
      revise:
        label: revise
        description: Return to the previous work step.
```

workflow 运行前，每个 gate 都必须至少定义一个 branch。
每条从 gate 出发的 edge 都必须指定 `branch`。
Gate 节点可以定义 `configOptions`，但不能定义 `modeId`。

## Input 节点

当 workflow 需要从运行命令或 UI 接收值时，用 `kind: input`。
input 的 `variableName` 必须匹配 `specflow_[A-Za-z0-9_]+`。

```yaml
nodes:
  task-input:
    kind: input
    title: Task
    variableName: specflow_task
    description: The user request or ticket text.
    required: true
```

prompt 和 gate criteria 可以用类似 XML 的 token 引用输入值：

```yaml
prompt: |
  Implement this request:
  <specflow_task>
```

通过 CLI 运行时，可以用 `-D` 传值：

```sh
specflow run .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml -Dtask="Fix the failing login test"
```

## Edges 与上下文传递

普通 edge 只控制执行顺序：

```yaml
edges:
  - from: plan
    to: implement
```

当两个 step 使用不同 session，且下游 prompt 需要上游输出时，需要开启传递：

```yaml
edges:
  - from: implement
    to: review
    transmit: true
    outputTag: change_summary
    handoffPrompt: Summarize the implementation diff and test results.
```

这会让传递内容在目标 prompt 中以 `<specflow_change_summary>` 的形式可用。
`outputTag` 必须是 XML-safe 的标签名，`handoffPrompt` 可选。

同一个 session 内的 edge 不要写传递字段，因为下一个 step 已经拥有同一段会话上下文。
指向 gate、来自 input、或指向 end 的 edge 也不要写传递字段。

## 循环

循环必须显式标记为 loopback，并且必须由某个 gate branch 控制。

```yaml
edges:
  - from: verdict
    branch: rework
    to: implement
    loopback: true
    maxTraversals: 2
```

`maxTraversals` 只允许写在从 gate 出发的 edge 上，并且必须是正整数。
它适合用来限制 review 到 rework 这类重试路径的次数。

## 校验清单

运行 workflow 前，先检查这些规则：

- 去掉 `.yaml` 后的文件名匹配 `[a-z][a-z0-9-]*`。
- `version` 是 `1`。
- 文件包含 `sessions`、`nodes` 和 `edges`。
- 每个 session 在运行前都有 `agentServerId`。
- 每个 `step.session` 都引用已存在的 session。
- 每个 `gate` 都定义了 branches，且每条从 gate 出发的 edge 都选择了一个 branch。
- edge 不指向 `input` 节点，也不从 `end` 节点出发。
- 非 loopback edge 构成的图没有环。
- 使用 `transmit: true` 时必须同时提供 `outputTag`。
- `input.variableName` 以 `specflow_` 开头，并且在 workflow 内唯一。

校验 workflow：

```sh
specflow validate .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`validate` 只解析 YAML 并校验 workflow 图，不会启动 agent。

更多specflow命令说明见 [Specflow 命令](specflow-command.md)。
