import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { designRoot, designSettingsPath } from "../workspace-paths";
import { loadDesignProject } from "./projects";
import type {
  DesignBranchFromVersionRequest,
  DesignRecordVersionRequest,
  DesignVersionCommit,
  DesignVersionSettings,
  DesignVersionState,
} from "./types";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export async function loadDesignVersionState(root: string, projectName: string): Promise<DesignVersionState> {
  const project = await loadDesignProject(root, projectName);
  const settings = await readDesignSettings(root);
  const git = await checkGit();
  if (!git.available) {
    return {
      gitAvailable: false,
      initialized: false,
      dirty: false,
      commits: [],
      settings,
    };
  }

  const initialized = await hasGitRepository(project.path);
  if (!initialized) {
    return {
      gitAvailable: true,
      ...(git.version ? { gitVersion: git.version } : {}),
      initialized: false,
      dirty: false,
      commits: [],
      settings,
    };
  }

  return loadInitializedVersionState(project.path, settings, git.version);
}

export async function recordDesignVersion(
  root: string,
  projectName: string,
  request: DesignRecordVersionRequest,
): Promise<DesignVersionState> {
  const project = await loadDesignProject(root, projectName);
  const git = await checkGit();
  if (!git.available) throw httpError(503, "Current computer does not have a usable git command.");
  const author = normalizeAuthor(request);
  const versionCode = new Date().toISOString();
  let initialized = await hasGitRepository(project.path);

  if (!initialized) {
    await runGit(project.path, ["init"]);
    await runGit(project.path, ["symbolic-ref", "HEAD", `refs/heads/${await initialBranchName(project.path)}`]);
    initialized = true;
  }

  const currentHead = await runGit(project.path, ["rev-parse", "HEAD"]).catch(() => "");
  await runGit(project.path, ["add", "-A", "--", "."]);
  const status = await gitStatus(project.path);
  if (currentHead && !status.trim()) {
    throw httpError(409, "There are no design changes to record.");
  }

  const commitArgs = [
    "-c",
    `user.name=${author.authorName}`,
    "-c",
    `user.email=${author.authorEmail}`,
    "commit",
    ...(currentHead || status.trim() ? [] : ["--allow-empty"]),
    "-m",
    versionMessage(versionCode, request.note),
  ];
  await runGit(project.path, commitArgs);
  await saveVersionAuthorSettings(root, author);
  const settings = await readDesignSettings(root);
  return loadInitializedVersionState(project.path, settings, git.version);
}

export async function branchDesignVersionFromCommit(
  root: string,
  projectName: string,
  request: DesignBranchFromVersionRequest,
): Promise<DesignVersionState> {
  const project = await loadDesignProject(root, projectName);
  const git = await checkGit();
  if (!git.available) throw httpError(503, "Current computer does not have a usable git command.");
  if (!await hasGitRepository(project.path)) throw httpError(409, "This design project has not been versioned yet.");
  const commitHash = normalizeCommitHash(request.commitHash);
  const status = await gitStatus(project.path);
  if (status.trim()) {
    throw httpError(409, "Record or discard current design changes before branching from an older version.");
  }

  const resolvedHash = await runGit(project.path, ["rev-parse", "--verify", `${commitHash}^{commit}`])
    .catch(() => {
      throw httpError(404, `Design version not found: ${commitHash}`);
    });
  const branchesAtCommit = await branchesForCommit(project.path, resolvedHash);
  if (request.branchName) {
    const branchName = normalizeBranchName(request.branchName);
    if (!branchesAtCommit.includes(branchName)) {
      throw httpError(400, `Branch ${branchName} does not point to the selected design version.`);
    }
    await runGit(project.path, ["checkout", branchName]);
    const settings = await readDesignSettings(root);
    return loadInitializedVersionState(project.path, settings, git.version);
  }
  if (branchesAtCommit.length === 1) {
    await runGit(project.path, ["checkout", branchesAtCommit[0]!]);
    const settings = await readDesignSettings(root);
    return loadInitializedVersionState(project.path, settings, git.version);
  }
  if (branchesAtCommit.length > 1) {
    throw httpError(409, `Multiple branches point to this design version: ${branchesAtCommit.join(", ")}`);
  }
  const subject = await runGit(project.path, ["log", "-1", "--pretty=format:%s", resolvedHash]);
  const { versionCode } = parseVersionMessage(subject);
  const branchName = `from-${branchCode(versionCode ?? resolvedHash.slice(0, 12))}-at-${dateBranchCode(new Date())}`;
  await runGit(project.path, ["checkout", "-b", branchName, resolvedHash]);
  const settings = await readDesignSettings(root);
  return loadInitializedVersionState(project.path, settings, git.version);
}

async function loadInitializedVersionState(
  projectPath: string,
  settings: DesignVersionSettings,
  gitVersion?: string,
): Promise<DesignVersionState> {
  const currentBranch = await runGit(projectPath, ["branch", "--show-current"]).catch(() => "");
  const currentHead = await runGit(projectPath, ["rev-parse", "HEAD"]).catch(() => "");
  const dirty = Boolean((await gitStatus(projectPath)).trim());
  const commits = currentHead ? await listCommits(projectPath, currentHead) : [];
  return {
    gitAvailable: true,
    ...(gitVersion ? { gitVersion } : {}),
    initialized: true,
    dirty,
    ...(currentBranch ? { currentBranch } : {}),
    ...(currentHead ? { currentHead } : {}),
    commits,
    settings,
  };
}

