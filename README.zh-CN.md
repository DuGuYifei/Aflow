<p align="center">
  <img src="assets/banner.png" alt="Specflow" />
</p>

<h1 align="center">Aflow Agent</h1>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

<p align="center">
  <img src="packages/ui/public/favicon.svg" alt="Aflow" width="72" height="72" />
</p>

<p align="center">
  <strong>Specflow</strong> 将 Agent 工作组织为可见工作流，<strong>Aflow Agent</strong> 是基于它构建的 Agentic Workflow Agent。
</p>

## 它是什么

**Specflow** 是面向 Agent 工作的工作流基础设施。它让你把流程描述为可编辑的 workflow-as-code，接入一个或多个 Agent 执行流程，观察决策与产出，并在跨 session 的上下文中持续推进复杂任务。

**Aflow Agent** 是基于 Specflow 制作的 Agentic Workflow Agent，用来辅助设计和运行这些工作流。它可以在你搭建 workflow 时提供帮助，也可以在执行复杂任务时，以计划步骤、审查关卡和后续路径推进任务，而不是把所有上下文堆在一次长对话里。

Specflow 不只面向代码任务。它可以接入任意自定义 Agent，用来构建业务流程、研究流程、审查流程、自动化流程，或面向具体行业和团队的垂直工作流。当用于开发场景时，它也可以生成和维护 spec 文档，辅助 SDD，也就是 Spec-Driven Development，让实现工作从明确的目标、约束和预期结果开始。

## 它能做什么

- 将重复性的 Agent 工作沉淀为 workflow-as-code。
- 把复杂任务拆成可见节点、分支决策、审查关卡和后续路径。
- 接入自定义 Agent，并把它们组合进同一个工作流。
- 让多个能力不同的 Agent 在同一个工作流中协作。
- 支持跨 session 协作，让上下文、决策和运行历史可追踪。
- 在开发工作流中生成 spec 文档，辅助 SDD 风格的清晰协作。
- 用于业务流程、研究流程、代码工作流，或任何需要明确过程和审查的复杂任务。

## 使用

```sh
specflow
specflow validate .aflow/.specflow/agentflows/example.yaml
specflow run .aflow/.specflow/agentflows/example.yaml -Dtask="Review this change"
```

详见 [Specflow 命令](docs/public/tutorial/specflow-command.md)。

## Workspace 文件

Workflow-as-code 文件保存在 `.aflow/.specflow/agentflows/*.yaml`。

浏览器画布布局生成到 `.aflow/.specflow/canvas/*.json`。

Agent server 配置在 `.aflow/.specflow/agent-servers.json` 中。本地密钥和机器相关覆盖项写入 `.aflow/.specflow/agent-servers.local.json`。

Run 记录、run 日志、缓存和 workflow 资源也保存在 `.aflow/.specflow/` 下。

VPN 或代理用户需要在 agent server 的 `env` 中添加 `http_proxy` 和 `https_proxy`。

详见 [Workspace 文件](docs/public/tutorial/workspace-files.md)。

## 安装

安装最新稳定版：

```sh
curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v1/install/install.sh | bash
```

默认情况下，安装脚本优先解析最新的稳定版 `vX.Y.Z`。如果当前还没有稳定版，会回退到最新的 semver prerelease，例如 `vX.Y.Z-beta.1`。如果要安装指定 release，在 `bash -s --` 后面传入 tag：

```sh
curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v1/install/install.sh | bash -s -- v0.0.1-beta.2
```

Windows PowerShell：

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v1/install/install.ps1")))
```

Windows 安装指定 release：

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v1/install/install.ps1"))) "v0.0.1-beta.2"
```

`install-v1` tag 用来固定安装脚本版本。真正的 release binaries 会挂在 `vX.Y.Z` 以及 `vX.Y.Z-alpha.1`、`vX.Y.Z-beta.1`、`vX.Y.Z-rc.1` 这类 prerelease tag 下。

## 开发

Specflow 使用 [mise](https://mise.jdx.dev/) 固定 Bun 版本。

安装 mise：

```sh
curl https://mise.run | sh
```

在 shell 中启用 mise。bash 示例：

```sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

zsh 示例：

```sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

然后进入本仓库并信任本地 mise 配置：

```sh
cd Aflow
mise trust
bun --version
```

安装依赖：

```sh
bun install
```

启动开发服务：

```sh
bun run dev
```

该命令会启动 Specflow server，并打印浏览器 URL：

```text
Specflow UI: http://localhost:5173/
```

开发模式下，server 会把 UI 请求代理到 Vite，因此 React 更新会比较快。生产模式下，server 会从编译后的二进制中提供内嵌的静态 UI。

## Scripts

```sh
bun run dev        # 启动 server + Vite dev proxy
bun run build      # build:ui 后 build:bin，生成 ./specflow
bun run typecheck  # 对所有 packages 做类型检查
```

## 致谢

Specflow 的设计参考和学习了以下项目与社区：

- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)，GitHub 账号：[@agentclientprotocol](https://github.com/agentclientprotocol)
- [Zed](https://github.com/zed-industries/zed)，GitHub 账号：[@zed-industries](https://github.com/zed-industries)
- [Pi](https://github.com/earendil-works/pi)，GitHub 账号：[@earendil-works](https://github.com/earendil-works)

Aflow Agent 的终端 agent 体验基于 Pi 构建，并感谢 Pi 在极简、专注的 agent harness 设计上带来的启发。

以上链接作为参考资料列出，用于说明 Specflow 在协议、编辑器和 agent harness 设计上的参考来源。
