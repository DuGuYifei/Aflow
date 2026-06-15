---
title: Specflow 术语表
description: 固定 workflow 执行、运行控制、快照和循环经过次数相关术语。
category: tutorial
order: 6
updatedAt: "2026-06-15 00:00:00 CEST"
tags:
  - glossary
  - workflow
  - run-control
---

# Specflow 术语表

## 运行控制

- `Pause`：计划性暂停。当前节点或 checkpoint 先正常完成，然后同一个 run 停在调度安全点。
- `Interrupt`：立即打断当前 agent turn，并让同一个 run 保持可继续。
- `Play`：继续同一个 paused 或 interrupted run。
- `Stop`：终止整个 workflow run。这是 workflow run 的终止状态。
- `Continue`：从 stopped 或 error run 创建一个新的 continuation run。
- `Resume`：只用于 agent session。用于 ACP session 恢复或继续会话，不用于 workflow run 继续。

## 执行模型

- `Activation`：一次被调度的节点执行。
- `Traversal`：循环或有上限 gate branch 中重复 activation 的经过次数。
- `Run Snapshot`：保存在 run 上的可编辑 workflow 副本。paused 和 interrupted run 编辑这个 snapshot，不会修改原始 workflow YAML。
- `Runtime Graph Patch`：应用到 paused 或 interrupted run snapshot 的结构化编辑操作。它可以修改未来可达的节点、连线、变量、session 和布局；server 会保留已完成历史事实并迁移 checkpoint。
- `Dynamic Run`：Aflow 的运行模式。它会在 activation 后暂停，基于刚完成节点的文本输出做轻量检查，必要时只 patch 当前 run snapshot，然后 Play 同一个 run 到下一个 checkpoint。
- `History Only`：已经影响过这次 run，但预计不会再影响后续执行的节点或连线。
- `History + Future`：已经完成但未来仍可能再次执行的节点，通常来自 loop。
- `Loop-Closing Edge`：运行时/UI 派生出来用于表示闭环的连线。画布会高亮它，但 v2 YAML 中不需要手写 `loopback` 属性。
