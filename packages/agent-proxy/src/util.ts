import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";

export function normalizeEnv(input?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter((entry): entry is [string, string] => {
      return typeof entry[0] === "string" && typeof entry[1] === "string";
    }),
  );
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

export function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  if (!isInsideResolvedRoot(resolvedRoot, resolvedCandidate)) {
    throw new Error(`Path escapes workspace root: ${candidate}`);
  }
  return resolvedCandidate;
}

export function assertInsideAllowedRoots(roots: string[], candidate: string): string {
  const baseRoot = roots[0] ?? process.cwd();
  const resolvedCandidate = isAbsolute(candidate) ? resolve(candidate) : resolve(baseRoot, candidate);
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    if (isInsideResolvedRoot(resolvedRoot, resolvedCandidate)) return resolvedCandidate;
  }
  throw new Error(`Path escapes allowed workspace roots: ${candidate}`);
}

function isInsideResolvedRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function safeRelativeCommand(baseDir: string, command: string): string {
  if (isAbsolute(command) || command.includes("..")) {
    throw new Error(`Registry command must be relative and cannot contain '..': ${command}`);
  }
  const trimmed = command.startsWith("./") || command.startsWith(".\\") ? command.slice(2) : command;
  return normalize(join(baseDir, trimmed));
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
