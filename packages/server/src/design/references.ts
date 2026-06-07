import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { designReferencesDir } from "../workspace-paths";
import type { DesignReferenceImportRequest, DesignReferenceSummary } from "./types";

const COPY_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const COPY_MAX_FILES = 8_000;
const COPY_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const COPY_MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function listDesignReferences(root: string): Promise<DesignReferenceSummary[]> {
  const directory = designReferencesDir(root);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const summaries: DesignReferenceSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    summaries.push({
      name: entry.name,
      path: join(directory, entry.name),
    });
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

export async function importDesignReference(
  root: string,
  request: DesignReferenceImportRequest,
): Promise<DesignReferenceSummary> {
  const name = sanitizeReferenceName(request.name);
  const target = designReferencePath(root, name);
  if (await pathExists(target)) {
    throw httpError(409, `Design reference already exists: ${name}`);
  }
  await mkdir(designReferencesDir(root), { recursive: true });

  if (request.type === "git") {
    if (!request.url || typeof request.url !== "string") {
      throw httpError(400, "Git reference import requires a url.");
    }
    await ensureGitAvailable();
    await gitClone(request.url, target, request.branch);
  } else if (request.type === "copy") {
    const sourcePath = resolve(request.sourcePath);
    const sourceStat = await stat(sourcePath).catch(() => undefined);
    if (!sourceStat) throw httpError(404, `Reference source path not found: ${request.sourcePath}`);
    if (!sourceStat.isDirectory()) throw httpError(400, "Reference source path must be a directory.");
    await copyReferenceDirectory(sourcePath, target).catch(async (error) => {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    });
  } else {
    throw httpError(400, "Unsupported design reference import type.");
  }

  return {
    name,
    path: target,
  };
}

export function designReferencePath(root: string, name: string): string {
  return join(designReferencesDir(root), sanitizeReferenceName(name));
}

export function sanitizeReferenceName(value: string): string {
  const name = value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!name) throw httpError(400, "Reference name is required.");
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw httpError(400, "Invalid reference name.");
  }
  return name;
}

async function ensureGitAvailable(): Promise<void> {
  const result = await runCommand("git", ["--version"]).catch(() => undefined);
  if (!result) throw httpError(409, "git is required to import references from git.");
  if (result.code !== 0) throw httpError(409, "git is required to import references from git.");
}

async function gitClone(url: string, target: string, branch: string | undefined): Promise<void> {
  const args = ["clone", "--depth", "1"];
  if (branch?.trim()) args.push("--branch", branch.trim());
  args.push(url, target);
  const result = await runCommand("git", args);
  if (result.code !== 0) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    throw httpError(502, `git clone failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
}

async function copyReferenceDirectory(source: string, target: string): Promise<void> {
  const state = { files: 0, bytes: 0 };
  await copyReferenceEntry(source, target, state);
}

async function copyReferenceEntry(
  source: string,
  target: string,
  state: { files: number; bytes: number },
): Promise<void> {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) return;
  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && COPY_IGNORED_DIRECTORIES.has(entry.name)) continue;
      await copyReferenceEntry(join(source, entry.name), join(target, entry.name), state);
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  if (sourceStat.size > COPY_MAX_FILE_BYTES) return;
  if (state.files + 1 > COPY_MAX_FILES) {
    throw httpError(413, `Reference copy exceeded ${COPY_MAX_FILES} files after ignoring generated directories.`);
  }
  if (state.bytes + sourceStat.size > COPY_MAX_TOTAL_BYTES) {
    throw httpError(413, "Reference copy exceeded the 250 MB size limit after ignoring generated directories.");
  }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  state.files += 1;
  state.bytes += sourceStat.size;
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export function defaultReferenceNameFromSource(input: string): string {
  return sanitizeReferenceName(basename(input.replace(/\.git$/, "")));
}
