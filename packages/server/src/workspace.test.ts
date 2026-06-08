import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { prepareSpecflowWorkspace } from "./workspace";

describe("workspace preparation", () => {
  test("does not create PRD workspace folders by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-workspace-"));

    await prepareSpecflowWorkspace(root, { createIfMissing: true });

    expect(await pathExists(join(root, ".aflow/.specflow/prd"))).toBe(false);
    await expect(readFile(join(root, ".aflow/.specflow/.gitignore"), "utf8"))
      .resolves.not.toContain("prd/");
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
