import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { upsertLocalAgentServer } from "./agent-server-config";
import { agentflowsDir, localAgentflowsDir } from "./workspace-paths";

describe("workflow source API", () => {
  test("writes, reads, validates, prepares, and forks workflow YAML through server APIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-workflow-api-"));
    await upsertLocalAgentServer(root, "fast-headless", {
      type: "headless",
      command: process.execPath,
      argsTemplate: ["-e", "process.stdout.write('ok')"],
    });
    const handle = createApiHandler(createSpecflowBridge(), root);

    const write = await handle(jsonRequest("http://specflow.test/api/workflows/source/write", {
      workflowId: "wf-api",
      yaml: sampleWorkflowYaml(),
    }));
    expect(write?.status).toBe(200);
    expect(await write!.json()).toMatchObject({
      ok: true,
      workflowId: "wf-api",
      local: true,
    });
    expect(await readFile(join(localAgentflowsDir(root), "wf-api.yaml"), "utf8")).toContain("name: Workflow API");

    const read = await handle(jsonRequest("http://specflow.test/api/workflows/source/read", {
      target: "wf-api",
    }));
    expect(read?.status).toBe(200);
    const readBody = await read!.json() as { workflowId: string; local: boolean; yaml: string };
    expect(readBody).toMatchObject({ workflowId: "wf-api", local: true });
    expect(readBody.yaml).toContain("specflow_task");

    const validate = await handle(jsonRequest("http://specflow.test/api/workflows/validate", {
      target: "wf-api",
    }));
    expect(validate?.status).toBe(200);
    expect(await validate!.json()).toMatchObject({
      ok: true,
      workflowId: "wf-api",
      nodes: 3,
    });

    const missing = await handle(jsonRequest("http://specflow.test/api/workflows/prepare-run", {
      workflowId: "wf-api",
    }));
    expect(missing?.status).toBe(200);
    expect(await missing!.json()).toMatchObject({
      ready: false,
      missingVariables: [{ name: "specflow_task" }],
    });

    const ready = await handle(jsonRequest("http://specflow.test/api/workflows/prepare-run", {
      workflowId: "wf-api",
      variableValues: { specflow_task: "ship it" },
    }));
    expect(ready?.status).toBe(200);
    expect(await ready!.json()).toMatchObject({
      ready: true,
      effectiveValues: { specflow_task: "ship it" },
    });

    const fork = await handle(jsonRequest("http://specflow.test/api/workflows/source/fork", {
      source: "wf-api",
      newWorkflowId: "wf-api-copy",
      newName: "Workflow API Copy",
    }));
    expect(fork?.status).toBe(200);
    expect(await fork!.json()).toMatchObject({
      ok: true,
      sourceWorkflowId: "wf-api",
      workflowId: "wf-api-copy",
      local: true,
    });
    expect(await readFile(join(localAgentflowsDir(root), "wf-api-copy.yaml"), "utf8")).toContain("name: Workflow API Copy");
  });

  test("falls back from missing local source to shared workflow source by id", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-workflow-shared-api-"));
    await upsertLocalAgentServer(root, "fast-headless", {
      type: "headless",
      command: process.execPath,
      argsTemplate: ["-e", "process.stdout.write('ok')"],
    });
    await mkdir(agentflowsDir(root), { recursive: true });
    await writeFile(join(agentflowsDir(root), "wf-shared.yaml"), sampleWorkflowYaml(), "utf8");
    const handle = createApiHandler(createSpecflowBridge(), root);

    const read = await handle(jsonRequest("http://specflow.test/api/workflows/source/read", {
      target: "wf-shared",
    }));
    expect(read?.status).toBe(200);
    expect(await read!.json()).toMatchObject({
      workflowId: "wf-shared",
      local: false,
      source: "shared-file",
    });

    const validate = await handle(jsonRequest("http://specflow.test/api/workflows/validate", {
      target: "wf-shared",
    }));
    expect(validate?.status).toBe(200);
    expect(await validate!.json()).toMatchObject({
      ok: true,
      workflowId: "wf-shared",
    });

    const fork = await handle(jsonRequest("http://specflow.test/api/workflows/source/fork", {
      source: "wf-shared",
      newWorkflowId: "wf-shared-copy",
    }));
    expect(fork?.status).toBe(200);
    expect(await fork!.json()).toMatchObject({
      ok: true,
      sourceWorkflowId: "wf-shared",
      workflowId: "wf-shared-copy",
      local: true,
    });
  });

  test("rejects legacy workflow YAML and no longer exposes the migration API", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-workflow-v1-api-"));
    const handle = createApiHandler(createSpecflowBridge(), root);

    const write = await handle(jsonRequest("http://specflow.test/api/workflows/source/write", {
      workflowId: "legacy-api",
      yaml: legacyWorkflowYaml(),
    }));
    expect(write?.status).toBe(400);
    expect(await write!.json()).toMatchObject({
      error: expect.stringContaining("must declare version: 2"),
    });

    await mkdir(localAgentflowsDir(root), { recursive: true });
    await writeFile(join(localAgentflowsDir(root), "legacy-api.yaml"), legacyWorkflowYaml(), "utf8");

    const read = await handle(jsonRequest("http://specflow.test/api/workflows/source/read", {
      target: "legacy-api",
    }));
    expect(read?.status).toBe(400);
    expect(await read!.json()).toMatchObject({
      error: expect.stringContaining("must declare version: 2"),
    });

    const validate = await handle(jsonRequest("http://specflow.test/api/workflows/validate", {
      target: "legacy-api",
    }));
    expect(validate?.status).toBe(200);
    expect(await validate!.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("must declare version: 2"),
    });

    const run = await handle(jsonRequest("http://specflow.test/api/canvases/legacy-api/run", {}));
    expect(run?.status).toBe(400);
    expect(await run!.json()).toMatchObject({
      error: expect.stringContaining("must declare version: 2"),
    });

    const migration = await handle(jsonRequest("http://specflow.test/api/aflow/migrations", {
      workflowId: "legacy-api",
    }));
    expect(migration).toBeNull();
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sampleWorkflowYaml(): string {
  return `version: 2
name: Workflow API
sessions:
  main:
    agentServerId: fast-headless
nodes:
  start:
    kind: start
    alias: START
    title: Start
  step:
    kind: step
    alias: "01"
    title: Step
    prompt: Use <specflow_task>.
    session: main
  done:
    kind: end
    alias: END
    title: Done
edges:
  - from: start
    to: step
  - from: step
    to: done
variables:
  specflow_task:
    title: Task
    required: true
`;
}

function legacyWorkflowYaml(): string {
  return `version: 1
name: Legacy API
sessions:
  main:
    agentServerId: fast-headless
nodes:
  step:
    kind: step
    title: Step
    prompt: Run.
    session: main
edges: []
`;
}
