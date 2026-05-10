import { mkdir, writeFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { SEED_CANVAS_DOCS } from "./seed";

const GITIGNORE_CONTENT = "runs/\n";

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function initWorkspace(cwd: string = process.cwd()): Promise<void> {
  const root = join(cwd, ".specflow");

  // Silently skip if the project has no .specflow directory yet.
  if (!await pathExists(root)) return;

  const canvasDir = join(root, "canvas");
  const runsDir   = join(root, "runs");

  await Promise.all([
    mkdir(canvasDir, { recursive: true }),
    mkdir(runsDir,   { recursive: true }),
  ]);

  const gitignorePath = join(root, ".gitignore");
  if (!await pathExists(gitignorePath)) {
    await writeFile(gitignorePath, GITIGNORE_CONTENT, "utf8");
  }

  // Seed canvases once when the canvas dir is empty
  const existingFiles = await readdir(canvasDir);
  if (existingFiles.filter((f) => f.endsWith(".yaml")).length === 0) {
    await Promise.all(
      SEED_CANVAS_DOCS.map((doc) =>
        writeFile(join(canvasDir, `${doc.id}.yaml`), stringify(doc), "utf8"),
      ),
    );
  }
}
