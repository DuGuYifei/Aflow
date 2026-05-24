# ADR-003: ACP connection and workflow session management

## Status

Accepted

## Context

Specflow workflows can assign multiple nodes to the same logical session, while
different sessions must remain independent unless content is explicitly
transmitted through the workflow. A gate also needs to evaluate a branch without
polluting the preceding conversation when an agent can copy that context.

ACP exposes two separate concepts:

- `session/new` creates an independent session on an existing agent connection.
- `session/fork` creates a new session from an existing session's context, but
  only agents that advertise `sessionCapabilities.fork` can be relied on to do
  this.

In the tested ACP agents, `codex-acp@0.14.0` accepts multiple `session/new`
requests on one connection but does not advertise ACP `session/fork`.
`claude-agent-acp@0.37.0` advertises and successfully executes ACP
`session/fork`. Slash commands that an agent accepts are not substitutes for
these protocol capabilities because Specflow cannot track an internal branch
without a returned ACP session id.

## Decision

Each workflow run owns an `AgentProxySessionPool`. For a given working
directory, agent server, and effective directory policy, the pool starts one
`AcpAgentConnection` and uses that ACP process for all logical workflow
sessions in the group.

The connection maintains a mapping from Specflow workflow session id to ACP
session id:

- The first prompt for a workflow session creates its ACP session with
  `session/new`.
- Later prompts for the same workflow session reuse that ACP session.
- Different workflow sessions receive independent ACP sessions; cross-session
  context must be sent explicitly by workflow edge transmission.

When evaluating a gate, the executor requests a derived workflow session based
on the preceding content session:

- If the initialized agent advertises `sessionCapabilities.fork`, the
  connection calls ACP `session/fork` through the SDK
  `unstable_forkSession(...)` method and evaluates the gate in the returned
  child session.
- If fork is not advertised, the gate evaluation uses the parent ACP session
  and is recorded as not forked. Specflow does not manufacture a child-session
  record for an untracked agent-internal branch.

Run records store the actual ACP session id, advertised `load`, `resume`, and
`fork` capabilities, and the parent Specflow session only for a successful
fork. The Agent sessions UI presents those capabilities and the parent link.
Historical `Inspect` and `Resume` operate through ACP `load`/`resume`
capabilities rather than through fork behavior.

## Consequences

- A workflow can use multiple independent logical sessions without spawning an
  ACP process per session.
- Agents without standard fork support still execute gates, but the evaluation
  continues in the source context.
- The pool is scoped to one run and closes its ACP connections when execution
  completes; connections are not reused across separate runs.
- `AcpAgentConnection` currently serializes prompts through one
  connection-level queue. Multiple logical sessions share a process, but they
  do not execute prompts concurrently. Supporting concurrent session turns
  would require routing callbacks and cancellation state per active session.

## Implementation

- `packages/agent-proxy/src/session-pool.ts` owns connection pooling.
- `packages/agent-proxy/src/runtimes/acp/connection.ts` owns ACP session
  creation, reuse, fork capability checks, and fallback behavior.
- `packages/bridge/src/execution/executor.ts` requests gate-derived sessions
  and records returned session metadata.
- `packages/server/src/agent-session-store.ts` and
  `packages/ui/src/components/sessions-bar.tsx` expose recorded capabilities
  and parent sessions.

The pooling and fork behavior is covered by
`packages/agent-proxy/src/session-pool.test.ts`; gate session selection is
covered by `packages/bridge/src/execution/executor.test.ts`.
