import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { designProjectsDir } from "../workspace-paths";
import { loadDesignProjectConfig } from "./project-config";
import { scaffoldDesignProject } from "./project-scaffold";
import type { DesignProjectKind, DesignProjectSummary, DesignRuntimeState } from "./types";

export async function listDesignProjects(
  root: string,
  runtimeState?: (project: DesignProjectSummary) => DesignRuntimeState | undefined,
): Promise<DesignProjectSummary[]> {
  const directory = designProjectsDir(root);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const projects: DesignProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    const project = await designProjectSummary(entry.name, path);
    const runtime = runtimeState?.(project);
    projects.push({
      ...project,
      ...(runtime ? { runtime } : {}),
    });
  }
  return projects.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
    || left.name.localeCompare(right.name));
}

export async function createDesignProject(
  root: string,
  name: string,
  kind: DesignProjectKind = "html",
): Promise<DesignProjectSummary> {
  const projectName = sanitizeDesignProjectName(name);
  const path = designProjectPath(root, projectName);
  if (await projectExists(path)) throw httpError(409, `Design project already exists: ${projectName}`);
  await mkdir(designProjectsDir(root), { recursive: true });
  await mkdir(path, { recursive: false });
  await scaffoldDesignProject(path, kind);
  return designProjectSummary(projectName, path);
}

export async function loadDesignProject(
  root: string,
  name: string,
  runtimeState?: (project: DesignProjectSummary) => DesignRuntimeState | undefined,
): Promise<DesignProjectSummary> {
  const projectName = sanitizeDesignProjectName(name);
  const path = designProjectPath(root, projectName);
  const entryStat = await stat(path).catch(() => undefined);
  if (!entryStat?.isDirectory()) throw httpError(404, `Design project not found: ${projectName}`);
  const project = await designProjectSummary(projectName, path);
  const runtime = runtimeState?.(project);
  return {
    ...project,
    ...(runtime ? { runtime } : {}),
  };
}

export function designProjectPath(root: string, name: string): string {
  return join(designProjectsDir(root), sanitizeDesignProjectName(name));
}

export function sanitizeDesignProjectName(value: string): string {
  const name = value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!name) throw httpError(400, "Design project name is required.");
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw httpError(400, "Invalid design project name.");
  }
  return name;
}

async function projectExists(path: string): Promise<boolean> {
  try {
    const entryStat = await stat(path);
    return entryStat.isDirectory();
  } catch {
    return false;
  }
}

async function designProjectSummary(name: string, path: string): Promise<DesignProjectSummary> {
  const [entryStat, config] = await Promise.all([
    stat(path),
    loadDesignProjectConfig(path),
  ]);
  return {
    name,
    path,
    kind: config.kind,
    updatedAt: entryStat.mtime.toISOString(),
  };
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}
