# 术语表

## Specflow

本仓库构建的持续编码平台。

## Continuous Coding

持续编码。发生在 CI/CD 之前的结构化编码收敛流程。

## Ticket

一次 workflow run 的起点，表示当前要完成的任务。

## Spec

仓库级知识，不是 ticket 级文档。当前主要存储在 `.specflow`。

## Workflow

把 ticket 转化为实现结果的结构化流程。Specflow 中 workflow 是图。

## Workflow Definition

可被程序读取和校验的 workflow 结构化定义。当前文件形式是 `.specflow/workflows/*.workflow.json`。

## Runtime

本地 workflow engine、状态机、调度和执行收敛层。

## Agent CLI

执行某个 workflow node 的本地 agent 命令选择。当前默认值是 `codex`，Phase 1 只建模选择边界，不调用真实 agent。

## Workflow Session

一组节点共享的 agent CLI 上下文。节点可以复用同组 session，也可以在特定边界开启新 session。

## Session Module

把多个节点放入同一个 workflow session group 的模块化能力。它用于表达哪些节点需要同一个 agent 上下文。

## Session Policy

节点自身声明的 session 使用规则，包括不使用 session、共享 session、每次新建 session、由 AI 决定，以及 repair loop 再次进入时是否开启新 session。

## Session Director

当前用于决定 session 边界的 director 节点。Phase 1 使用 mock 决策，不调用真实 agent。

## Node

workflow graph 中可观察的步骤。

## Edge

workflow graph 中节点之间的关系。

## Control Flow Edge

表示执行顺序的边。

## Data Flow Edge

表示数据、上下文或 artifact 流向的边。

## Review Loop Edge

表示审查失败后进入修复循环的边。

## Control Scope Edge

表示 director、manager 或 verifier 节点管理其他节点范围的边。

## Director

管理 workflow 某个范围的控制型节点，可以产出 session、routing、review 或 verification decision。

## Manager

Director 的一种具体角色名。它管理某一组节点的执行边界、上下文边界或结果路由。

## Reviewer

审查某个 artifact 是否足够好、是否可以进入下一步的节点或角色。

## Verifier

验证某个 artifact 或执行结果是否满足预期的节点或角色。

## Implementation Reviewer

审查代码实现草稿的 reviewer。

## Visual Decomposer

未来用于把截图、设计稿或 UI mock 拆解为结构化 UI 要求的节点。

## Visual Verifier

未来用于审查视觉拆解结果或视觉实现结果的 verifier。

## Spec Consistency Checker

未来用于检查产物是否和 `.specflow` 仓库知识冲突的 verifier。

## Execution Verifier

未来用于执行 lint、typecheck、test、build 等本地验证命令的 verifier。

## Server

本地 server / IPC 适配层，用于连接 CLI、UI、未来桌面壳和 runtime。

## UI Panel

本地 workflow graph 的 React 可视化面板组件。

## Desktop Shell

未来可选的 Tauri 或 Electron 本地桌面壳。当前不创建。

## Repair Loop

生成、审查、修复、再审查的收敛循环。

## Code Draft

初始代码实现草稿。

## Final Patch

经过审查和修复后准备进入 CI 的候选补丁。

## CC-CI-CD

持续编码、持续集成、持续交付或部署的关系。Specflow 负责 CC 层。
