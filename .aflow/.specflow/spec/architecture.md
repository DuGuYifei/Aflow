# Architecture

Last updated: 2026-06-02

## Package layout

```
packages/
  shared/       — constants and types shared across all packages
  workflow/     — workflow definitions, graph model, prompt schemas, run schemas
  agent-proxy/  — subprocess wrapper boundary for external agent CLIs
  bridge/       — stateful runtime; orchestrates workflow execution, gate routing, and agent calls
  server/       — HTTP server; serves the UI and exposes the API; calls bridge
  ui/           — React canvas app built by Vite; embedded into the binary at build time
  cli/          — binary entry point (`specflow`); starts the server
  aflow/        — workflow-aware agent cockpit; wraps Pi coding-agent SDK and calls Specflow API
```

## Call direction

Dependencies flow one way only:

```
cli   → server → bridge → workflow
                        → agent-proxy
ui    → server (HTTP API)
aflow → server (HTTP API)
aflow → Pi coding-agent SDK
```

No package may import from a package above it in this graph.

## Workflow core

`workflow` owns definition-time types and pure helpers only. It does not know about HTTP,
UI state, subprocesses, or runtime orchestration.

- `WorkflowNode` is a union of concrete node types. Agent nodes own agent/session/resource
  fields. Gate nodes are functional nodes and do not inherit agent fields.
- `WorkflowEdge` is a union of passthrough and tagged-output edges. Gate branch routing uses
  `sourcePortId` to select a branch output.
- `Workflow` owns agents, sessions, nodes, and edges directly.

`bridge` owns execution-time behavior:

- `WorkflowExecutor` walks the graph, renders prompts, invokes agents, and advances branches.
- `GateEvaluator` chooses one gate branch and passes the original gate input downstream.
- `TerminalEventStore` records append-only terminal chunks for UI replay and filtering.

## Entry points

| Mode | Package | Status |
|------|---------|--------|
| Browser UI | `cli` → `server` → `bridge` | Current primary entry point |
| Aflow agent cockpit | `aflow` → Pi SDK + `server` API | Initial package implemented; default path preserves Pi session/tool/CLI behavior |
| Headless agent runtime | `bridge` → `agent-proxy` | Implemented for command-template agents |
| Direct headless CLI entry point | `cli` → `bridge` (direct) | Not exposed as a user-facing `--headless` flag |

`server` is not the core — it is one consumer of `bridge`. Tests and alternate runtimes can call `bridge` directly; the shipped CLI currently starts the server-backed UI. Aflow intentionally treats `server` as the API boundary for workflow operations so Browser UI and TUI observe the same persisted state.

## Aflow integration

`packages/aflow` depends on `@earendil-works/pi-coding-agent@0.78.0`. The default Aflow CLI path calls Pi's exported `main(args, { extensionFactories })`, so Pi options such as `--resume`, `--continue`, `--session`, `--fork`, model selection, tool allow/deny lists, skills, prompt templates, and built-in slash commands remain available.

Aflow adds a package-local Pi adapter layer for:

- injecting the Aflow system prompt;
- registering `/specflow-*` slash commands;
- reserving a compact green `Aflow` identity line in the interactive UI;
- routing workflow validate/run/resume calls to the Specflow server API;
- generating native external-agent resume recommendations.

The Specflow server health endpoint includes `workspaceRoot`, `serverId`, and `apiVersion` so Aflow can connect to an existing server without accidentally targeting another workspace.

## Binary distribution

`bun build --compile` produces a single `specflow` executable. The UI dist (`packages/ui/dist/`) is embedded at bundle time via `import.meta.glob` in `packages/server/src/static-ui.ts`. Build order:

```
bun run build:ui       →  Vite produces packages/ui/dist/
bun run build:specflow →  bun build --compile embeds dist/ into ./specflow
bun run build:aflow    →  bun build --compile produces ./aflow with embedded Aflow prompts
bun run build:bin      →  produces both ./specflow and ./aflow
bun run build          →  runs UI build and both binary builds
```

In development (`bun run dev`), the server proxies all UI requests to Vite's dev server — no dist needed.

## Architectural decisions

Detailed rationale for key decisions is in [`docs/decisions/`](../../docs/decisions/).

## Runtime Notes

- ACP agent runtime architecture and remaining implementation plan: [`agent-proxy-acp/runtime.md`](./product/agent-proxy-acp/runtime.md).
- ACP protocol coverage, capability cache, per-node overrides, MCP: [`agent-proxy-acp/protocol-coverage.md`](./product/agent-proxy-acp/protocol-coverage.md).
- Skills + slash command injection: [`agent-proxy-acp/skills-and-slash.md`](./product/agent-proxy-acp/skills-and-slash.md).
- Bridge to agent-proxy call chain: [`agent-proxy-bridge-chain.md`](./agent-proxy-bridge-chain.md).
