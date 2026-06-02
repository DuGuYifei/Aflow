# Aflow Engineering Development Plan

Date: 2026-06-02
Last updated: 2026-06-02

Status: engineering baseline plus initial implementation snapshot. This document is based on the current Specflow worktree, the local `pi` SDK sources under `/mnt/d/ProjectGit/pi/packages/coding-agent`, Pi latest docs at `https://pi.dev/docs/latest` and `https://pi.dev/docs/latest/usage`, and the installed npm package `@earendil-works/pi-coding-agent@0.78.0`.

## Executive Decision

Aflow should be implemented as a new CLI/TUI agent package that uses `@earendil-works/pi-coding-agent` as the agent SDK and uses the existing Specflow server APIs as the workflow backend.

The server does not need to be redesigned for Aflow. The existing server already owns the workflow runtime, run state, logs, pause/continue, interactions, agent-server configuration, ACP capability probing, ACP session restore, workflow resume, and SSE event streams.

However, there is one important safety exception: Aflow must not blindly call `startSpecflowServer()` if another Specflow server for the same workspace is already running. The current server start path runs `reconcileInterruptedRuns()` when the API handler is created. Starting a second server process for the same workspace can mark a genuinely active run from the first process as `cancelled`. Therefore Aflow needs a connect-first server lifecycle guard. The cleanest long-term fix is a small additive server change to expose `workspaceRoot` and `serverId` on `/api/health`; the rest of Aflow can stay client-side.

OpenAPI is explicitly out of scope for the current implementation. Aflow should build against a typed `SpecflowClient` and the server's actual API behavior. If API contract drift becomes a problem later, extract shared API DTOs first; do not block Aflow on OpenAPI.

Aflow must not become a reduced Pi clone. It should preserve Pi's code-agent capabilities wherever they fit the Aflow product: coding tools, session persistence, `--resume`, `--continue`, `--session`, `--fork`, model/thinking options, skills, prompt templates, extension commands, compaction, and common built-in slash commands. Aflow adds workflow cockpit behavior on top.

The final Aflow TUI should be a dedicated cockpit, not Pi's stock chat UI as the permanent product. It should still reuse Pi's runtime/session/tool stack and borrow Pi's proven terminal lifecycle patterns. Phase 1 can use Pi-compatible interactive behavior for speed; the product target is an Aflow-owned TUI shell with run dashboard, pause panel, auth panel, session summary, and native handoff.

2026-06-02 install check: `bun add @earendil-works/pi-coding-agent` succeeded and installed version `0.78.0` with a `pi` binary. Aflow can depend on the published package directly; local Pi repo builds are useful for source research but are not required for this project to compile.

## Initial Implementation Snapshot

The first code slice now exists in `packages/aflow`:

- `packages/aflow/src/pi/pi-sdk-host.ts` calls Pi's exported `main(args, { extensionFactories })`.
- `packages/aflow/src/pi/aflow-extension.ts` registers `/specflow-*` commands as LLM prompt triggers and sets compact Aflow status/widget identity.
- `packages/aflow/src/tools/ask-user-tool.ts` registers `ask_user` for text, choice, and confirm questions in the TUI. Choice mode shows at most four options; by default the first three are explicit options and the final option opens custom text input. Fixed four-option questions can set `allowCustom: false`.
- `packages/aflow/src/tools/specflow-workflow-tools.ts` registers LLM-callable workflow tools for validate, run, workflow resume, agent-session resume, and native resume recommendations.
- `packages/aflow/src/resume/session-resume.ts` owns the shared resume picker used after a run and by explicit `/specflow-resume-session`.
- `packages/aflow/src/prompt-content.ts` embeds the default Aflow system prompt and the workflow YAML authoring guide so the `aflow` binary can run in arbitrary project roots without this repository's docs directory.
- `packages/aflow/src/prompts/create-workflow.md` and `fork-adapt-workflow.md` are source references only; runtime prompt content is embedded in TypeScript. Fork/adapt must copy the source YAML to `.aflow/.specflow/agentflows-local/<new-workflow-id>.yaml` before editing.
- `packages/aflow/src/server/specflow-client.ts` is the typed client for the current Specflow API.
- `packages/aflow/src/server/connect-or-start.ts` connects to an existing same-workspace server or starts one if needed.
- `packages/aflow/src/native/native-agent-adapters.ts` stores the native resume table. This code table is the only source for native resume command templates; Aflow prompts should not contain the full table or ask the LLM to infer templates.
- `packages/aflow/src/native/terminal-handoff.ts` implements inherited-stdio handoff. Direct CLI uses normal child process stdio inheritance; Pi-backed TUI uses `ui.custom()` to stop the renderer, run the native CLI in the real terminal, then restart the Aflow renderer.

The root CLI exposes `aflow`, and `packages/server/src/http.ts` adds health fields needed by Aflow: `workspaceRoot`, `serverId`, and `apiVersion`. Build scripts now produce both `specflow` and `aflow` binaries.

Important correction: Aflow TUI slash commands are not traditional command parsers. They generate agent prompts so the LLM can extract arguments from the conversation, call `ask_user` when information is missing, and then call workflow tools. Direct shell commands still exist as deterministic helpers, but they are not the primary TUI semantics.

## Current Evidence

### Specflow Runtime Surface

The current repo already has the workflow server and runtime pieces Aflow needs:

- `packages/server/src/http.ts`
  - `startSpecflowServer()` initializes `.aflow/.specflow`, starts the server, creates the bridge, and exposes `/api/health`.
  - The server tries ports `5173..5192`.
- `packages/server/src/api.ts`
  - `GET /api/canvases`
  - `POST /api/canvases`
  - `GET|PUT|DELETE /api/canvases/:id`
  - `POST /api/canvases/:id/run`
  - `GET /api/runs?workflowId=...`
  - `GET|DELETE /api/runs/:id`
  - `POST /api/runs/:id/cancel`
  - `GET /api/runs/:id/logs`
  - `GET /api/runs/:id/events`
  - `GET /api/runs/:id/paused-nodes`
  - `POST /api/runs/:id/paused-nodes/:nodeId/prompt`
  - `POST /api/runs/:id/paused-nodes/:nodeId/continue`
  - `GET /api/runs/:id/resumable-session`
  - `POST /api/runs/:id/resume-workflow`
  - `POST /api/runs/:id/rerun`
  - `GET /api/agent-sessions`
  - `GET /api/agent-sessions/:id`
  - `POST /api/agent-sessions/:id/restore`
  - `GET /api/agent-session-restores/:id/events`
  - `POST /api/agent-session-restores/:id/prompt|cancel|close`
  - `GET|PUT|DELETE /api/agent-servers/:id`
  - `GET /api/agent-servers/registry`
  - `GET /api/agent-servers/:id/auth`
  - `POST /api/agent-servers/:id/auth/:methodId`
  - `GET|POST /api/agent-auth-terminals/:sessionId/...`
  - `GET /api/skills`
- `packages/bridge/src/execution/pause-store.ts`
  - Live pause is already modeled as an in-process pending pause with prompt and continue APIs.
