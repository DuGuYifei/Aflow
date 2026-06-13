---
title: Workflow YAML v2 编写教程
description: 学习如何用显式 start、全局变量、自动派生循环和 gate branch 次数上限编写 Specflow agentflow v2 YAML。
category: tutorial
order: 1
updatedAt: "2026-06-13 06:27:21 CEST"
tags:
  - workflow
  - yaml
  - agentflow
---

# Workflow YAML v2 编写教程

Specflow 的可提交 workflow-as-code 文件保存在 `.aflow/.specflow/agentflow/agentflows/*.yaml`。
本地草稿、fork/adapt 变体和实验 workflow 应保存在 `.aflow/.specflow/agentflow/agentflows-local/*.yaml`；这个目录默认不会提交。
每个 YAML 文件描述一个可运行的工作流图：sessions、全局运行变量、显式 start 节点、step 节点、gate 节点、end 节点和 edges。

workflow 文件名会成为 workflow id。文件名应使用小写 kebab-case，例如 `code-review-flow.yaml`。
session、node、branch 的 key 也遵循同一规则：必须以小写字母开头，只能包含小写字母、数字和 `-`。

## 最小示例

```yaml
version: 2
name: Code review flow

variables:
  specflow_task:
    title: Task
    description: The request, ticket, or business goal.
    required: true

sessions:
  builder:
    agentServerId: codex-acp
  reviewer:
    agentServerId: claude-acp

nodes:
  start:
    kind: start
    title: Start

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
        maxTraversals: 2

  done:
    kind: end
    title: Done

edges:
  - from: start
    to: plan
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
```

## 顶层字段

`version`：新建 workflow 必须写 `2`。

`name`：Specflow 中展示的 workflow 名称。

`variables`：顶层运行变量 map。任何 step 或 gate 都可以用类似 XML 的 token 直接引用，例如 `<specflow_task>`。

`sessions`：逻辑 agent 上下文。引用同一个 session 的 step 会共享对话上下文。
每个 session 应定义 `agentServerId`，它指向 `.aflow/.specflow/agent-servers.json` 中的 agent server 条目。

`nodes`：工作流图节点。v2 YAML 支持 `start`、`step`、`gate` 和 `end`。

`edges`：节点之间的有向连接。edge id 会根据 `from`、`branch` 和 `to` 自动生成，不需要手写。

## Variables

运行时需要用户提供或配置的值，统一写在顶层 `variables`。
变量名必须匹配 `specflow_[A-Za-z0-9_]+`。

```yaml
variables:
  specflow_task:
    title: Task
    description: The request, ticket, or business goal.
    required: true
    defaultValue: Fix the failing login test.
```

prompt 和 gate criteria 可以用 token 引用变量：

```yaml
prompt: |
  Implement this request:
  <specflow_task>
```

如果 `required: true` 且没有 `defaultValue`，Aflow 和 Specflow run 配置会在运行前询问变量值。

v2 不要创建 `kind: input` 节点。input node 只用于 v1 兼容。

## Start 节点

用 `kind: start` 声明显式入口。

```yaml
nodes:
  start:
    kind: start
    title: Start

edges:
  - from: start
    to: plan
```

start 节点只是控制入口，不会启动 agent，也不会传递内容。

可以有多个 start 节点来表达并行启动，但多个 start 的目标 step 不能使用同一个 session。这样可以避免在同一个会话里同时发起两个独立 prompt。

start edge 必须指向 step。edge 不能指向 start 节点。

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
- `pauseAfterRun: true` 会在节点执行后暂停，方便人工检查或继续。当前 `specflow run` CLI 不支持交互式 pause；需要 pause/continue 时应通过 UI/server 或 Aflow run 路径运行。
- `paths` 用于关联文件或目录。
- `images` 用于关联图片资源，每项包含 `path`，以及可选的 `label`、`mimeType`。
- `modeId` 会在该节点 prompt 执行前设置 ACP session mode。
- `configOptions` 会传入 Agent 支持的 ACP 配置覆盖项，值只能是字符串或布尔值。

## Gate 节点

当 workflow 需要根据上游上下文选择分支时，用 `kind: gate`。

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
        maxTraversals: 2
```

每个 gate 都必须至少定义一个 branch。
每条从 gate 出发的 edge 都必须指定 `branch`。
Gate 节点可以定义 `configOptions`，但不能定义 `modeId`。

重试次数限制写在 gate branch 的 `maxTraversals` 上。v2 中 `maxTraversals` 属于 branch，不属于 edge。

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
来自 start、指向 gate、或指向 end 的 edge 也不要写传递字段。

v2 YAML 不要写 `loopback`，也不要在 edge 上写 `maxTraversals`。

## 循环

v2 的循环是正常的图结构。作者用普通 edge 加有上限的 gate branch 表达循环；Specflow 会在 validation/runtime 派生 loop-closing edge，用于运行和 UI 高亮。

```yaml
nodes:
  verdict:
    kind: gate
    title: Review verdict
    decisionCriteria: Choose pass or rework.
    branches:
      pass:
      rework:
        label: needs rework
        maxTraversals: 2

edges:
  - from: verdict
    branch: rework
    to: implement
```

循环校验要求每个成环的强连通分量包含 gate，并且只有一个入口。停留在循环内部的 gate branch 必须定义 `maxTraversals`。

UI 会用特殊颜色高亮派生出来的 loop-closing edge。你不需要运行额外的 loop-detect 命令，也不需要手写 `loopback`。

## 校验清单

运行 workflow 前，先检查这些规则：

- 去掉 `.yaml` 后的文件名匹配 `[a-z][a-z0-9-]*`。
- `version` 是 `2`。
- 文件包含 `sessions`、`nodes` 和 `edges`。
- 至少有一个 `start` 节点。
- start edge 指向 step。
- 多个 start 节点不能指向同一个 session 的 step。
- `variables` 名称以 `specflow_` 开头。
- 没有节点使用 `kind: input`。
- 每个 session 在运行前都有 `agentServerId`。
- 每个 `step.session` 都引用已存在的 session。
- 每个 `gate` 都定义了 branches，且每条从 gate 出发的 edge 都选择了一个 branch。
- edge 不指向 `start` 节点，也不从 `end` 节点出发。
- 使用 `transmit: true` 时必须同时提供 `outputTag`。
- edge 不定义 `loopback` 或 `maxTraversals`。
- 控制循环的 gate branch 定义正整数 `maxTraversals`。

校验 workflow：

```sh
specflow validate .aflow/.specflow/agentflow/agentflows/code-review-flow.yaml
```

`validate` 只解析 YAML 并校验 workflow 图，不会启动 agent。

更多 Specflow 命令说明见 [Specflow 命令](specflow-command.md)。
