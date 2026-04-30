# Specflow 项目

项目名：Specflow。

产品类别：本地优先的持续编码平台。

当前阶段：Phase 1 本地最小闭环已开始。

当前目标：在已实现的本地 placeholder workflow run、artifact、execution state、session module、mock Session Director、`.specflow/runs/` 存储边界和 `specflow ui` 可视化工作台上，逐步接近第一个可真实生成和审查 final patch 的本地持续编码闭环。

当前工程入口：`apps/cli`，包括 `specflow workflow ...` 和 `specflow ui`。

当前核心包：`packages/core`、`packages/runtime`、`packages/specflow`、`packages/agent`。

当前本地产品表面：`packages/server`、`packages/ui`。

产品愿景见 `docs/product/vision.md`。

阶段路线见 `docs/product/roadmap.md`。
