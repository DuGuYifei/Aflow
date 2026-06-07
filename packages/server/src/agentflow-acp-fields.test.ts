import { describe, expect, test } from "bun:test";
import { parseAgentFlowSource, stringifyAgentFlowSource } from "./agentflow/agentflow-source";

const MCP_JSON = '[{"name":"fs","command":"uvx","args":["mcp-server-filesystem","/tmp"],"env":[]}]';

function flow(body: string): string {
  return `version: 1\nname: ACP fields\n${body}`;
}

describe("agentflow ACP per-node fields", () => {
  test("parses modeId + configOptions on a step node and mcpServers on a session", () => {
    const canvasDocument = parseAgentFlowSource(flow(`sessions:
  judge:
    agentServerId: claude-acp
    mcpServers: '${MCP_JSON}'
nodes:
  n1:
    kind: step
    title: Plan
    prompt: do it
    session: judge
    modeId: plan
    configOptions:
      model: claude-sonnet-4-5
      thought_level: high
edges: []
`), "wf");
    const session = canvasDocument.sessions.find((session) => session.id === "judge");
    expect(session?.mcpServers).toBe(MCP_JSON);
    const step = canvasDocument.nodes.find((node) => node.id === "n1");
    expect(step).toMatchObject({ modeId: "plan", configOptions: { model: "claude-sonnet-4-5", thought_level: "high" } });
  });

  test("round-trips the new fields through stringify → parse", () => {
    const source = flow(`sessions:
  judge:
    agentServerId: claude-acp
    mcpServers: '${MCP_JSON}'
nodes:
  n1:
    kind: step
    title: Plan
    prompt: do it
    session: judge
    modeId: plan
    configOptions:
      model: claude-sonnet-4-5
  g1:
    kind: gate
    title: Route
    decisionCriteria: pick one
    configOptions:
      model: claude-haiku-4-5
    branches:
      pass: {}
      fail: {}
edges:
  - from: n1
    to: g1
`);
    const canvasDocument = parseAgentFlowSource(source, "wf");
    const reparsed = parseAgentFlowSource(stringifyAgentFlowSource(canvasDocument), "wf");
    expect(reparsed.sessions[0].mcpServers).toBe(MCP_JSON);
    const step = reparsed.nodes.find((node) => node.id === "n1");
    expect(step).toMatchObject({ modeId: "plan", configOptions: { model: "claude-sonnet-4-5" } });
    const gate = reparsed.nodes.find((node) => node.id === "g1");
    expect(gate).toMatchObject({ configOptions: { model: "claude-haiku-4-5" } });
  });

  test("rejects modeId on a gate node", () => {
    expect(() => parseAgentFlowSource(flow(`sessions:
  judge:
    agentServerId: claude-acp
nodes:
  g1:
    kind: gate
    title: Route
    decisionCriteria: pick
    modeId: plan
    branches:
      a: {}
edges: []
`), "wf")).toThrow(/must not define modeId/);
  });

  test("rejects invalid mcpServers JSON", () => {
    expect(() => parseAgentFlowSource(flow(`sessions:
  judge:
    agentServerId: claude-acp
    mcpServers: 'not json {'
nodes:
  n1:
    kind: step
    title: x
    prompt: y
    session: judge
edges: []
`), "wf")).toThrow(/must be valid JSON/);
  });

  test("rejects non-array mcpServers JSON", () => {
    expect(() => parseAgentFlowSource(flow(`sessions:
  judge:
    agentServerId: claude-acp
    mcpServers: '{"stdio": {}}'
nodes:
  n1:
    kind: step
    title: x
    prompt: y
    session: judge
edges: []
`), "wf")).toThrow(/must be a JSON array/);
  });
});
