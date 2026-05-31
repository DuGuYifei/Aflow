import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";
import { SEED_CANVAS_DOCS } from "./seed";
import {
  saveAgentFlowAndLayout,
  splitCanvasDoc,
} from "./canvas-store";
import type { CanvasDoc } from "./canvas-doc";

const GITIGNORE_ENTRIES = ["runs/", "canvas/"];

export interface InitWorkspaceOptions {
  createIfMissing?: boolean;
  seedAgentServerId?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function initWorkspace(
  workingDirectory: string = process.cwd(),
  options: InitWorkspaceOptions = {},
): Promise<void> {
  const root = join(workingDirectory, SPECFLOW_WORKSPACE_PATH);

  if (!await pathExists(root)) {
    if (!options.createIfMissing) return;
    await mkdir(root, { recursive: true });
  }

  const agentflowsDir = join(root, "agentflows");
  const canvasDir = join(root, "canvas");
  const runsDir = join(root, "runs");

  await Promise.all([
    mkdir(agentflowsDir, { recursive: true }),
    mkdir(canvasDir, { recursive: true }),
    mkdir(runsDir, { recursive: true }),
  ]);

  const gitignorePath = join(root, ".gitignore");
  if (!await pathExists(gitignorePath)) {
    await writeFile(gitignorePath, `${GITIGNORE_ENTRIES.join("\n")}\n`, "utf8");
  } else {
    const existing = await readFile(gitignorePath, "utf8");
    const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const missing = GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
    if (missing.length > 0) {
      const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
      await writeFile(gitignorePath, `${existing}${prefix}${missing.join("\n")}\n`, "utf8");
    }
  }

  const existingAgentflows = await readdir(agentflowsDir);
  if (existingAgentflows.filter((file) => file.endsWith(".yaml")).length > 0) return;

  const legacyFiles = await readdir(canvasDir);
  const legacyYamlFiles = legacyFiles.filter((file) => file.endsWith(".yaml"));
  if (legacyYamlFiles.length > 0) {
    await Promise.all(
      legacyYamlFiles.map(async (file) => {
        const rawValue = await readFile(join(canvasDir, file), "utf8");
        const canvasDocument = parse(rawValue) as CanvasDoc;
        const { agentflow, layout } = splitCanvasDoc(withSeedAgentServer(canvasDocument, options.seedAgentServerId));
        await saveAgentFlowAndLayout(agentflow.id, agentflow, layout, workingDirectory);
      }),
    );
    return;
  }

  // Seed agentflows once when the agentflows dir is empty.
  if (legacyYamlFiles.length === 0) {
    await Promise.all(
      SEED_CANVAS_DOCS.map((canvasDocument) => {
        const { agentflow, layout } = splitCanvasDoc(withSeedAgentServer(canvasDocument, options.seedAgentServerId));
        return saveAgentFlowAndLayout(agentflow.id, agentflow, layout, workingDirectory);
      }),
    );
  }
}

function withSeedAgentServer<T extends CanvasDoc>(canvasDocument: T, agentServerId: string | undefined): T {
  if (!agentServerId) return canvasDocument;
  return {
    ...canvasDocument,
    sessions: canvasDocument.sessions.map((session) => ({ ...session, agentServerId })),
  };
}