- `packages/bridge/src/execution/executor.ts`
  - `pauseAfterRun` already calls `RunPauseStore.waitForContinuation()`, emits node `paused`, accepts additional prompts, and then continues workflow execution.
- `packages/server/src/agentflow-validation.ts`
  - `assertServerRunnableAgentFlow()` already blocks `pauseAfterRun` on headless agents.
  - `assertCliRunnableAgentFlow()` blocks `pauseAfterRun` only for the old direct `specflow run` CLI path.

Conclusion: Aflow should run workflows through server APIs, not through the old direct executor CLI path. This preserves pause support.

### Pi Coding-Agent SDK Surface

The local SDK under `/mnt/d/ProjectGit/pi/packages/coding-agent` is a better starting point than `/mnt/d/ProjectGit/pi/packages/agent`.

Relevant exported surfaces from `coding-agent/src/index.ts`:

- `createAgentSession`
- `createAgentSessionRuntime`
- `createAgentSessionServices`
- `createAgentSessionFromServices`
- `AgentSession`
- `AgentSessionRuntime`
- `SessionManager`
- `DefaultResourceLoader`
- `SettingsManager`
- `AuthStorage`
- `ModelRegistry`
- `InteractiveMode`
- `runPrintMode`
- `runRpcMode`
- extension types and helpers such as `ExtensionFactory`, `RegisteredCommand`, `defineTool`
- UI components and theme helpers

Relevant SDK behavior:

- `DefaultResourceLoader` supports `systemPromptOverride` and `appendSystemPromptOverride`.
- `createAgentSessionRuntime()` owns session replacement and cwd-bound runtime rebuild.
- `AgentSession.prompt()` supports streaming, slash/extension command handling, prompt templates, steer/followUp queueing, and events.
- `InteractiveMode` already handles TUI lifecycle, rendering, session switching, compaction, session tree, model switching, and external editor handoff.
- Pi's external editor flow stops the TUI, spawns a child with `stdio: "inherit"`, waits for child exit, restarts the TUI, and forces a full render. This is the right pattern for native agent handoff.
- Pi's suspend flow ignores `SIGINT` while suspended and restores the TUI on `SIGCONT`.

Conclusion: Aflow should reuse the coding-agent session/runtime stack and replace prompt, commands, command tools, TUI shell, and Specflow views. Starting from the lower-level `agent` package would require rebuilding too much already-solved infrastructure.

### Pi Latest Documentation Evidence

Pi latest docs define Pi as a small terminal coding harness extended through TypeScript extensions, skills, prompt templates, themes, and packages. This supports the Aflow architecture: keep Pi's core harness and extend/override identity, commands, tools, and TUI behavior.

`https://pi.dev/docs/latest/usage` confirms the user-facing behaviors Aflow should preserve:

- Interactive mode has startup header, messages, editor, and footer.
- Slash commands include `/login`, `/model`, `/settings`, `/resume`, `/new`, `/name`, `/session`, `/tree`, `/fork`, `/clone`, `/compact`, `/copy`, `/export`, `/reload`, `/hotkeys`, and `/quit`.
- Session CLI options include `-c/--continue`, `-r/--resume`, `--session`, `--fork`, `--session-dir`, `--no-session`, and `--name`.
- Tool options include `--tools`, `--exclude-tools`, `--no-builtin-tools`, and `--no-tools`.
- Built-in tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
- System prompt can be replaced with `--system-prompt` or project/global `SYSTEM.md`, and appended with `APPEND_SYSTEM.md`.

`https://pi.dev/docs/latest/sdk` confirms the SDK integration choices:

- `createAgentSession()` is enough for one session, but replacement APIs such as new session, resume, fork, clone, import, and session switching live on `AgentSessionRuntime`.
- `DefaultResourceLoader` supplies extensions, skills, prompts, themes, and context files.
- `AgentSession.prompt()` handles prompt templates, extension commands, queueing behavior, and event streaming.
- `AgentSession` exposes model control, thinking level, compaction, abort, message state, and subscriptions.

`https://pi.dev/docs/latest/tui` confirms Aflow can build custom terminal UI using component-style render/input contracts. Components render width-bounded lines, can handle input, and focusable components must propagate focus for IME correctness. This matters because Aflow's users may type Chinese or other IME text in workflow/pause prompts.

`https://pi.dev/docs/latest/themes` confirms themes are JSON color definitions and can be loaded from project/global/package/CLI sources. Aflow should define its own default theme while still allowing Pi-compatible theme loading where practical.

## Target Architecture

```txt
real terminal
  |
  v
aflow CLI/TUI package
  |-- pi-coding-agent SDK
  |     |-- Aflow system prompt
  |     |-- Aflow slash commands
  |     |-- workflow authoring tools
  |     |-- Specflow server client tools
  |     `-- Aflow TUI panels
  |
  |-- SpecflowClient over HTTP + SSE
  |     `-- connect-first server lifecycle guard
  |
  |-- NativeHandoffController
  |     `-- stdio: inherit native CLI resume
  |
  v
Specflow server
  |-- bridge/executor
  |-- agent-proxy
  |-- ACP sessions
  |-- run logs
  |-- pause store
  |-- interaction store
  `-- agent session index
```

Browser UI and Aflow TUI are peers. Both talk to the same server state. The browser does not get native handoff. Native handoff is local-only because it requires the real terminal.

## Package Layout

Current first structure plus planned cockpit expansion:

```txt
packages/aflow/
  package.json
  tsconfig.json
  src/
    cli.ts
    index.ts
    main.ts
    system-prompt.ts
    pi/
      pi-sdk-host.ts
      aflow-extension.ts
    server/
      connect-or-start.ts
      specflow-client.ts
    commands/
      specflow-validate.ts
      specflow-run.ts
      specflow-resume.ts
      index.ts
      args.ts
      io.ts
      prompt-builders.ts
    native/
      native-agent-adapters.ts
      command-detection.ts
      terminal-handoff.ts
    prompts/
      aflow-system.md
      aflow-compatibility.md
      create-workflow.md
      fork-adapt-workflow.md
    tui/                    # planned dedicated cockpit shell
    tools/                  # planned LLM-callable workflow helpers
    workflow/               # planned structured YAML/canvas drafting helpers
```

Root changes:

- Add `packages/aflow` to the existing `packages/*` workspace automatically.
- Add root bin:
  - `aflow: ./packages/aflow/src/cli.ts` for dev.
  - Later compiled binary target can mirror `specflow`.
- Add scripts:
  - `bun run aflow`
  - `bun run --cwd packages/aflow typecheck`
  - include aflow in root `typecheck`.

Dependency:

- `packages/aflow` depends on:
  - `@specflow/server`
  - `@specflow/shared`
  - `@specflow/workflow` if direct schema helpers are needed
  - `@earendil-works/pi-coding-agent`
- The published package `@earendil-works/pi-coding-agent@0.78.0` installs successfully and should be the default dependency. The local Pi repo can still be used for source research.

## Server Lifecycle Plan

### Why Aflow Cannot Blindly Start A Server

Current server startup creates the API handler, and `createApiHandler()` immediately calls:

```txt
reconcileInterruptedRuns(root, "Server restart detected; run was interrupted before completion.")
```