async function listCommits(projectPath: string, currentHead: string): Promise<DesignVersionCommit[]> {
  const branchesByHash = await branchHeads(projectPath);
  const output = await runGit(projectPath, [
    "log",
    "--all",
    "--topo-order",
    "--date=iso-strict",
    "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
  ]).catch(() => "");
  return output.split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): DesignVersionCommit | undefined => {
      const [hash, parents, authorName, authorEmail, authoredAt, message] = entry.split("\x1f");
      if (!hash || !authoredAt || message === undefined) return undefined;
      const parsed = parseVersionMessage(message);
      return {
        hash,
        shortHash: hash.slice(0, 8),
        parentHashes: parents ? parents.split(" ").filter(Boolean) : [],
        authorName: authorName ?? "",
        authorEmail: authorEmail ?? "",
        authoredAt,
        message,
        ...(parsed.versionCode ? { versionCode: parsed.versionCode } : {}),
        ...(parsed.note ? { note: parsed.note } : {}),
        branches: branchesByHash.get(hash) ?? [],
        isHead: hash === currentHead,
      };
    })
    .filter((commit): commit is DesignVersionCommit => Boolean(commit));
}

async function branchHeads(projectPath: string): Promise<Map<string, string[]>> {
  const output = await runGit(projectPath, ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"])
    .catch(() => "");
  const byHash = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [branch, hash] = line.split("\t");
    if (!branch || !hash) continue;
    const list = byHash.get(hash) ?? [];
    list.push(branch);
    byHash.set(hash, list);
  }
  return byHash;
}

async function branchesForCommit(projectPath: string, commitHash: string): Promise<string[]> {
  const byHash = await branchHeads(projectPath);
  return byHash.get(commitHash) ?? [];
}

async function readDesignSettings(root: string): Promise<DesignVersionSettings> {
  try {
    const parsed = JSON.parse(await readFile(designSettingsPath(root), "utf8")) as DesignVersionSettings;
    return {
      ...(parsed.versionControl ? { versionControl: {
        ...(typeof parsed.versionControl.authorName === "string" ? { authorName: parsed.versionControl.authorName } : {}),
        ...(typeof parsed.versionControl.authorEmail === "string" ? { authorEmail: parsed.versionControl.authorEmail } : {}),
      } } : {}),
    };
  } catch {
    return {};
  }
}

async function saveVersionAuthorSettings(
  root: string,
  author: Required<Pick<DesignRecordVersionRequest, "authorName" | "authorEmail">>,
): Promise<void> {
  const current = await readDesignSettings(root);
  const next: DesignVersionSettings = {
    ...current,
    versionControl: {
      authorName: author.authorName,
      authorEmail: author.authorEmail,
    },
  };
  await mkdir(designRoot(root), { recursive: true });
  await writeFile(designSettingsPath(root), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function checkGit(): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"], { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
    const version = stdout.trim();
    return { available: true, ...(version ? { version } : {}) };
  } catch {
    return { available: false };
  }
}

async function hasGitRepository(projectPath: string): Promise<boolean> {
  const entry = await stat(join(projectPath, ".git")).catch(() => undefined);
  return Boolean(entry?.isDirectory() || entry?.isFile());
}

async function initialBranchName(projectPath: string): Promise<string> {
  const entry = await stat(projectPath).catch(() => undefined);
  return `design-${dateBranchCode(entry?.birthtime ?? new Date())}`;
}

async function gitStatus(projectPath: string): Promise<string> {
  return runGit(projectPath, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => "");
}

async function runGit(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: projectPath,
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout.trimEnd();
  } catch (error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
    const message = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(message);
  }
}

function normalizeAuthor(request: DesignRecordVersionRequest): Required<Pick<DesignRecordVersionRequest, "authorName" | "authorEmail">> {
  const authorName = request.authorName.trim();
  const authorEmail = request.authorEmail.trim();
  if (!authorName) throw httpError(400, "Git author name is required.");
  if (!authorEmail) throw httpError(400, "Git author email is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) throw httpError(400, "Git author email is invalid.");
  return { authorName, authorEmail };
}

function normalizeCommitHash(value: string): string {
  const hash = value.trim();
  if (!/^[a-f0-9]{7,64}$/i.test(hash)) throw httpError(400, "Invalid design version hash.");
  return hash;
}

function normalizeBranchName(value: string): string {
  const branchName = value.trim();
  if (!branchName || branchName.includes("\0") || branchName.startsWith("-")) {
    throw httpError(400, "Invalid design branch name.");
  }
  return branchName;
}

function versionMessage(versionCode: string, note: string | undefined): string {
  const normalizedNote = normalizeNote(note);
  return normalizedNote ? `version: ${versionCode} [${normalizedNote}]` : `version: ${versionCode}`;
}

function normalizeNote(note: string | undefined): string {
  return (note ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function parseVersionMessage(message: string): { versionCode?: string; note?: string } {
  const match = /^version:\s+([^\s[]+)(?:\s+\[(.*)\])?$/.exec(message);
  if (!match) return {};
  return {
    versionCode: match[1],
    ...(match[2] ? { note: match[2] } : {}),
  };
}

function dateBranchCode(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, "");
}

function branchCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 80) || "version";
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}
