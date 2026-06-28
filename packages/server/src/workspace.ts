import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentServerStore, type ResolvedAgentServer } from "@specflow/agent-proxy";
import { SEED_CANVAS_DOCS } from "./agentflow/seed";
import {
  saveAgentFlowAndLayout,
  splitCanvasDoc,
} from "./agentflow/canvas-store";
import type { CanvasDoc } from "./agentflow/canvas-doc";
import { loadSharedAgentServerConfig, patchLocalAgentServer } from "./agent-server-config";
import {
  agentflowAssetsDir,
  agentflowRoot,
  agentflowsDir,
  canvasDir,
  designConversationsDir,
  designProjectsDir,
  designReferencesDir,
  localAgentflowsDir,
  runLogsDir,
  runsDir,
  specflowRoot,
} from "./workspace-paths";

const GITIGNORE_ENTRIES = [
  "server.json",
  "agent-servers.local.json",
  "agentflow/runs/",
  "agentflow/run-logs/",
  "agentflow/canvas/",
  "agentflow/agentflows-local/",
  "agentflow/assets/",
  "design/references/",
  "design/conversations/",
  "design/projects/",
  "design/settings.json",
];

export interface InitWorkspaceOptions {
  createIfMissing?: boolean;
  seedAgentServerId?: string;
  warn?: (message: string) => void;
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
  const root = specflowRoot(workingDirectory);

  if (!await pathExists(root)) {
    if (!options.createIfMissing) return;
    await mkdir(root, { recursive: true });
  }

  await Promise.all([
    mkdir(agentflowRoot(workingDirectory), { recursive: true }),
    mkdir(agentflowsDir(workingDirectory), { recursive: true }),
    mkdir(localAgentflowsDir(workingDirectory), { recursive: true }),
    mkdir(canvasDir(workingDirectory), { recursive: true }),
    mkdir(agentflowAssetsDir(workingDirectory), { recursive: true }),
    mkdir(runsDir(workingDirectory), { recursive: true }),
    mkdir(runLogsDir(workingDirectory), { recursive: true }),
    mkdir(designReferencesDir(workingDirectory), { recursive: true }),
    mkdir(designConversationsDir(workingDirectory), { recursive: true }),
    mkdir(designProjectsDir(workingDirectory), { recursive: true }),
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

  const existingAgentflows = await listYamlFiles(agentflowsDir(workingDirectory));
  const existingLocalAgentflows = await listYamlFiles(localAgentflowsDir(workingDirectory));
  if (existingAgentflows.length > 0 || existingLocalAgentflows.length > 0) return;

  // Seed local agentflows once when the workspace is empty.
  await Promise.all(
    SEED_CANVAS_DOCS.map((canvasDocument) => {
      const { agentflow, layout } = splitCanvasDoc(withSeedAgentServer(canvasDocument, options.seedAgentServerId));
      return saveAgentFlowAndLayout(agentflow.id, agentflow, layout, workingDirectory, { local: true });
    }),
  );
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

async function listYamlFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((file) => file.endsWith(".yaml"));
  } catch {
    return [];
  }
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
