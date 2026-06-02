# Glossary

**Ticket** — the starting input for a workflow run. Can be a user-typed description, a GitHub issue, a bug report, a refactor task, or a UI implementation task.

**Spec** — repository-level knowledge that persists across workflow runs. Stored in `.aflow/.specflow/`. Tells the system and AI what rules and facts apply to this codebase, so AI is not reasoning only from the current ticket.

**Workflow / AgentFlow** — the structured process that transforms an input into an agentic result. The editable source is `.aflow/.specflow/agentflows/*.yaml`; browser-only canvas layout is stored separately in `.aflow/.specflow/canvas/*.json`.

**Canvas Node** — an authored UI/YAML node. Current kinds are `input`, `step`, `gate`, and `end`. Only `step` and `gate` become runtime workflow nodes.

**Runtime Node** — an executable node after canvas-to-workflow conversion. Current kinds are `agent` and `gate`. `agent` nodes call an agent server; `gate` nodes ask the upstream session to choose one branch.

**Canvas Edge** — an authored connection with `from`, `to`, optional `branch`, optional explicit transfer fields (`transmit`, `outputTag`, `handoffPrompt`), and optional loop controls (`loopback`, `maxTraversals`).

**Runtime Edge** — an execution edge produced from canvas edges. Current kinds are:
- `trigger` — activates a downstream node without explicit content transfer
- `gate-input` — supplies the upstream output/session identity to a gate
- `tagged-output` — wraps upstream content in a named XML tag for the target prompt

**Session** — a shared agent CLI context across a set of nodes. Nodes in the same session preserve conversational context (plan → implementation → repair). A node can declare that a new repair-loop entry opens a fresh session to avoid context pollution.

**Agent Server** — a configured runtime target in `.aflow/.specflow/agent-servers.json` or `.aflow/.specflow/agent-servers.local.json`. Supported sources are `registry`, `custom`, and `headless`.

**Bridge** — the stateful runtime layer that coordinates workflow execution, gate routing, loop traversal, pause/continue, resume-from-run, and agent calls. It is used by the server-backed UI and can be used directly by tests or alternate entry points.

**Agent Proxy** — the `agent-proxy` package. Resolves agent servers, launches registry/custom ACP agents over stdio, runs headless command-template agents, handles ACP client capabilities, and records real ACP session ids.

**Run Record** — the persisted workflow audit record in `.aflow/.specflow/runs/<runId>.yaml`. It stores status, node outputs, snapshots, initial inputs, and agent invocation metadata.

**Run Log** — durable workflow-side JSONL events in `.aflow/.specflow/run-logs/<runId>.jsonl`. These are operational/audit logs, not Specflow's canonical copy of the ACP agent transcript.

**CC (Continuous Coding)** — the pre-CI layer Specflow operates in. Analogous to CI but focused on the coding phase: understand → plan → generate → review → repair → patch.