That is correct for crash recovery, but dangerous if Aflow starts a second server for the same workspace while the first server has an active run. The second process does not have the first process's controllers or pause store, so it treats disk `running` state as stale and marks it `cancelled`.

### Required Aflow Behavior

Aflow startup should use:

```txt
connect to compatible active server for this workspace
else start a new server
else fail with a clear diagnostic
```

### Minimal Server Change Recommended

Add fields to `/api/health`:

```ts
{
  app: "Specflow",
  ok: true,
  sessions: number,
  startedAt: string,
  workspaceRoot: string,
  serverId: string,
  apiVersion: 1
}
```

This is additive and should not break existing UI or tests. It lets Aflow distinguish:

- no server on default port: start one
- server on default port for same workspace: connect to it
- server on default port for another workspace: start on another port
- server on another recorded port for same workspace: connect to it

Optional but useful:

- Write `.aflow/.specflow/server.json` on server start:

```json
{
  "url": "http://localhost:5173/",
  "pid": 12345,
  "workspaceRoot": "/repo",
  "serverId": "...",
  "startedAt": "..."
}
```

Aflow can read this first, verify health, then connect. If stale, ignore it.

### Can We Avoid Server Changes?

For a quick prototype, yes:

- Probe `http://localhost:5173/api/health`.
- If it answers `Specflow`, connect to it.
- If not, call `startSpecflowServer()`.

But this is unsafe if port 5173 belongs to a Specflow server from another workspace, and it is not robust for a same-workspace server on a non-default port. The additive health field is a small change with a large safety payoff.

## Specflow Client Plan

Do not import `packages/ui/src/api.ts` from Aflow. That file is browser-relative and tied to frontend fetch behavior.

Create `packages/aflow/src/server/specflow-client.ts`:

```ts
export class SpecflowClient {
  constructor(baseUrl: string) {}

  health(): Promise<SpecflowHealth>;
  listCanvases(): Promise<CanvasSummary[]>;
  getCanvas(id: string): Promise<CanvasDoc>;
  saveCanvas(id: string, doc: CanvasDoc): Promise<void>;
  createCanvas(name: string): Promise<CanvasDoc>;
  runCanvas(id: string, input: RunStartOptions): Promise<{ runId: string }>;
  getRun(id: string): Promise<ApiRunRecord>;
  listRuns(workflowId?: string): Promise<ApiRunRecord[]>;
  cancelRun(id: string): Promise<CancelRunResponse>;
  resumeWorkflowRun(id: string): Promise<{ runId: string }>;
  fetchPausedNodes(runId: string): Promise<PausedNodeSession[]>;
  promptPausedNode(runId: string, nodeId: string, prompt: string): Promise<{ output: string }>;
  continuePausedNode(runId: string, nodeId: string): Promise<void>;
  fetchAgentSessions(filter: AgentSessionFilter): Promise<AgentSessionRecord[]>;
  fetchResumableSession(runId: string): Promise<ResumableSessionSuggestion | undefined>;
  listAgentServers(): Promise<AgentServerEntry[]>;
  listRegistry(): Promise<RegistryIndex>;
  saveAgentServer(id: string, settings: AgentServerSettings): Promise<AgentServerEntry[]>;
  inspectAuth(id: string): Promise<AgentAuthenticationStatus>;
  authenticate(id: string, methodId: string): Promise<AgentAuthenticationResponse>;
  subscribeRun(runId: string, handlers: RunSseHandlers): Disposable;
  subscribeRestore(restoreId: string, handlers: RestoreSseHandlers): Disposable;
  subscribeAuthTerminal(sessionId: string, handlers: AuthTerminalHandlers): Disposable;
}
```

Type strategy:

- First pass: duplicate the small API types in `packages/aflow/src/server/types.ts` or import server/shared types where already exported.
- Later cleanup: move shared API DTOs from `packages/ui/src/api.ts` into `packages/shared/src/api-types.ts` and let UI + Aflow import them. This is cleaner but touches existing UI imports, so it should be a separate low-risk refactor.

## Aflow Agent SDK Integration

### Pi Compatibility Contract

Aflow should preserve the practical code-agent surface users expect from Pi unless it conflicts with workflow cockpit behavior.

CLI options to support in the Aflow parser:

- `-c`, `--continue`: continue most recent Aflow/Pi-compatible session.
- `-r`, `--resume`: open session picker or resume selector.
- `--session <path|id>`: open a specific session file or partial id.
- `--fork <path|id>`: fork a prior coding-agent session.
- `--session-dir <dir>`: override session storage.
- `--no-session`: run ephemerally.
- `--name`, `-n`: set startup session display name.
- `--provider`, `--model`, `--api-key`, `--thinking`, `--models`: preserve model selection where SDK APIs support it.
- `--tools`, `--exclude-tools`, `--no-builtin-tools`, `--no-tools`: preserve tool gating.
- `--system-prompt`, `--append-system-prompt`: allow explicit override/append, but Aflow's default system prompt remains the product baseline.
- `-p`, `--print` and JSON/RPC modes can be supported after interactive mode; do not remove the ability architecturally.

Built-in Pi tools should remain available by default: `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. Aflow-specific tools are additional structured operations, not replacements.

Slash command policy:

- Aflow commands use `/specflow-*` names and take priority for those exact names.
- Pi built-in commands remain available where they operate on the code-agent session: `/resume`, `/new`, `/name`, `/session`, `/tree`, `/fork`, `/clone`, `/compact`, `/copy`, `/export`, `/reload`, `/hotkeys`, `/quit`, `/model`, `/settings`, `/login`, `/logout`.
- Aflow should not rename Pi commands unless a command conflicts with workflow semantics.
- When a command is workflow-specific, prefer `/specflow-run` over overloading `/run`.

### Session Runtime

Use `createAgentSessionRuntime()` rather than only `createAgentSession()` because Aflow needs session replacement, resume, new-session, and cwd-bound service rebuilds.

Factory shape:

```ts
const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderOptions: {
      systemPromptOverride: () => AFLOW_SYSTEM_PROMPT,
      appendSystemPromptOverride: (base) => [
        ...base,
        renderSpecflowProductContext(cwd),
      ],
      extensionFactories: [createAflowExtension({ client, nativeAdapters })],
    },
  });

  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};
