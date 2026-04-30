# 当前架构事实

Specflow 是 TypeScript monorepo，使用 pnpm workspaces 和 Turbo。

CLI 位于 `apps/cli`，是当前唯一真实应用入口。

核心领域类型位于 `packages/core`。

workflow engine、状态机、调度和执行占位位于 `packages/runtime`。

workflow session、节点 session 策略、director control decision 和 `control_scope` 管理边属于核心领域模型，由 `packages/core` 定义，由 `packages/runtime` 写入 run state。

`.specflow` 读写、schema 和仓库知识层工具位于 `packages/specflow`。

agent runner、工具调用和执行策略占位位于 `packages/agent`。

本地 server / IPC 适配层占位位于 `packages/server`。

React 节点式 workflow 面板组件位于 `packages/ui`。

当前 UI 必须能显示节点角色、agent CLI、session 归属、Session Director 的管理范围和控制决策。

`.specflow` 是仓库级知识层，记录当前项目目的、架构事实、工程约定、术语和 workflow 意图。

`.specflow/workflows/*.workflow.json` 是结构化 workflow definition。当前 runtime 仍使用内置 placeholder 执行器，但 CLI 已能读取并校验这些定义，后续 UI 编辑和配置驱动执行应沿用这个边界。

当前不包含数据库、认证、CI workflow、真实 Codex 集成、生产级 workflow 编排、桌面壳或传统前后端分离架构。
