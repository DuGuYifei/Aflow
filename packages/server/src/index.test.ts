import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("server routes", () => {
  it("responds to health checks", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "specflow-server"
    });
  });

  it("serves local run APIs", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist(),
      stepDelayMs: 1
    });
    const emptyList = await server.inject({ method: "GET", url: "/api/runs" });

    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.json()).toEqual({ runs: [] });

    const badCreate = await server.inject({
      method: "POST",
      url: "/api/runs",
      payload: {}
    });

    expect(badCreate.statusCode).toBe(400);

    const created = await server.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        ticket: "Observe the local workflow."
      }
    });
    const createdBody = created.json() as { runId: string };

    expect(created.statusCode).toBe(202);
    expect(createdBody.runId).toMatch(/^run_/);

    const run = await waitForRun(server, createdBody.runId);
    const artifact = run.artifacts[0];
    const artifactResponse = await server.inject({
      method: "GET",
      url: `/api/runs/${run.id}/artifacts/${artifact.id}`
    });

    expect(run.status).toBe("completed");
    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.json().artifact.id).toBe(artifact.id);
  });

  it("serves the UI shell", async () => {
    const root = await createRepositoryRoot();
    const server = buildServer({
      root,
      uiDistPath: await createUiDist()
    });
    const response = await server.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Specflow");
  });
});

async function waitForRun(
  server: ReturnType<typeof buildServer>,
  runId: string
): Promise<{
  id: string;
  status: string;
  artifacts: Array<{ id: string }>;
}> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await server.inject({
      method: "GET",
      url: `/api/runs/${runId}`
    });
    const body = response.json() as {
      run: {
        id: string;
        status: string;
        artifacts: Array<{ id: string }>;
      };
    };

    if (body.run.status === "completed" || body.run.status === "failed") {
      return body.run;
    }

    await wait(10);
  }

  throw new Error("Timed out waiting for workflow run.");
}

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-server-"));
  tempRoots.push(root);

  await mkdir(join(root, ".specflow"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  await writeFile(join(root, ".specflow", "project.md"), "# Server Test\n", "utf8");

  return root;
}

async function createUiDist(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-ui-dist-"));
  tempRoots.push(root);
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><body><div id="root">Specflow</div></body></html>',
    "utf8"
  );

  return root;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
