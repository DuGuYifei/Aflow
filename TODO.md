# TODO

本文只保留当前 goal 的验收结果和仍需执行的工作。已经完成的历史 ACP roadmap 不再作为待办重复维护；当前 node/edge 行为详见 `.specflow/product/node-edge-current-state.md`。

## Current Goal Acceptance Checklist

核对日期：2026-05-24。已勾选项目已由实现与测试确认。

### Node And Prompt Model

- [x] `step` 的用户编辑内容使用 `prompt`；`promptTemplate` 仅为 runtime 内部模型。
- [x] 删除 step 的 spec 文档更新开关及对应 runtime 字段。
- [x] 图片与路径资源作为 step 上下文分别配置，图片按 agent capability 发送 ACP image block 或资源链接 fallback。
- [x] 手写路径支持项目相对路径和全局绝对路径；选择的文件/目录可导入 workspace assets。

### Edge Transfer Semantics

- [x] 同 session 内容边仅为触发关系，不暴露或接受显式传输属性。
- [x] 不同 session 边可选择不传内容，或以 `outputTag` 显式注入来源输出。
- [x] `handoffPrompt` 在来源 step 的 session 中执行后再传给目标 step。
- [x] `input`/`end` 控制边、gate 输入边及显示型 `loopback` 不接受传输属性。
- [x] 拒绝非法 XML tag、缺少 `outputTag` 的传输、可同时到达目标的重复 tag 和未标记执行循环。

### Gate And Session Semantics

- [x] Gate 没有独立固定 session，判断使用前序内容 step 的上下文。
- [x] Agent 支持 fork 时 gate 判断 fork 前序 session；不支持时复用前序 session。
- [x] Gate 仅允许一个业务输入且至少一个 branch；输出边按跳过 gate 后的内容节点关系判定传输。
- [x] 未选中的 gate 路径会失活，选中路径可穿过后续 join 节点继续执行。
- [x] 单次 run 内，同一有效 ACP agent 配置复用一个 connection 并承载多个 workflow session。

### UI And Review Corrections

- [x] 编辑或删除 session 后自动清除已变成非法的边传输配置。
- [x] UI 阻止删除最后一个 workflow session、最后一个 gate branch、第二条 gate 业务输入和普通执行循环。
- [x] UI 展示 gate fork 的父 session 与 ACP capability 信息。
- [x] Server 与 converter 对上述约束进行防御性校验，避免手写 YAML 绕过 UI。

### ACP Conversation And Human Pause

- [x] `Inspect` 在独立 ACP conversation 窗口只读展示恢复内容，不把回放内容混入 run `Logs` 页签。
- [x] `Resume` 在独立 conversation 窗口恢复并保持 ACP session，可继续发送用户 prompt 和处理 ACP permission/elicitation；窗口关闭时终止该恢复会话。
- [x] 普通 `step` 可启用 `pauseAfterRun`；暂停后仅该 step 所属 session 的 `Logs` 页签展示人工 prompt 输入口。
- [x] 暂停节点卡片提供 `Continue`，继续后关闭输入口，并将最后一次人工交互输出作为下游显式传输来源。
- [x] 服务端仅允许当前 run 中由执行器登记的暂停节点接收 prompt/continue；headless agent 不允许启用交互暂停。
- [x] UI 明示当前为 ACP 尚无 ask-human tool 的暂停方案，待 Agent Client Protocol Elicitation RFD 合并后扩展原生交互。

### Run Logs, Fork Sessions, And Node Panels

- [x] `Logs` 面板实时展示 agent prompt、fork lifecycle，以及 fork workflow session。
- [x] `Inspect`/`Resume` 操作入口合并到 `Logs` 面板，不再维护独立 Agent 会话页签。
- [x] Handoff/gate fork session 记录可在 log session tree 中查看，并保留 Inspect/Resume 能力。
- [x] Gate 输出必须为纯 JSON；首次 parse/schema/branch 校验失败时，在同一 fork session 内自动 repair 一次。
- [x] 右侧节点面板支持编辑 node key；标题为空时使用 node key 拆词作为 fallback。
- [x] Run/history 视图中节点状态显示为只读 status badge，变量页签显示本次输入值而非可编辑输入框。

## Open Work

- [ ] 实现 spec 文档生成、更新及 flow 完成后的自动更新。(waiting maturation)
- [ ] specflow generate-spec 命令
- [ ] specflow update-spec 命令
- [ ] 解决偶发的 `[Bun.serve]: request timed out after 10 seconds`，并确定合理的 `idleTimeout` 策略。
- [ ] 定义 workspace `.specflow` 与用户级/全局 agent 安装配置的归属边界，清理 .specflow 下的文件 / 文件夹
- [ ] MCP系统接入
- [ ] token计数
- [ ] 优化workflow的agent或server中台，整体链路（还得发送workflow快照和日志快照）
- [ ] 日志大小上限，文件数量上限
- [ ] 运行中节点被选中，下方session应该自动切换到该节点所属session看日志。
- [ ] app
- [ ] UI更新为和homepage一致的新风格。（还需要思考，主要是黑夜模式似乎对眼睛不够友好）
- [ ] SKILL模式

## Resolved Bugs

- [x] fork session 与 gate fork 实时显示到 Logs 面板。
- [x] Variables 页签在 run/history 视图显示本次输入值。
- [x] session似乎在显示时候共享了session
- [x] 重新进入运行中的workflow，session不会更新，应该要主动发一次请求是不是？（好像解决了，但是不记得了）
- [x] UI: input value节点不能连线
- [x] UI: 新建workflow，会有一个默认的unconfigured session，应该默认不创建。
- [x] 当直接退出程序并重启时，如果直接发现run-logs里有running的节点，则先改为cancel状态。