```

### System Prompt

The Aflow system prompt should replace the generic coding-agent identity with:

- Aflow is a Specflow workflow architect and runtime operator.
- Its first job is to understand the user's business goal and workflow constraints.
- It can create, fork/adapt, validate, run, resume, and inspect workflows.
- It must prefer Specflow server tools over ad hoc shell access for workflow operations.
- It must distinguish ACP runtime interaction from native CLI resume.
- It must not promise native capture unless the adapter supports it.
- It must ask for missing workflow run inputs and agent choices when required.
- It must validate before run when creating or modifying workflows.
- It must preserve coding-agent competence: read code, inspect files, edit code, run commands, and use Pi-compatible session behavior when the user asks for ordinary coding help.
- It must treat workflow YAML/canvas edits as structured data work, not ad hoc string concatenation.
- It must explicitly separate three resume concepts: Aflow/Pi coding-agent session resume, Specflow workflow resume, and external agent-session resume.

Product docs from `.aflow/.specflow/spec/product` should be included as context, but Aflow should not blindly stuff all files into the system prompt forever. Use a bounded context loader:

- always include `product.md`
- include `aflow-agent-cockpit.md`
- include specific node/edge docs when creating or validating workflow structure
- summarize or link larger docs when the prompt budget is tight

### Commands Vs Tools

Use both:

- Slash commands are user-facing shortcuts: `/specflow-run`, `/specflow-validate`, etc.
- Tools are model-facing primitives: `specflow_list_workflows`, `specflow_save_workflow`, `specflow_run_workflow`, etc.

This keeps the UI ergonomic while giving the LLM structured operations.

### TUI Strategy

Final direction:

- The Aflow TUI is owned by Aflow because the primary screen is a workflow cockpit, not a generic chat transcript.
- Aflow still reuses Pi runtime/session/tool concepts and Pi terminal lifecycle patterns.
- Aflow should borrow Pi component conventions: render lines must fit width, input components must support focus/IME, and external process handoff must stop/restart the TUI cleanly.

Visual baseline:

- Brand color follows `assets/banner.png`: dark background plus high-saturation neon green. Use an Aflow accent close to `#7CFF00` or 256-color green `118`.
- Header or footer should always keep a compact `Aflow` identity line in green.
- During native handoff, before launching the external CLI and after it exits, print a small Aflow guard line so users know how they entered and why they returned.

Implementation phasing:

- Phase 1 may run on a Pi-compatible interactive shell to keep session/tool behavior complete.
- Phase 2 introduces Aflow-owned cockpit panels.
- Phase 3 replaces remaining stock Pi visuals while keeping compatible commands.

## Aflow Slash Commands

### `/specflow-create`

Goal: create a new workflow from a business objective.

Flow:

1. Collect missing facts:
   - workflow name
   - business goal/ticket
   - expected output
   - agent servers to use
   - inputs/variables
   - pause points if any
2. Fetch known agent servers and capabilities.
3. Draft an `AgentFlowDoc`/canvas document using a schema helper.
4. Validate with `assertServerRunnableAgentFlow()`.
5. Save through server API.
6. Show a compact graph summary and ask whether to run.

Impact:

- No server runtime changes required.
- May need a local helper to create clean graph layouts.

### `/specflow-fork-adapt`

Goal: clone an existing workflow and adapt it to a concrete task.

Flow:

1. Select source workflow.
2. Fetch canvas and latest runs/sessions for context.
3. Ask user what changes are desired.
4. Apply structured edits to the copied workflow.
5. Validate.
6. Save as a new workflow id.

Impact:

- Server API already supports `GET /api/canvases/:id`, `POST /api/canvases`, and `PUT /api/canvases/:id`.
- Need good diff summary in Aflow TUI.

### `/specflow-validate`

Goal: validate saved workflow or YAML file.

Implementation options:

- For local files: import `loadAgentFlowFile()`, `listAgentServers()`, and `assertServerRunnableAgentFlow()` from `@specflow/server`.
- For saved workflows: fetch canvas via API, then validate locally using server validation functions.

Optional server improvement:

- Add `GET /api/canvases/:id/validate`.
- Add `POST /api/agentflows/validate` for arbitrary document validation.

This is not required for first implementation. Direct validation in `packages/aflow` is enough and avoids touching server behavior.

### `/specflow-run`

Goal: start workflow through server API and show a TUI run dashboard.

Flow:

1. Resolve workflow id.
2. Fetch canvas and required variables.
3. Collect missing `specflow_*` input values.
4. Call `POST /api/canvases/:id/run`.
5. If 409 auth required, show auth panel and retry after auth.
6. Subscribe to `GET /api/runs/:id/events`.
7. Render node states, active node, terminal/log chunks, interactions, and pause panels.
8. On completion, fetch run record and agent sessions.
9. Show session summary and native resume options.

Impact:

- No server runtime changes required.
- Requires Aflow SSE client and terminal rendering.

### `/specflow-resume`

Two meanings must stay separate:

1. Workflow resume:
   - For `cancelled` or `error` runs, call `POST /api/runs/:id/resume-workflow`.
   - Then show the same run dashboard for the new run.
2. Native agent continuation:
   - For completed or recorded sessions, use native adapter table and terminal handoff.

The command should ask which one the user means only when context is ambiguous.

## Run Dashboard Design

The run dashboard should be denser and more operational than the browser canvas. It is not a landing page and should not look like marketing UI.

Core panels:

- Header:
  - workflow name
  - run id/label
  - status
  - elapsed time
  - active node
- Node list:
  - stable rows for each runtime node
  - status icon/color
  - node alias/title
  - session id
  - agent server id
  - latest output/error one-line summary
- Terminal/log panel:
  - latest terminal chunks
  - filter by node/session
  - lazy fetch previous logs via `/api/runs/:id/logs?tail=...`
- Interaction panel:
  - permission/elicitation requests from `interaction-requested`
  - response controls
- Pause panel:
  - shown when `paused-nodes` contains current node
  - prompt editor
  - send prompt
  - continue
  - displays agent/node/session identity clearly
- Footer:
  - run/cancel/resume shortcuts
  - server URL
  - connection status

State model:

```ts
interface AflowRunViewState {
  run?: ApiRunRecord;
  events: ApiRunLogEvent[];
  nodes: Record<string, NodeViewState>;
  pausedNodes: PausedNodeSession[];
  interactions: Record<string, RunInteraction>;
  connection: "connecting" | "live" | "reconnecting" | "closed";
  promptPendingByPauseKey: Record<string, boolean>;
}
```

Important behavior:

- SSE replay should initialize the dashboard.
- Reconnect should use `replay=false` only after current state has been hydrated.
- If SSE dies, fall back to polling `GET /api/runs/:id` and `GET /api/runs/:id/logs?tail=...`.
- Cancel button calls server cancel and lets server state drive UI.
- No global run lock in Aflow. Multiple runs are allowed.

## Pause Interaction Plan

Runtime pause must use ACP, not native CLI.

Flow:

1. Server emits node status `paused`.
2. Aflow calls `GET /api/runs/:id/paused-nodes`.
3. TUI shows pause panel:
   - workflow
   - run id
   - node id/title
   - specflow session id
   - agent server id
4. User can send prompt:
   - `POST /api/runs/:id/paused-nodes/:nodeId/prompt`
   - disable prompt while server has `promptPending`
5. User can continue:
   - `POST /api/runs/:id/paused-nodes/:nodeId/continue`
   - reject continue while prompt is pending

Existing server already enforces:

- run must still be `running`
- node must currently be authorized for paused interaction
- prompt cannot be empty
- prompt cannot run concurrently for the same pause
- continue cannot happen while prompt is pending

Impact:

- No server changes required.
- Aflow must render clear errors for 409 statuses.

## Agent Auth And Registry Install Plan

Current server already supports:

- `GET /api/agent-servers`
- `GET /api/agent-servers/registry`
- `PUT /api/agent-servers/:id`
- `GET /api/agent-servers/:id/auth`
- `POST /api/agent-servers/:id/auth/:methodId`
- auth terminal events/input/resize/cancel/check
- capability refresh

