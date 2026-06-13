import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { initWorkspace } from "./workspace";
import {
  generateCanvasLayout,
  listCanvases,
  loadCanvas,
  saveCanvas,
} from "./agentflow/canvas-store";
import { parseAgentFlowSource, stringifyAgentFlowSource } from "./agentflow/agentflow-source";
import { assertCliRunnableAgentFlow, assertRunnableAgentFlow, assertServerRunnableAgentFlow } from "./agentflow/agentflow-validation";
import type { CanvasDoc } from "./agentflow/canvas-doc";

describe("agentflow/canvas storage", () => {
  it("resolves authored keys into internal workflow references", () => {
    const canvasDocument = parseAgentFlowSource(`version: 1
name: Review
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  build:
    kind: step
    title: Build
    prompt: Implement
    session: codex
  done:
    kind: end
    title: Done
edges:
  - from: build
    to: done
`, "review-flow");

    expect(canvasDocument.id).toBe("review-flow");
    expect(canvasDocument.sessions[0]?.id).toBe("codex");
    expect(canvasDocument.nodes[0]?.id).toBe("build");
    expect(canvasDocument.edges[0]?.id).toBe("edge:build:->done");
  });

  it("round-trips an interactive pause checkpoint on step nodes", () => {
    const canvasDocument = parseAgentFlowSource(`version: 1
name: Pause
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  review:
    kind: step
    title: Review
    prompt: Review the change
    session: codex
    pauseAfterRun: true
edges: []
`, "pause-flow");

    expect(canvasDocument.nodes[0]).toMatchObject({ kind: "step", pauseAfterRun: true });
    expect(stringifyAgentFlowSource(canvasDocument)).toContain("pauseAfterRun: true");
  });

  it("rejects invalid authored keys and defers runnable session checks", () => {
    expect(() => parseAgentFlowSource(`version: 1
name: Invalid
sessions:
  bad session:
    agentServerId: codex-acp
nodes: {}
edges: []
`, "invalid-flow")).toThrow('session key "bad session"');

    const missingSession = `version: 1
name: Invalid
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  build:
    kind: step
    title: Build
    session: missing
edges: []
`;
    expect(() => parseAgentFlowSource(missingSession, "invalid-flow")).not.toThrow();
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(missingSession, "invalid-flow"))).toThrow('missing session "missing"');
  });

  it("saves draft fields without runnable values and only auto-fills aliases", () => {
    const canvasDocument = parseAgentFlowSource(`version: 1
name: Draft
sessions:
  codex: {}
nodes:
  input:
    kind: input
    required: false
  step:
    kind: step
  gate:
    kind: gate
  done:
    kind: end
edges: []
`, "draft-flow");

    expect(canvasDocument.sessions[0]).toMatchObject({ id: "codex", agentServerId: "" });
    expect(canvasDocument.nodes).toEqual([
      { kind: "input", id: "input", alias: "IN", title: "", variableName: "", required: false, sessionId: null },
      { kind: "step", id: "step", alias: "01", title: "", prompt: "", sessionId: "" },
      { kind: "gate", id: "gate", alias: "G1", title: "", decisionCriteria: "", branches: [] },
      { kind: "end", id: "done", alias: "END", title: "", sessionId: null },
    ]);
    const serialized = stringifyAgentFlowSource(canvasDocument);
    expect(serialized).toContain('agentServerId: ""');
    expect(serialized).toContain('session: ""');
    expect(serialized).toContain('variableName: ""');
    expect(serialized).toContain("required: false");
    expect(serialized).toContain("branches: {}");
    expect(() => assertRunnableAgentFlow(canvasDocument)).toThrow("must define agentServerId");
  });

  it("persists a canvas draft that is not runnable yet", async () => {
    const root = await tempProject();
    const canvasDocument: CanvasDoc = {
      id: "draft-canvas",
      name: "Draft canvas",
      sessions: [],
      nodes: [
        { kind: "step", id: "step", alias: "", x: 10, y: 20, w: 220, title: "", prompt: "", sessionId: null },
      ],
      edges: [],
    };

    await saveCanvas(canvasDocument.id, canvasDocument, root);
    const rawValue = await readFile(join(root, ".aflow/.specflow", "agentflow", "agentflows", "draft-canvas.yaml"), "utf8");
    expect(rawValue).toContain('alias: "01"');
    expect(rawValue).toContain('session: ""');
    const loaded = await loadCanvas(canvasDocument.id, root);
    expect(loaded.nodes[0]).toMatchObject({ kind: "step", alias: "01", title: "", prompt: "", sessionId: "" });
  });

  it("defers transfer configuration and gate execution checks until runnable validation", () => {
    const base = `version: 1
name: Invalid gate
sessions:
  codex:
    agentServerId: codex-acp
nodes:
  first:
    kind: step
    title: First
    prompt: First
    session: codex
  second:
    kind: step
    title: Second
    prompt: Second
    session: codex
  done:
    kind: end
    title: Done
  decide:
    kind: gate
    title: Decide
    decisionCriteria: Pick a branch
    branches:
      pass:
        label: pass
edges:
`;
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: decide
    transmit: true
    outputTag: result
`, "gate-transfer"))).toThrow("cannot declare transmission properties");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: decide
  - from: second
    to: decide
`, "gate-input-count"))).toThrow("accepts exactly one business input edge");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: second
    transmit: true
    outputTag: 123-invalid
