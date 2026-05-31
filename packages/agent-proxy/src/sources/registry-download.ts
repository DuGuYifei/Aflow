import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentServerCommand } from "../types";
import type { RegistryBinaryTarget } from "./registry-client";
import { safeRelativeCommand } from "../util";

export async function resolveBinaryTarget(input: {
  cacheDir: string;
  registryId: string;
  version: string;
  target: RegistryBinaryTarget;
  extraEnv?: Record<string, string>;
}): Promise<AgentServerCommand> {
  const versionDir = join(input.cacheDir, input.registryId, input.version, hash(input.target.archive));
  const command = safeRelativeCommand(versionDir, input.target.cmd);
  if (!(await exists(command))) {
    await downloadAndExtract(input.target, versionDir);
  }
  await chmod(command, 0o755).catch(() => {});
  return {
    command,
    args: input.target.args ?? [],
    env: { ...(input.target.env ?? {}), ...(input.extraEnv ?? {}) },
  };
}

async function downloadAndExtract(target: RegistryBinaryTarget, versionDir: string): Promise<void> {
  await mkdir(versionDir, { recursive: true });
  const archivePath = join(versionDir, basename(new URL(target.archive).pathname));
  if (!(await exists(archivePath))) {
    const response = await fetch(target.archive);
    if (!response.ok) {
      throw new Error(`Failed to download registry agent archive: ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (target.sha256) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== target.sha256) {
        throw new Error(`Registry archive sha256 mismatch: expected ${target.sha256}, got ${actual}`);
      }
    }
    await writeFile(archivePath, bytes);
  }

  const args = archivePath.endsWith(".zip")
    ? ["unzip", "-o", archivePath, "-d", versionDir]
    : ["tar", "-xf", archivePath, "-C", versionDir];
  const processHandle = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(processHandle.stderr).text();
    throw new Error(`Failed to extract registry agent archive: ${stderr}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