Aflow should expose the same operations in TUI:

- list configured agents
- install/add registry ACP agents
- add custom ACP server
- add headless command agent
- inspect auth
- run env-var auth flow
- run terminal auth flow inside Aflow TUI
- refresh capabilities

Impact:

- No server changes required.
- Existing browser UI remains unaffected.

## Native Agent Continuation

### Boundary

Native handoff happens after a run or by explicit user action. It is not used for runtime pause.

### Native Adapter Table

Create `packages/aflow/src/native/native-agent-adapters.ts`:

```ts
export interface NativeAgentAdapter {
  id: string;
  displayName: string;
  agentServerIds?: string[];
  registryIds?: string[];
  commandCandidates: string[];
  supportsNativeResume: "yes" | "no" | "unknown";
  helpCommand?: string[];
  detect(commandEnv: CommandEnv): Promise<NativeDetectionResult>;
  buildResumeCommand(input: NativeResumeInput): NativeResumeCommand | undefined;
}
```

Session input:

```ts
interface NativeResumeInput {
  agentSession: AgentSessionRecord;
  run?: ApiRunRecord;
  acpSessionId: string;
  workspaceRoot: string;
  suggestedContinuationPrompt?: string;
}
```

Output:

```ts
interface NativeResumeCommand {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  display: string;
  confidence: "known" | "best-effort" | "manual-required";
  reason: string;
}
```

This table must be independent of the ACP registry. The registry tells us how to run ACP. Native resume is a different CLI contract.

Adapter statuses should be modeled explicitly:

- `resume`: native CLI supports a direct resume command such as `--resume` or `resume`.
- `continue`: native CLI supports continuation but under another name such as `--continue`, `--session`, `--id`, `threads continue`, or checkpoint resume.
- `selector`: native CLI has a history/resume selector but no reliable session-id template.
- `acp-only`: ACP load/resume exists but no known native CLI resume command.
- `unknown`: no known public native resume path.
- `unsupported`: known not to support native resume.

The registry resume research appended to this document should seed the first adapter file. The initial adapter implementation should not pretend every command template is fully reliable; each entry should expose confidence and a human-readable caveat.

Minimum useful first adapter entries:

- `claude-acp` -> `claude --resume {sessionId?}` best effort.
- `codex-acp` -> `codex resume {sessionId?}` best effort.
- `gemini` -> `gemini --resume {sessionId?}` best effort.
- `qwen-code` -> `qwen --resume {sessionId?}` best effort.
- `cursor` -> `cursor-agent --resume {sessionId?}` and alternate `cursor-agent resume {sessionId?}`.
- `goose` -> `goose session --resume {sessionId?}`.
- `opencode` -> `opencode --continue` or `opencode --session {sessionId}` caveated as continue/session, not direct resume.
- `amp-acp` -> `amp threads continue {sessionId?}` caveated.
- unknown registry ids -> manual command flow.

Session id mapping warning:

- `AgentSessionRecord.acpSessionId` is always known for ACP sessions.
- Native CLI session ids may or may not equal ACP session ids.
- An adapter may use `acpSessionId` only when the agent's ACP/native mapping is known or when confidence is marked `best-effort`.
- Otherwise Aflow should offer a selector command or manual command input.

### Terminal Handoff

Implement `TerminalHandoffController`:

```ts
async function runNativeCommand(command: NativeResumeCommand, ui: AflowTerminalOwner): Promise<NativeHandoffResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Native handoff requires a real TTY.");

  ui.suspendForExternalProcess();
  const ignoreSigint = () => {};
  process.on("SIGINT", ignoreSigint);
  try {
    const code = await spawnWithInheritedStdio(command);
    return { code };
  } finally {
    process.removeListener("SIGINT", ignoreSigint);
    ui.resumeAfterExternalProcess();
  }
}
```

Spawn details:

- use async `spawn`, not `spawnSync`
- `stdio: "inherit"`
- `shell: process.platform === "win32"` when needed
- pass cwd/env from adapter
- wait for `close`
- after return, refresh server run/session state

What this gives:

- best native UX
- native child owns the real terminal
- Aflow returns only after child exits

What this does not give:

- Shift+Esc immediate return
- guaranteed transcript capture
- browser support

If future UX requires forced escape or output replay, add PTY/tmux relay as a second backend:

```txt
handoff backend = inherit | bun-terminal | node-pty | tmux
```

Do not build this until the product truly needs it.

## Workflow Authoring Plan

Workflow authoring should be structured, not free-form YAML string manipulation.

Create helpers:

- `workflow-draft.ts`
  - in-memory draft model
  - add session
  - add input node
  - add step node
  - add gate node
  - add edge
  - normalize ids
- `canvas-builder.ts`
  - stable layout defaults
  - avoids overlapping initial nodes
  - preserves existing layout when adapting
- `workflow-validation.ts`
  - wraps `assertServerRunnableAgentFlow`
  - returns structured error list for LLM/tool output
- `yaml-roundtrip.ts`
  - only if Aflow edits YAML files directly
  - prefer server `CanvasDoc` APIs when possible

LLM should not manually concatenate YAML. It should call tools that create or mutate structured workflow documents.

## Validation Policy

Keep current behavior:

- Server/browser run path allows `pauseAfterRun`.
- Server validation blocks `pauseAfterRun` on headless agents.
- Old `specflow run` CLI still blocks all pause nodes because it directly executes without pause UI.

Aflow path:

- Aflow run uses server API, so pause nodes are allowed.
- Aflow validate uses server-runnable validation, not old CLI-runnable validation.
- Headless agents remain valid for automated nodes that do not pause.
- Headless agents are invalid for interactive pause nodes.

Potential later improvement:

- Add a validation mode enum:
  - `server`
  - `direct-cli`
  - `aflow`
  - `browser`

This can make error messages clearer, but first implementation can use existing functions.

## Server Change Impact Assessment

### No Server Changes Needed For

- workflow run
- workflow cancel
- workflow resume
- run dashboard
- SSE status/logs
- live pause prompt/continue
- ACP restored sessions
- agent server list/configuration
- registry listing
- auth flows
- terminal auth
- run completion session summary

### Minimal Additive Server Changes Recommended

1. `/api/health` adds `workspaceRoot`, `serverId`, `apiVersion`.
   - Risk: very low, additive JSON fields.
   - Existing UI likely ignores extra fields.
   - Test: update health test or add one.

2. Optional `.aflow/.specflow/server.json` process marker.
   - Risk: low, new file only.
   - Benefit: robust connect-first discovery.
   - Must handle stale pid/url.

3. Optional `GET /api/canvases/:id/validate`.
   - Risk: low if read-only.
   - Benefit: browser and Aflow share exactly one validation endpoint.
   - Not required for first Aflow delivery.

### Server Changes To Avoid Initially

- Do not change executor semantics.
- Do not change pause store semantics.
- Do not change run status enum.
- Do not merge native resume into ACP registry.
- Do not add global run locking.
- Do not move all UI API types in the first PR unless type sharing becomes blocking.

## Existing Feature Risk Register

### Risk: Starting A Second Server Cancels Active Runs

