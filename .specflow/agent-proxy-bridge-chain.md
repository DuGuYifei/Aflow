# Bridge to Agent Proxy Chain

This document records how workflow execution reaches ACP agent CLIs.

## Runtime Ownership

- `packages/bridge` owns workflow execution order.
- `packages/agent-proxy` owns agent server resolution, ACP process startup, ACP session lifecycle, and client-side ACP handlers.
- `packages/workflow` stores logical agent/session references only; it does not spawn processes.

## Call Path

1. `WorkflowExecutor.run(workflow, initialInput)` starts a workflow run.
2. At the start of the run, bridge creates one `AgentProxySessionPool` unless a custom `agentRunner` was injected for tests or alternate runtimes.
3. For each agent node, bridge renders the node prompt and creates an `AgentInvocation`.
4. For each tagged edge with a handoff, bridge renders the edge handoff prompt and creates another `AgentInvocation`.
5. Bridge calls the active `AgentRunner` with:
   - `agentServerId`: resolved from the workflow agent definition.
   - `workflowSessionId`: the workflow session selected by the node or edge handoff.
   - `runId`: the current workflow run id.
   - `cwd`: the project root.
   - `prompt`: the rendered node or edge prompt.
   - `onTerminalEvent`: callback that stores terminal output with run/node/invocation metadata.
6. The default runner is `AgentProxySessionPool.run(request)`.
7. The pool resolves the configured agent server through `AgentServerStore`.
8. For ACP agent servers, the pool starts or reuses an ACP session backed by `AcpAgentSession`.
9. `AcpAgentSession` uses `AcpAgentClient`, which uses the official `@agentclientprotocol/sdk`:
   - `acp.ndJsonStream(...)`
   - `acp.ClientSideConnection`
10. The ACP CLI is spawned as a subprocess, connected over stdio, initialized, and sent prompts through `session/prompt`.

## Session Semantics

Specflow workflow sessions are the long-lived unit inside one workflow run.

The default bridge-to-agent-proxy path keys ACP runtimes by:

```text
cwd + agentServerId + workflowSessionId
```

That means:

- Multiple nodes using the same workflow session reuse the same ACP CLI process and ACP session.
- A tagged edge handoff using the same workflow session also reuses that same ACP session.
- Different workflow sessions spawn separate ACP CLI processes, even if they use the same `agentServerId`.
- Invocations without `workflowSessionId` fall back to a one-shot ACP run.
- At workflow completion or failure, bridge closes the session pool, which closes ACP sessions and kills subprocesses.

## ACP Client Capabilities

The client side currently advertises:

- File read/write.
- Terminal creation/output/wait/kill/release.
- Terminal auth.
- Form and URL elicitation.
- Position encodings.

The implemented client handlers support:

- `session/request_permission`
- `session/update`
- `fs/read_text_file`
- `fs/write_text_file`
- `terminal/create`
- `terminal/output`
- `terminal/wait_for_exit`
- `terminal/kill`
- `terminal/release`
- `elicitation/create`
- `elicitation/complete`
- extension requests and notifications

Permission and elicitation requests default to cancelled when no UI hook is installed. Future UI work should attach callbacks to surface these decisions to the user.

## Error Behavior

- If an ACP prompt returns a non-zero `AgentRunResult.exitCode`, bridge marks the `AgentInvocation` failed, marks the node failed, and fails the workflow run.
- Terminal events emitted before failure are preserved in `TerminalEventStore`.
- A failed pooled ACP session is closed and removed from the pool so later calls do not reuse a compromised process.

