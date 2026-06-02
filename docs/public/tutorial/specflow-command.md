---
title: Specflow 命令
description: 学习 specflow、specflow validate 和 specflow run 的用途与输入规则。
category: tutorial
order: 2
tags:
  - cli
  - command
  - workflow
---

# Specflow 命令

## 启动 UI

```sh
specflow
```

不带参数时，Specflow 会启动 server 和浏览器 UI。

## 校验 workflow

```sh
specflow validate .aflow/.specflow/agentflows/code-review-flow.yaml
```

`validate` 只解析 YAML 并检查 workflow 是否满足可运行规则，不会启动 agent。

它会检查 session、node、edge、gate、loopback、input 变量名和 `agentServerId` 字段等结构规则。

如果 workflow 有 required input node，`validate` 也不需要传 `-D`。input 的具体值属于某次 run，而不是 workflow 结构本身。

## 运行 workflow

```sh
specflow run .aflow/.specflow/agentflows/code-review-flow.yaml
```

`run` 会先做 workflow 校验，再检查 required input 是否有值和 agent 认证状态，然后执行 workflow。

## 传入 input node 的值

如果 workflow 有 input node：

```yaml
nodes:
  task-input:
    kind: input
    title: Task
    variableName: specflow_task
    required: true
```

运行时用 `-D` 传值：

```sh
specflow run .aflow/.specflow/agentflows/code-review-flow.yaml -Dtask="Fix the failing login test"
```

CLI 推荐使用无前缀名字，例如 `-Dtask=...`。Specflow 会把它映射到内部变量 `specflow_task`。

完整变量名也兼容：

```sh
specflow run .aflow/.specflow/agentflows/code-review-flow.yaml -Dspecflow_task="Fix the failing login test"
```

多个 input node 就传多个 `-D`：

```sh
specflow run .aflow/.specflow/agentflows/code-review-flow.yaml -Dtask="Fix login" -Daudience="frontend team"
```

如果 workflow 没有 input node，就不需要输入参数：

```sh
specflow run .aflow/.specflow/agentflows/nightly-review.yaml
```

## 跳过确认

```sh
specflow run .aflow/.specflow/agentflows/code-review-flow.yaml -Dtask="Fix login" --yes
```

`--yes` 或 `-y` 会跳过运行前确认。

## 查看版本

```sh
specflow --version
specflow -v
specflow version
```

这三个命令都会打印当前 Specflow 版本。