Cause:

- `createApiHandler()` reconciles running runs as interrupted.

Mitigation:

- Implement connect-first startup before `startSpecflowServer()`.
- Add health workspace identity.
- Never start a new server for the same workspace when a healthy one exists.

### Risk: Aflow Uses Old Direct CLI Run Path

Cause:

- `specflow run` calls `assertCliRunnableAgentFlow()` and rejects pause nodes.

Mitigation:

- Aflow must use `POST /api/canvases/:id/run`.
- Keep direct CLI path unchanged for backwards compatibility.

### Risk: Browser And TUI Drift

Cause:

- Duplicated API types and behavior.

Mitigation:

- Aflow client mirrors existing API behavior first.
- Later move API DTOs to shared package.
- Add integration tests against real `createApiHandler()`.

### Risk: Native Handoff Kills Aflow On Ctrl+C

Cause:

- Parent and child can both receive terminal signals.

Mitigation:

- Suspend Aflow UI.
- Temporarily install SIGINT ignore/guard while child owns terminal.
- Remove guard in finally.
- Prefer async spawn with inherited stdio.

### Risk: Native Resume Command Is Wrong

Cause:

- ACP session id is not necessarily native CLI session id.

Mitigation:

- Adapter table must encode confidence and required fields.
- Unknown adapters show manual command input.
- Do not infer native resume from ACP capabilities.

### Risk: Auth Flow Missing From TUI

Cause:

- Run endpoint returns 409 auth required.

Mitigation:

- Implement auth panel early, before full workflow authoring.
- Reuse existing server auth APIs and terminal auth SSE.

### Risk: Aflow TUI Over-Customization Delays Runtime

Cause:

- Rewriting the full Pi TUI up front is expensive.

Mitigation:

- Phase 1 uses Pi session/runtime and extension commands.
- Phase 2 introduces dedicated Aflow run dashboard.
- Phase 3 polishes visual system.

## Phased Implementation Plan

### Phase 0: Safety And Scaffolding

Deliverables:

- `packages/aflow` package scaffold.
- `aflow` bin entry.
- Typecheck wiring.
- `connectOrStartSpecflowServer()`.
- Minimal `/api/health` additive server identity fields.
- Optional server marker file.

Acceptance:

- `bun run aflow -- --version` works.
- Aflow connects to an already running same-workspace server instead of starting another.
- Aflow starts a server when none exists.
- Existing `specflow` UI still starts.
- Existing server tests pass.

Tests:

- unit test connect/start behavior with fake health responses
- server health response test
- startup test that does not call `startSpecflowServer()` when compatible server exists

### Phase 1: Aflow Agent Shell

Deliverables:

- Aflow system prompt.
- Coding-agent runtime setup.
- Pi-compatible CLI argument parser for session/model/tool/system-prompt options.
- Aflow extension factory.
- Slash command registration for:
  - `/specflow-create`
  - `/specflow-fork-adapt`
  - `/specflow-validate`
  - `/specflow-run`
  - `/specflow-resume`
  - `/specflow-resume-session`
- Basic model/session/tool behavior inherited from coding-agent.
- Preservation of common Pi commands that operate on the coding-agent session.

Acceptance:

- User can open Aflow TUI.
- Aflow answers with Specflow-aware identity.
- Slash commands appear and execute.
- Session persists like coding-agent sessions.
- `aflow --resume`, `aflow --continue`, `aflow --session`, and `aflow --fork` do not regress compared with the underlying Pi runtime behavior.
- Built-in tools remain available unless user disables them.

Tests:

- system prompt override test
- CLI parse compatibility test
- command registration test
- tool allow/deny test
- simple prompt smoke test with mocked model if available

### Phase 2: Specflow Client And Validate

Deliverables:

- `SpecflowClient`
- typed request/error handling
- local validate command using `@specflow/server` validators
- workflow selection helper

Acceptance:

- `/specflow-validate path-or-id` reports success/failure.
- Headless pause node fails validation.
- Automated headless node remains valid.
- Missing session/agent errors match current server validation semantics.

Tests:

- validation unit tests
- API client error tests
- no regression in `packages/server/src/agentflow-validation.ts`

### Phase 3: Run Dashboard And Live Pause

Deliverables:

- `/specflow-run`
- run dashboard state model
- SSE subscription
- cancel
- pause prompt
- pause continue
- interaction response
- auth required flow

Acceptance:

- Aflow can start a workflow through server API.
- Node statuses update live.
- Terminal/log chunks display.
- `pauseAfterRun` node pauses in Aflow TUI.
- User can send prompt to paused node and continue.
- Cancel is idempotent.
- Resume after cancelled/error run starts a continuation run.

Tests:

- integration with fake ACP agent
- pause prompt/continue test
- cancel test
- resume-workflow test
- SSE replay/reconnect test

### Phase 4: Agent Server Management In TUI

Deliverables:

- agent server list
- registry list/install/edit
- custom ACP config
- headless config
- auth inspect
- env-var auth
- terminal auth panel
- capability refresh

Acceptance:

- User can configure agents without browser.
- Run auth errors can be resolved inside Aflow.
- Terminal auth output/input works in TUI.

Tests:

- agent server API client tests
- terminal auth fake session test
- capability refresh error handling test

### Phase 5: Native Continuation

Deliverables:

- native adapter table skeleton
- command detection
- session summary panel
- manual command fallback
- inherited-stdio handoff
- post-handoff state refresh

Acceptance:

- Run completion shows sessions.
- Known adapter shows recommended native command.
- Unknown adapter allows manual command.
- Native command owns terminal and Aflow returns after exit.
- Ctrl+C in child does not kill Aflow process.
- Non-TTY environment reports a clear error.

Tests:

- fake native CLI handoff test
- command template unit tests
- Windows shell flag unit test
- SIGINT guard test where feasible

### Phase 6: Workflow Create And Fork-Adapt

Deliverables:

- workflow draft builder
- create command
- fork/adapt command
- graph summary TUI
- structured diff summary
- save via server API
- validate before save/run

Acceptance:

- Aflow can create a workflow from a goal.
- Aflow can fork an existing workflow and adapt it.
- Saved workflow opens in existing browser UI.
- Generated workflow validates.
- User can immediately run generated workflow.

Tests:

- builder tests
- layout tests
- validate generated doc tests
- save/fetch roundtrip tests

### Phase 7: Hardening And Product Polish

Deliverables:

- visual theme pass
- keyboard shortcuts
- empty/loading/error states
- reconnect behavior
- telemetry/log privacy audit if applicable
- build binary support
- docs

Acceptance:

- Aflow feels like a cohesive cockpit, not just command output.
- No text overlaps in common terminal sizes.
- Error states are actionable.
- Existing Specflow browser UI and CLI behavior remains intact.

Tests:

- typecheck all packages
- relevant bun tests
- terminal snapshot tests if feasible
- manual matrix on Linux/macOS/Windows terminal behavior

## Testing Strategy

Run after implementation phases:

```bash
bun test packages/server
bun test packages/bridge
bun test packages/agent-proxy
bun test packages/cli
bun test packages/aflow
bun run typecheck
```

Specific test fixtures:

