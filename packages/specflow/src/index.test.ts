import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSpecflowKnowledge, readSpecflowWorkflowDefinitions } from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots.length = 0;
});

describe("readSpecflowKnowledge", () => {
  it("skips run output while reading repository knowledge", async () => {
    const root = await createRepositoryRoot();

    await mkdir(join(root, ".specflow", "runs", "run_1"), { recursive: true });
    await writeFile(
      join(root, ".specflow", "runs", "run_1", "note.md"),
      "# Generated Run Note\n",
      "utf8"
    );

    const knowledge = await readSpecflowKnowledge(root);

    expect(knowledge.files.map((file) => file.path)).toEqual(["project.md"]);
  });
});

describe("readSpecflowWorkflowDefinitions", () => {
  it("reads structured workflow definitions from .specflow/workflows", async () => {
    const root = await createRepositoryRoot();

    await mkdir(join(root, ".specflow", "workflows"), { recursive: true });
    await writeFile(
      join(root, ".specflow", "workflows", "demo.workflow.json"),
      JSON.stringify(
        {
          id: "demo",
          name: "Demo Workflow",
          nodes: [
            {
              id: "ticket-input",
              type: "ticket",
              label: "Ticket Input",
              status: "pending"
            }
          ],
          edges: []
        },
        null,
        2
      ),
      "utf8"
    );

    const definitions = await readSpecflowWorkflowDefinitions(root);

    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.path).toBe("workflows/demo.workflow.json");
    expect(definitions[0]?.definition.id).toBe("demo");
  });
});

async function createRepositoryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-knowledge-"));
  tempRoots.push(root);

  await mkdir(join(root, ".specflow"), { recursive: true });
  await writeFile(join(root, ".specflow", "project.md"), "# Test Project\n", "utf8");

  return root;
}
