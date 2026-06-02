import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";
import {
  loadAgentFlowFile,
  splitCanvasDoc,
  stringifyAgentFlowSource,
  type AgentFlowDoc,
  type CanvasDoc,
} from "@specflow/server";
import { connectOrStartSpecflowServer } from "../server/connect-or-start";

export interface WorkflowFileResolution {
  workflowId: string;
  path: string;
  local: boolean;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  local?: boolean;
}

export async function listWorkflowFiles(cwd: string): Promise<WorkflowSummary[]> {
  const results = new Map<string, WorkflowSummary>();
  for (const local of [false, true]) {
    const directory = workflowDirectory(cwd, local);
    let files: string[];
    try {
      files = await readdir(directory);
    } catch {
      continue;
    }
    for (const file of files.filter((candidate) => candidate.endsWith(".yaml"))) {
      const workflowId = basename(file, ".yaml");
      try {
        const doc = await loadAgentFlowFile(join(directory, file));
        results.set(workflowId, {
          id: doc.id,
          name: doc.name,
          ...(local ? { local: true } : {}),
        });
      } catch {
        // Keep list output useful even when a draft is malformed.
      }
    }
  }
  return [...results.values()];
}

export async function resolveWorkflowFile(cwd: string, workflowId: string): Promise<WorkflowFileResolution | undefined> {
  for (const local of [true, false]) {
    const path = workflowYamlPath(cwd, workflowId, local);
    try {
      await loadAgentFlowFile(path);
      return { workflowId, path, local };
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

export async function loadWorkflowDoc(
  target: string,
  cwd: string,
  serverUrl: string | undefined,
): Promise<AgentFlowDoc> {
  const localPath = resolve(cwd, target);
  if (looksLikePath(target) || existsSync(localPath)) {
    return loadAgentFlowFile(localPath);
  }

  const file = await resolveWorkflowFile(cwd, target);
  if (file) return loadAgentFlowFile(file.path);

  const connection = await connectOrStartSpecflowServer({ cwd, serverUrl });
  const canvas = await connection.client.getCanvas(target);
  return splitCanvasDoc(canvas).agentflow;
}

export async function loadWorkflowYaml(
  target: string,
  cwd: string,
  serverUrl: string | undefined,
): Promise<{ workflowId: string; yaml: string; path?: string; local?: boolean }> {
  const localPath = resolve(cwd, target);
  if (looksLikePath(target)) {
    const workflowId = basename(target).replace(/\.ya?ml$/, "");
    return {
      workflowId,
      yaml: await readFile(localPath, "utf8"),
      path: localPath,
    };
  }

  const file = await resolveWorkflowFile(cwd, target);
  if (file) {
    return {
      workflowId: target,
      yaml: await readFile(file.path, "utf8"),
      path: file.path,
      local: file.local,
    };
  }

  const connection = await connectOrStartSpecflowServer({ cwd, serverUrl });
  const canvas = await connection.client.getCanvas(target);
  const { agentflow } = splitCanvasDoc(canvas);
  return {
    workflowId: target,
    yaml: stringifyAgentFlowSource(agentflow),
  };
}

export async function getServerCanvasOrExplainLocal(
  workflowId: string,
  cwd: string,
  getCanvas: (id: string) => Promise<CanvasDoc>,
): Promise<CanvasDoc> {
  try {
    return await getCanvas(workflowId);
  } catch (error) {
    const file = await resolveWorkflowFile(cwd, workflowId);
    if (!file) throw error;
    const localText = file.local ? "local " : "";
    throw new Error(
      `Workflow "${workflowId}" exists as a ${localText}YAML file at ${file.path}, but the connected Specflow server did not expose it. `
      + "Restart the Specflow/Aflow dev server so it loads the latest agentflows-local support, then run it again. "
      + "Do not copy local drafts into agentflows just to run them.",
    );
  }
}

export function workflowYamlPath(cwd: string, workflowId: string, local: boolean): string {
  return join(workflowDirectory(cwd, local), `${workflowId}.yaml`);
}

export function looksLikePath(value: string): boolean {
  return value.endsWith(".yaml") || value.endsWith(".yml") || value.includes("/") || value.includes("\\");
}

function workflowDirectory(cwd: string, local: boolean): string {
  return join(cwd, SPECFLOW_WORKSPACE_PATH, local ? "agentflows-local" : "agentflows");
}