`, "invalid-output-tag"))).toThrow("XML-safe tag name");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: second
    transmit: true
    outputTag: result
`, "same-session-transfer"))).toThrow("Same-session edge");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: second
    outputTag: result
`, "disabled-transfer-fields"))).toThrow("unless transmit is enabled");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: done
    transmit: true
    outputTag: result
`, "completion-transfer"))).toThrow("Control-only edge");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: decide
    to: done
`, "gate-without-branch"))).toThrow("must select a branch");
    expect(() => parseAgentFlowSource(`${base}  - from: done
    to: first
`, "end-source")).toThrow("cannot leave an end node");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: decide
    loopback: true
`, "gate-loopback-input"))).toThrow("cannot be a loopback edge");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: decide
    to: first
    branch: pass
    maxTraversals: 0
`, "invalid-branch-limit"))).toThrow("positive integer");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: second
    maxTraversals: 2
`, "nongate-branch-limit"))).toThrow("only when leaving a gate");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: second
  - from: second
    to: first
`, "unmarked-cycle"))).toThrow("unmarked cycle");
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`${base}  - from: first
    to: decide
  - from: decide
    to: second
    branch: pass
    maxTraversals: 2
  - from: second
    to: first
    loopback: true
`, "controlled-review-cycle"))).not.toThrow();
  });

  it("rejects interactive pause checkpoints backed by headless agent servers", () => {
    const agentflow = parseAgentFlowSource(`version: 1
name: Headless pause
sessions:
  main:
    agentServerId: echo-headless
nodes:
  review:
    kind: step
    title: Review
    session: main
    prompt: Review the change.
    pauseAfterRun: true
edges: []
`, "headless-pause");

    expect(() => assertRunnableAgentFlow(agentflow)).not.toThrow();
    expect(() => assertServerRunnableAgentFlow(agentflow, new Map([
      ["echo-headless", { settings: { type: "headless" } }],
    ]))).toThrow('Node "review" cannot pause for interaction because headless agent "echo-headless" has no ACP session.');
  });

  it("rejects all pause checkpoints for direct CLI runs", () => {
    const agentflow = parseAgentFlowSource(`version: 1
name: CLI pause
sessions:
  main:
    agentServerId: codex-acp
nodes:
  review:
    kind: step
    alias: "01"
    title: Review
    session: main
    prompt: Review the change.
    pauseAfterRun: true