- fake ACP agent that supports pause/resume
- fake headless agent
- fake native CLI command that exits with configurable code
- fake server health responses
- fake EventSource stream for Aflow client

Regression gates:

- existing browser tests should not need major changes
- existing `specflow run` tests should keep rejecting `pauseAfterRun`
- existing server run path should keep allowing `pauseAfterRun` except headless
- resume idempotency tests should remain green

## Development Order Recommendation

The cleanest engineering order:

1. Add server health identity and connect-first helper.
2. Scaffold `packages/aflow`.
3. Build `SpecflowClient`.
4. Bring up Aflow SDK shell with system prompt override.
5. Implement validate and run commands.
6. Implement live run dashboard and pause panel.
7. Implement auth panels.
8. Implement native adapter table and handoff.
9. Implement workflow create/fork-adapt.
10. Polish TUI and shared API types.

This order keeps risk low because the first usable Aflow path is:

```txt
open aflow -> validate workflow -> run workflow -> pause/continue -> show sessions
```

Native handoff and workflow generation are layered on after runtime correctness is proven.

## Answer To The Server Question

Your instinct is mostly right: Aflow should not require a new server architecture. It should send requests to the existing Specflow server APIs.

The one thing I would not ignore is lifecycle safety. Because the server currently repairs stale `running` state on startup, Aflow must connect to an existing same-workspace server before starting a new one. To do that robustly, the server should expose workspace identity in `/api/health` or a marker file. That is a small additive safety change, not a runtime redesign.

Everything else can be built in Aflow as a client:

- workflow run
- pause interaction
- cancel
- resume workflow
- inspect sessions
- ACP restore
- agent install/config/auth
- native handoff

Server changes beyond health identity and optional validate convenience should be treated as later optimizations, not prerequisites.

## Open Inputs Needed From User

- Native help/resume table for registry agents.
- Desired package dependency strategy for `@earendil-works/pi-coding-agent`:
  - published package pin
  - local link during development
  - vendored internal dependency
- Visual design preference for the final Aflow TUI:
  - minimal Pi-derived shell first
  - fully custom cockpit immediately
- Whether Aflow should write native manual command overrides into:
  - `.aflow/.specflow/aflow-native-overrides.json`
  - user-level config
  - both

## Non-Goals For First Implementation

- Browser native handoff.
- PTY/tmux relay.
- Shift+Esc forced escape from a native agent.
- Guaranteed transcript capture from native CLI.
- Global single-run lock.
- Replacing Specflow server runtime.
- Rewriting existing browser UI.
- Moving all API DTOs to shared in the first PR.

## registry agents resume evaluate

2026-06-02

| Agent          |                  是否支持 resume 命令 | 形式                                       | 备注                                                                                                           |
| -------------- | ------------------------------: | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Agoragentic    |                         ❓未见明确支持 | —                                        | ACP registry 只显示 `agoragentic-mcp --acp` 适配器；未见公开 `resume` / `--resume` CLI 文档。([GitHub][1])                 |
| Amp            |               ⚠️支持恢复，但不是 resume | `amp threads continue [threadId]`        | Sourcegraph 文档把它称为 thread resumption，但命令是 `threads continue`，不是 `resume`。([GitHub][2])                       |
| Auggie CLI     |                             ✅支持 | `--resume`，也有 `session resume`           | 支持 `auggie --resume [sessionId]` / `-r`，也支持 `auggie session resume [sessionId]`。([Augment Code][3])          |
| Autohand Code  |                             ✅支持 | 直接 `resume`                              | `autohand resume <sessionId>`。([Autohand AI][4])                                                             |
| Claude Agent   |                             ✅支持 | `--resume`                               | ACP wrapper 对应 Anthropic Claude；Claude Code 支持 `claude --resume` / `-r`，也有 `/resume`。([代理客户端协议][5])          |
| Cline          |               ⚠️支持恢复，但不是 resume | `--id <session-id>`                      | Cline CLI 文档是用 `--id` 恢复指定 session，未见 `--resume` / `resume`。([Cline][6])                                     |
| Codebuddy Code |                             ✅支持 | `--resume`                               | `codebuddy --resume [sessionId]` / `-r`。([CodeBuddy][7])                                                     |
| Codex CLI      |                             ✅支持 | 直接 `resume`                              | `codex resume`，另有 `codex exec resume [SESSION_ID]`。([OpenAI 开发者][8])                                         |
| Cortex Code    |                             ✅支持 | `--resume`                               | `cortex --resume <session_id>`；交互内也有 `/resume`。([Snowflake 文档][9])                                           |
| Corust Agent   |                         ❓未见明确支持 | —                                        | registry 显示为 `corust-agent-acp` ACP 二进制；未见公开 `resume` / `--resume` CLI 文档。([GitHub][1])                      |
| crow-cli       |                         ❓未见明确支持 | —                                        | registry 显示 `crow-cli acp`；未见公开 `resume` / `--resume` CLI 文档。([GitHub][1])                                   |
| Cursor         |                             ✅支持 | 两者都有                                     | `cursor-agent --resume [thread-id]`，也可 `cursor-agent resume`。([Cursor - Community Forum][10])                |
| DeepAgents     |                             ✅支持 | `--resume`                               | Deep Agents Code 文档为 `dcode --resume [ID]` / `-r`。([LangChain 文档][11])                                       |
| DimCode        |                             ✅支持 | 直接 / 嵌套 `resume`                         | registry 对应 `dimcode@0.0.75`；该包 help 显示 `dim exec resume <id\|--last>`。([GitHub][12])                        |
| Dirac          |               ⚠️支持恢复，但不是 resume | `dirac history`                          | 文档说明 `dirac history` 可查看并恢复 previous tasks。([GitHub][13])                                                    |
| Factory Droid  |                             ✅支持 | `--resume`                               | `droid --resume [sessionId]` / `-r`。([Factory Documentation][14])                                            |
| fast-agent     |                             ✅支持 | `--resume`                               | `fast-agent go --resume <id\|latest>`。([fast-agent documentation][15])                                       |
| Gemini CLI     |                             ✅支持 | `--resume`                               | `gemini --resume` / `-r`；也有 `/resume`。([Gemini CLI][16])                                                     |
| GitHub Copilot |                             ✅支持 | `--resume`                               | `copilot --resume[=VALUE]`；交互内 `/resume [SESSION-ID]`。([GitHub Docs][17])                                    |
| GLM Agent      |                     ⚠️ACP 层支持恢复 | ACP `session/load` / resume 机制           | registry/ACP 描述写明支持 session load/fork/resume；但未见独立 shell CLI 的 `resume` / `--resume`。([代理客户端协议][18])         |
| goose          |                             ✅支持 | `--resume`                               | Goose CLI 是 `goose session --resume` / `-r`。([Goose][19])                                                    |
| Grok Build     |                             ✅支持 | `--resume`                               | xAI 文档列出 `grok --resume <ID>` / `-r`，交互内也有 `/resume`。([xAI 文档][20])                                          |
| Junie          |               ⚠️支持恢复，但不是 resume | `--session-id` / `/history`              | JetBrains 文档用 `--session-id` 恢复指定 session，或 `/history` 选择历史会话。([Junie][21])                                  |
| Kilo           |               ⚠️支持继续，但不是 resume | `--continue`                             | Kilo CLI 文档列的是 `kilo --continue` / `-c`，未见 `--resume`。([Kilo][22])                                           |
| Kimi CLI       |                             ✅支持 | `--resume`                               | `kimi --resume [ID]` / `-r`；文档也提到 `/resume`。([Kimi][23])                                                     |
| Minion Code    |                             ✅支持 | `--resume`                               | registry 对应 `minion-code@0.1.44`；该包 help 显示 `minion-code main --resume/-r <id>`。([GitHub][12])               |
| Mistral Vibe   |                             ✅支持 | `--resume`                               | `vibe --resume SESSION_ID`；交互内也有 `/resume`。([GitHub][24])                                                    |
| Nova           |               ⚠️支持继续，但不是 resume | `--continue`                             | registry 对应 `@compass-ai/nova@1.1.13`；CLI help 显示 `nova start --continue`，未见 `--resume`。([GitHub][12])       |
| OpenCode       | ⚠️CLI 不是 resume；TUI 有 `/resume` | `--continue` / `--session`；TUI `/resume` | CLI 文档列 `--continue`、`--session/-s`；TUI slash command 有 `/resume` alias。([OpenCode][25])                     |
| pi ACP         |                           ✅间接支持 | `/resume`，不是 shell `resume`              | `pi-acp` 仓库说明 ACP sessions 可在 Pi 里 `/resume`；它是 ACP adapter，不是独立 `pi-acp resume`。([GitHub][26])              |
| Poolside       |                             ✅支持 | `--resume`                               | Poolside CLI reference：`pool --resume` / `-r` 恢复上次或指定 session。([Poolside 文档][27])                            |
| Qoder CLI      |                             ✅支持 | `--resume`                               | 官方文档示例为 `qodercli --resume <session-id>`，中文文档也列 `-r` 恢复指定会话。([Qoder][28])                                    |
| Qwen Code      |                             ✅支持 | `--resume`                               | `qwen --resume <session-id>` 或 `qwen --resume` 选择器。([Qwen Code][29])                                         |
| siGit Code     |                         ❓未见明确支持 | —                                        | README 说明 ACP mode 和 terminal mode，但未见公开 `resume` / `--resume` 用法。([GitHub][30])                             |
| Stakpak        |   ⚠️支持 checkpoint 恢复，但不是 resume | `-c <checkpoint-id>`                     | README/Getting Started 写的是 “Resume execution from a checkpoint: `stakpak -c <checkpoint-id>`”。([GitHub][31]) |
| VT Code        |                             ✅支持 | `--resume`                               | `vtcode --resume` 打开选择器，或 `vtcode --resume <SESSION_ID>`。([GitHub][32])                                      |

