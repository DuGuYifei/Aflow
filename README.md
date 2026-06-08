<p align="center">
  <img src="assets/banner.png" alt="Specflow" />
</p>

<h1 align="center">Aflow Agent</h1>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="packages/ui/public/favicon.svg" alt="Aflow" width="72" height="72" />
</p>

<p align="center">
  <strong>Specflow</strong> turns agent work into visible workflows. <strong>Aflow Agent</strong>, an agentic workflow agent, is built on top of it.
</p>

## What It Is

**Specflow** is a workflow foundation for agentic work. It lets you describe a process as editable workflow-as-code, connect one or more agents to that process, run the workflow, inspect decisions and outputs, and continue work across sessions with traceable context.

**Aflow Agent** is an agentic workflow agent built with Specflow to help you design and operate those workflows. It can assist while you assemble a workflow, or use a workflow to complete a complex task through planned steps, review gates, and follow-up paths instead of relying on one long, unstructured chat.

Specflow is not limited to coding. It can connect to arbitrary custom agents for business operations, research, review, automation, or domain-specific processes. In development scenarios, it can also generate and maintain spec documents that support SDD, Spec-Driven Development, so implementation work starts from explicit intent, constraints, and expected outcomes.

## What It Helps With

- Build workflow-as-code for repeatable agent work.
- Break complex tasks into visible nodes, decisions, reviews, and follow-up paths.
- Connect custom agents and compose them into the same workflow.
- Coordinate multiple agents with different strengths in one workflow.
- Continue work across sessions so context, decisions, and run history remain traceable.
- Generate spec documents for development workflows when SDD-style clarity is useful.
- Use agents for business workflows, research workflows, coding workflows, or any task that benefits from explicit process and review.

## Usage

```sh
aflow
specflow
specflow validate .aflow/.specflow/agentflow/agentflows/example.yaml
specflow run .aflow/.specflow/agentflow/agentflows/example.yaml -Dtask="Review this change"
```

See [Aflow Agent Tutorial](docs/public/tutorial/en/aflow-agent.md), [Designer Tutorial](docs/public/tutorial/en/designer.md), and [Specflow Commands](docs/public/tutorial/en/specflow-command.md).

## Workspace Files

Workflow-as-code files live in `.aflow/.specflow/agentflow/agentflows/*.yaml`.

Browser canvas layout is generated into `.aflow/.specflow/agentflow/canvas/*.json`.

Agent servers are configured under `.aflow/.specflow/agent-servers.json`. Local secrets and machine-specific overrides go in `.aflow/.specflow/agent-servers.local.json`.

Run records, run logs, and workflow assets are stored under `.aflow/.specflow/`.

Reusable ACP agent cache files live under `~/.aflow/.specflow/cache/agents/` by default, and can be moved with `SPECFLOW_AGENT_CACHE_DIR`.

VPN or proxy users should add `http_proxy` and `https_proxy` under the agent server `env` keys.

See [Workspace Files](docs/public/tutorial/en/workspace-files.md).

## Installation

Install the latest stable release. This installs both `specflow` and `aflow`:

```sh
curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash
```

By default, the installer resolves the latest stable `vX.Y.Z` release. If no stable release exists yet, it falls back to the latest semver prerelease such as `vX.Y.Z-beta.1`. To install a specific release, pass the tag after `bash -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash -s -- v0.0.1-beta.2
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.ps1")))
```

Install a specific release on Windows:

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.ps1"))) "v0.0.1-beta.2"
```

The `install-v2` tag pins the installer script. Release binaries are attached to `vX.Y.Z` and prerelease tags such as `vX.Y.Z-alpha.1`, `vX.Y.Z-beta.1`, or `vX.Y.Z-rc.1`.

## Development

Specflow uses [mise](https://mise.jdx.dev/) to pin Bun.

Install mise:

```sh
curl https://mise.run | sh
```

Enable mise in your shell. For bash:

```sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

For zsh:

```sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

Then enter this repository and trust the local mise config:

```sh
cd Aflow
mise trust
bun --version
```

Install dependencies:

```sh
bun install
```

Start the development entrypoint:

```sh
bun run dev
```

The command builds the embedded UI assets and starts Aflow. With no arguments, Aflow opens a startup menu:

```text
1. Native Aflow
2. Specflow
3. Designer
```

Choosing Specflow starts the local Specflow server and opens the workspace UI. Choosing Designer starts the same server and opens `/design`. In production, the server serves the embedded static UI from the compiled binary.

## Scripts

```sh
bun run dev        # build UI assets, then start the Aflow mode picker
bun run build      # build:ui then build:bin, producing ./specflow
bun run typecheck  # type-check all packages
```

## Acknowledgements

Specflow references and learns from the following projects and communities:

- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) by [@agentclientprotocol](https://github.com/agentclientprotocol)
- [Zed](https://github.com/zed-industries/zed) by [@zed-industries](https://github.com/zed-industries)
- [Pi](https://github.com/earendil-works/pi) by [@earendil-works](https://github.com/earendil-works)

Aflow Agent's terminal agent experience is built on Pi, with appreciation for Pi's minimal, focused agent harness design.

These links are listed as reference materials for protocol, editor, and agent harness design.