edges: []
`, "cli-pause");

    expect(() => assertCliRunnableAgentFlow(agentflow)).toThrow(
      "specflow run does not support pauseAfterRun nodes.\n"
      + "Start the UI with `specflow`, then run this workflow from the browser to use pause/continue.\n"
      + "Paused nodes:\n"
      + "  - 01 Review (review)",
    );
  });

  it("defers ambiguous output tags and empty gates until runnable validation", () => {
    expect(() => assertRunnableAgentFlow(parseAgentFlowSource(`version: 1
name: Duplicate tag
sessions:
  source:
    agentServerId: codex-acp
  target:
    agentServerId: claude-acp
nodes:
  first:
    kind: step
    title: First
    prompt: First
    session: source
  second:
    kind: step
    title: Second
    prompt: Second
    session: source
  result:
    kind: step
    title: Result
    prompt: Result
    session: target
edges:
  - from: first
    to: result
    transmit: true
    outputTag: value
  - from: second
    to: result
    transmit: true
    outputTag: value
`, "duplicate-output-tag"))).toThrow("duplicate transmitted outputTag");

    const valid = parseAgentFlowSource(`version: 1
name: Empty gate
sessions:
  source:
    agentServerId: codex-acp
nodes:
  gate:
    kind: gate
    title: Gate
    decisionCriteria: Choose
    branches:
      pass: {}
edges: []
`, "empty-gate");
    const gate = valid.nodes.find((node) => node.kind === "gate");
    if (!gate || gate.kind !== "gate") throw new Error("Expected gate");
    gate.branches = [];
    expect(() => stringifyAgentFlowSource(valid)).not.toThrow();
    expect(() => assertRunnableAgentFlow(valid)).toThrow("must define at least one branch");

    expect(() => parseAgentFlowSource(`version: 1
name: Alternative tag
sessions:
  source:
    agentServerId: codex-acp
  target:
    agentServerId: claude-acp
nodes:
  source:
    kind: step
    title: Source
    prompt: Source
    session: source
  gate:
    kind: gate
    title: Gate
    decisionCriteria: Choose
    branches:
      pass: {}
      fix: {}
  result:
    kind: step
    title: Result
    prompt: Result
    session: target
edges:
  - from: source
    to: gate
  - from: gate
    to: result
    branch: pass
    transmit: true
    outputTag: value
  - from: gate
    to: result
    branch: fix
    transmit: true
    outputTag: value
`, "alternative-output-tag")).not.toThrow();
  });

  it("initializes agentflows, gitignored canvas layouts, and seed data", async () => {
    const root = await tempProject();
    await initWorkspace(root);

    const gitignore = await readFile(join(root, ".aflow/.specflow", ".gitignore"), "utf8");
    expect(gitignore).toContain("agentflow/runs/");
    expect(gitignore).toContain("agentflow/canvas/");
    expect(gitignore).toContain("agentflow/agentflows-local/");
    expect(gitignore).toContain("design/references/");

    const agentflowRaw = await readFile(join(root, ".aflow/.specflow", "agentflow", "agentflows-local", "example-v2-review-loop.yaml"), "utf8");
    const agentflow = parseAgentFlowSource(agentflowRaw, "example-v2-review-loop");
    expect(agentflow.version).toBe(2);
    expect(agentflow.variables?.[0]?.name).toBe("specflow_task");
    expect(agentflow.nodes.some((node) => node.kind === "start")).toBe(true);
    expect(agentflow.nodes.some((node) => node.kind === "end")).toBe(true);
    expect("x" in agentflow.nodes[0]!).toBe(false);
    expect(agentflowRaw).toContain("version: 2");
    expect(agentflowRaw).toContain("sessions:\n  builder:");
    expect(agentflowRaw).not.toContain("loopback:");
    expect(agentflowRaw).not.toMatch(/^id:/m);
    expect(agentflowRaw).not.toContain("sessionId:");
    expect(agentflowRaw).not.toContain("color:");

    const canvas = JSON.parse(await readFile(join(root, ".aflow/.specflow", "agentflow", "canvas", "example-v2-review-loop.json"), "utf8"));
    expect(canvas.workflowId).toBe("example-v2-review-loop");
    expect(canvas.nodes[0]).toHaveProperty("nodeId");
  });

  it("loads local agentflows from the gitignored local directory", async () => {
    const root = await tempProject();
    await initWorkspace(root);
    const localDir = join(root, ".aflow/.specflow", "agentflow", "agentflows-local");
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "local-draft.yaml"), `
version: 1
name: Local draft
sessions:
  main:
    agentServerId: codex-acp
