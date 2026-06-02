import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { AgentServerStore, type ResolvedAgentServer } from "@specflow/agent-proxy";
import { SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";
import { SEED_CANVAS_DOCS } from "./seed";
import {
  saveAgentFlowAndLayout,
  splitCanvasDoc,
} from "./canvas-store";
import type { CanvasDoc } from "./canvas-doc";
import { loadSharedAgentServerConfig, patchLocalAgentServer } from "./agent-server-config";

const GITIGNORE_ENTRIES = ["runs/", "canvas/", "agentflows-local/"];

export interface InitWorkspaceOptions {
  createIfMissing?: boolean;
  seedAgentServerId?: string;
}

export interface PrepareSpecflowWorkspaceOptions extends InitWorkspaceOptions {
  prewarmAgentServers?: boolean;
  warn?: (message: string) => void;
  resolveAgentServer?: (root: string, agentServerId: string) => Promise<ResolvedAgentServer>;
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
  const localAgentflowsDir = join(root, "agentflows-local");
  const canvasDir = join(root, "canvas");
  const runsDir = join(root, "runs");

  await Promise.all([
    mkdir(agentflowsDir, { recursive: true }),
    mkdir(localAgentflowsDir, { recursive: true }),
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

export async function prepareSpecflowWorkspace(
  workingDirectory: string = process.cwd(),
  options: PrepareSpecflowWorkspaceOptions = {},
): Promise<void> {
  await initWorkspace(workingDirectory, options);
  if (options.prewarmAgentServers) {
    await prewarmSharedRegistryAgentServers(workingDirectory, options);
  }
}

async function prewarmSharedRegistryAgentServers(
  workingDirectory: string,
  options: PrepareSpecflowWorkspaceOptions,
): Promise<void> {
  const config = await loadSharedAgentServerConfig(workingDirectory);
  const resolve = options.resolveAgentServer ?? resolveAgentServer;
  for (const [id, settings] of Object.entries(config.agent_servers)) {
    if (settings.type !== "registry") continue;
    if (hasLocalAuditVersion(settings)) {
      options.warn?.(
        `.aflow/.specflow/agent-servers.json entry "${id}" includes an installed version field. `
        + "This field is a local audit stamp from the first user who installed the agent; "
        + "it does not pin or control shared installs.",
      );
    }
    const resolved = await resolve(workingDirectory, id);
    if (resolved.registry?.version) {
      await patchLocalAgentServer(workingDirectory, id, {
        installedVersion: resolved.registry.version,
      });
    }
  }
}

async function resolveAgentServer(root: string, agentServerId: string): Promise<ResolvedAgentServer> {
  return new AgentServerStore({ root }).resolve(agentServerId);
}

function hasLocalAuditVersion(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  const record = settings as Record<string, unknown>;
  return typeof record.installedVersion === "string"
    || typeof record.installed_version === "string"
    || typeof record.version === "string";
}

function withSeedAgentServer<T extends CanvasDoc>(canvasDocument: T, agentServerId: string | undefined): T {
  if (!agentServerId) return canvasDocument;
  return {
    ...canvasDocument,
    sessions: canvasDocument.sessions.map((session) => ({ ...session, agentServerId })),
  };
}
