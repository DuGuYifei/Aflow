# 工程约定

这份文档记录当前 repo 的工程约定。它是面向维护者的规则，不是用户教程。

## 语言与运行时

- 源码使用 TypeScript。
- runtime、scripts、tests、binary build 使用 Bun。
- 根 `package.json` 使用 workspaces：`packages/*`。
- 各 package 使用 ESM：`"type": "module"`。
- TypeScript package 通过各自 `src/index.ts` 暴露公共入口。

## Package 边界

当前 package 分层：

```text
packages/shared        shared constants/types/SSE/uuid
packages/workflow      pure workflow schema/model
packages/agent-proxy   ACP/headless agent process boundary
packages/native-resume native CLI resume command table
packages/bridge        runtime execution/orchestration
packages/server        HTTP API, stores, static UI, workspace runtime
packages/client        @specflow/client; general HTTP/SSE client for MCP/plugins
packages/mcp           Codex MCP stdio layer
packages/ui            React browser UI
packages/cli           specflow binary entry
packages/aflow         Aflow Pi/TUI agent entry
```

依赖方向应该保持单向：

```text
cli    -> server
mcp    -> @specflow/client -> server over HTTP
aflow  -> package-local specflow-client -> server over HTTP
aflow  -> server for optional in-process startup
aflow  -> Pi SDK
ui     -> server over HTTP
server -> bridge -> workflow
server -> agent-proxy/native-resume
bridge -> agent-proxy/workflow/shared
```

规则：

- `workflow` 保持纯模型层，不知道 HTTP、UI、subprocess、runtime stores。
- `packages/client` 是 `@specflow/client`，保持薄层，只封装通用 HTTP/SSE DTO 和请求，不复制 server business logic。当前主要给 MCP/Codex 和未来 plugin/agent 入口使用。
- `packages/aflow/src/server/specflow-client.ts` 是 Aflow 包内部 client adapter。它可以使用 Aflow 语义命名和返回类型，但同样不能复制 server business logic。
- `mcp` 不 import `@specflow/server`，只通过 installed `specflow mcp` 连接 workspace server。
- `ui` 不直接读写 workspace 文件，只通过 server REST/SSE。
- Aflow 可以 in-process 启动 `@specflow/server`，但用户感知仍是 server-backed。

## 命名

- 文件名：`kebab-case.ts`。
- 类型/interface：`PascalCase`。
- 函数/变量：`camelCase`。
- 常量：`SCREAMING_SNAKE_CASE`。
- 用户可见目录继续叫 `agentflow`；内部通用执行模型可以叫 `workflow`；UI layout 叫 `canvas`。

## 代码风格

- 优先使用现有 package/local helper，不引入平行抽象。
- 结构化数据优先用 schema/parser/typed API，不靠临时字符串拼接。
- 注释只解释非显然约束、协议边界和重要 workaround。
- 不为已经退出舞台的格式添加兼容 shim；当前 v1 workflow 只允许 validate/read/run 报错，不再迁移运行。
- 错误处理放在系统边界：HTTP、file IO、agent process、MCP/tool input、YAML parse。

## 文档位置

- `docs/architecture/`：当前工程事实、架构图、能力矩阵、维护者约定。
- `docs/decisions/`：ADR，记录为什么做某个设计选择。
- `docs/public/tutorial/`：用户教程，可发布给最终用户。
- `.aflow/.specflow/`：workspace/runtime 数据目录，不再作为 tracked 架构文档目录。

## Git

- commit message 使用 Conventional Commits 前缀，例如 `feat:`, `fix:`,
  `docs:`, `refactor:`, `test:`, `chore:`, `build:`, `ci:`。
- scope 可选，保持小写和短，例如 `fix(ui): ...`。
- 不提交本地 runtime 数据：runs、run-logs、canvas、agentflows-local、
  assets、design projects、server registry、local agent server config。