nodes:
  do-work:
    kind: step
    title: Do work
    session: main
    prompt: Do the work.
edges: []
`, "utf8");

    const canvases = await listCanvases(root);
    expect(canvases.find((canvas) => canvas.id === "local-draft")).toEqual({
      id: "local-draft",
      name: "Local draft",
      version: 1,
      deprecated: true,
      local: true,
    });
    expect((await loadCanvas("local-draft", root)).name).toBe("Local draft");
  });

  it("creates a first-run workspace and seeds the selected agent server", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-first-run-"));
    await initWorkspace(root, { createIfMissing: true, seedAgentServerId: "chosen-code-acp" });

    const workflowId = "example-v2-review-loop";
    const agentflow = parseAgentFlowSource(
      await readFile(join(root, ".aflow/.specflow", "agentflow", "agentflows-local", `${workflowId}.yaml`), "utf8"),
      workflowId,
    );
    expect(agentflow.sessions.map((session) => session.agentServerId)).toEqual([
      "chosen-code-acp",
      "chosen-code-acp",
    ]);
  });

  it("regenerates missing or mismatched canvas layout from agentflow", async () => {
    const root = await tempProject();
    await initWorkspace(root);

    const canvasDocument: CanvasDoc = {
      id: "regen",
      name: "Regenerate",
      sessions: [{ id: "s1", name: "main", agentServerId: "codex-acp" }],
      nodes: [
        { kind: "step", id: "a", alias: "01", x: 10, y: 20, w: 220, title: "A", prompt: "A", sessionId: "s1" },
        { kind: "end", id: "done", alias: "END", x: 300, y: 20, w: 140, title: "Done", sessionId: null },
      ],
      edges: [{ id: "e1", from: "a", to: "done" }],
    };
    await saveCanvas(canvasDocument.id, canvasDocument, root);
    await writeFile(
      join(root, ".aflow/.specflow", "agentflow", "canvas", "regen.json"),
      `${JSON.stringify({ workflowId: "other", version: 1, nodes: [] })}\n`,
      "utf8",
    );

    const loaded = await loadCanvas("regen", root);
    expect(loaded.nodes.map((node) => node.id)).toEqual(["a", "done"]);
    expect(loaded.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it("lays out all agentflow nodes, including input and end", () => {
    const agentflow = parse(legacyCanvasYaml()) as CanvasDoc;
    const layout = generateCanvasLayout({
      id: agentflow.id,
      name: agentflow.name,
      sessions: agentflow.sessions,
      nodes: agentflow.nodes.map(({ x: _x, y: _y, w: _w, ...node }) => node),
      edges: agentflow.edges,
    });
    expect(layout.nodes.map((node) => node.nodeId).sort()).toEqual(["done", "in", "step"].sort());
  });

  it("reserves horizontal space for visible edge labels", () => {
    const flow = parseAgentFlowSource(`version: 1
name: Labels
sessions:
  source:
    agentServerId: codex-acp
  target:
    agentServerId: codex-acp
nodes:
  source:
    kind: step
    title: Source
    prompt: Source
    session: source
  target:
    kind: step
    title: Target
    prompt: Target
    session: target
edges:
  - from: source
    to: target
    transmit: true
    outputTag: extremely_long_product_visual_review_findings