[1]: https://raw.githubusercontent.com/JetBrains/junie/main/registry-nightly.json "raw.githubusercontent.com"
[2]: https://github.com/sourcegraph/amp-examples-and-guides/blob/main/guides/cli/README.md "https://github.com/sourcegraph/amp-examples-and-guides/blob/main/guides/cli/README.md"
[3]: https://docs.augmentcode.com/cli/reference "https://docs.augmentcode.com/cli/reference"
[4]: https://autohand.ai/docs/working-with-autohand-code/cli-reference?utm_source=chatgpt.com "CLI Reference - Autohand Docs"
[5]: https://agentclientprotocol.com/get-started/registry "https://agentclientprotocol.com/get-started/registry"
[6]: https://docs.cline.bot/cli/cli-reference "CLI Reference - Cline"
[7]: https://www.codebuddy.ai/docs/cli/cli-reference "https://www.codebuddy.ai/docs/cli/cli-reference"
[8]: https://developers.openai.com/codex/cli/features?utm_source=chatgpt.com "Codex CLI features"
[9]: https://docs.snowflake.com/en/user-guide/cortex-code/cli-reference "https://docs.snowflake.com/en/user-guide/cortex-code/cli-reference"
[10]: https://forum.cursor.com/t/cursor-cli-chat-from-previous-message/147894 "https://forum.cursor.com/t/cursor-cli-chat-from-previous-message/147894"
[11]: https://docs.langchain.com/oss/python/deepagents/code/overview "https://docs.langchain.com/oss/python/deepagents/code/overview"
[12]: https://github.com/JetBrains/junie/blob/main/registry-nightly.json "https://github.com/JetBrains/junie/blob/main/registry-nightly.json"
[13]: https://github.com/dirac-run/dirac "https://github.com/dirac-run/dirac"
[14]: https://docs.factory.ai/reference/cli-reference "https://docs.factory.ai/reference/cli-reference"
[15]: https://fast-agent.ai/ref/go_command/ "https://fast-agent.ai/ref/go_command/"
[16]: https://geminicli.com/docs/cli/session-management/?utm_source=chatgpt.com "Session management | Gemini CLI"
[17]: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview?utm_source=chatgpt.com "Using GitHub Copilot CLI"
[18]: https://agentclientprotocol.com/get-started/registry?utm_source=chatgpt.com "ACP Registry - Agents"
[19]: https://goose-docs.ai/docs/guides/goose-cli-commands/ "https://goose-docs.ai/docs/guides/goose-cli-commands/"
[20]: https://docs.x.ai/build/cli/headless-scripting "https://docs.x.ai/build/cli/headless-scripting"
[21]: https://junie.jetbrains.com/docs/junie-cli-usage.html "https://junie.jetbrains.com/docs/junie-cli-usage.html"
[22]: https://kilo.ai/docs/code-with-ai/platforms/cli "https://kilo.ai/docs/code-with-ai/platforms/cli"
[23]: https://www.kimi.com/code/docs/kimi-code-cli/reference/kimi-command.html "https://www.kimi.com/code/docs/kimi-code-cli/reference/kimi-command.html"
[24]: https://github.com/mistralai/mistral-vibe?utm_source=chatgpt.com "mistralai/mistral-vibe: Minimal CLI coding agent by ..."
[25]: https://opencode.ai/docs/cli/ "https://opencode.ai/docs/cli/"
[26]: https://github.com/svkozak/pi-acp?utm_source=chatgpt.com "svkozak/pi-acp: ACP adapter for pi coding agent"
[27]: https://docs.poolside.ai/cli/cli-reference "CLI reference - Poolside"
[28]: https://docs.qoder.com/en/cli/using-cli?utm_source=chatgpt.com "Using CLI"
[29]: https://qwenlm-qwen-code.mintlify.app/cli/overview "https://qwenlm-qwen-code.mintlify.app/cli/overview"
[30]: https://github.com/getsigit/sigit?utm_source=chatgpt.com "getsigit/sigit: A local coding agent ..."
[31]: https://raw.githubusercontent.com/stakpak/agent/v0.2.78/README.md?utm_source=chatgpt.com "https://raw.githubusercontent.com/stakpak/agent/v0..."
[32]: https://github.com/vinhnx/vtcode/blob/main/docs/user-guide/getting-started.md?utm_source=chatgpt.com "VTCode/docs/user-guide/getting-started.md at main"