`, "label-layout");
    const layout = generateCanvasLayout(flow);
    const source = layout.nodes.find((node) => node.nodeId === "source")!;
    const target = layout.nodes.find((node) => node.nodeId === "target")!;
    expect(target.x - (source.x + source.w)).toBeGreaterThan(280);
  });

  it("parses v2 workflows with start nodes, global variables, and derived loops", () => {
    const canvasDocument = parseAgentFlowSource(`version: 2
name: V2 Review
sessions:
  writer:
    agentServerId: codex-acp
  reviewer:
    agentServerId: claude-acp
variables:
  specflow_task:
    title: Task
    required: true
    description: User task.
nodes:
  start:
    kind: start
    title: Start
  write:
    kind: step
    title: Write
    session: writer
    prompt: Write <specflow_task>.
  review:
    kind: step
    title: Review
    session: reviewer
    prompt: Review <specflow_result>.
  verdict:
    kind: gate
    title: Verdict
    decisionCriteria: Choose pass or rework.
    branches:
      pass:
      rework:
        maxTraversals: 2
  done:
    kind: end
    title: Done
edges:
  - from: start
    to: write
  - from: write
    to: review
    transmit: true
    outputTag: result
  - from: review
    to: verdict
  - from: verdict
    branch: pass
    to: done
  - from: verdict
    branch: rework
    to: review
`, "v2-review");

    expect(canvasDocument.version).toBe(2);
    expect(canvasDocument.variables?.[0]).toMatchObject({ name: "specflow_task", title: "Task", required: true });
    assertRunnableAgentFlow(canvasDocument);

    const layout = generateCanvasLayout(canvasDocument);
    expect(layout.nodes.find((node) => node.nodeId === "start")?.x).toBe(60);

    const root = parse(stringifyAgentFlowSource(canvasDocument)) as Record<string, unknown>;
    expect(root.version).toBe(2);
    expect(root.variables).toEqual({
      specflow_task: {
        title: "Task",
        required: true,
        description: "User task.",
      },
    });
    expect(JSON.stringify(root.edges)).not.toContain("loopback");
  });

  it("rejects v2 removed edge and input-node fields", () => {
    const inputNode = `version: 2
name: Bad input
sessions:
  main:
    agentServerId: codex-acp
nodes:
  start:
    kind: start
  task:
    kind: input
    variableName: specflow_task
edges: []
`;
    expect(() => parseAgentFlowSource(inputNode, "bad-input")).toThrow("cannot use kind: input");

    const loopbackEdge = `version: 2
name: Bad loopback
sessions:
  main:
    agentServerId: codex-acp
nodes:
  start:
    kind: start
  work:
    kind: step
    session: main
    prompt: Work.
edges:
  - from: start
    to: work
  - from: work
    to: work
    loopback: true
`;
    expect(() => parseAgentFlowSource(loopbackEdge, "bad-loopback")).toThrow("cannot define loopback");

    const edgeMax = loopbackEdge.replace("loopback: true", "maxTraversals: 2");
    expect(() => parseAgentFlowSource(edgeMax, "bad-edge-max")).toThrow("cannot define maxTraversals");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-store-"));
  await mkdir(join(root, ".aflow/.specflow"), { recursive: true });
  return root;
}

function legacyCanvasYaml(): string {
  return `id: legacy
name: Legacy flow
sessions:
  - id: s1
    name: main
    agentServerId: codex-acp
nodes:
  - kind: input
    id: in
    alias: IN
    x: 0
    y: 0
    w: 200
    title: Input
    variableName: specflow_value
    sessionId: null
  - kind: step
    id: step
    alias: "01"
    x: 260
    y: 0
    w: 220
    title: Step
    prompt: Run <specflow_value>
    sessionId: s1
  - kind: end
    id: done
    alias: END
    x: 540
    y: 0
    w: 140
    title: Done
    sessionId: null
edges:
  - id: e0
    from: in
    to: step
  - id: e1
    from: step
    to: done
`;
}
