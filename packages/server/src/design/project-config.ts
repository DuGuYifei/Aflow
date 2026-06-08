import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DesignProjectConfig, DesignProjectDevCommand, DesignProjectKind } from "./types";

export const DESIGN_PROJECT_CONFIG_DIR = ".aflow-design";
export const DESIGN_PROJECT_CONFIG_FILE = "project.json";

export function defaultReactDevCommand(): DesignProjectDevCommand {
  return {
    command: "npm",
    args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "{port}"],
  };
}

export function projectConfigPath(projectPath: string): string {
  return join(projectPath, DESIGN_PROJECT_CONFIG_DIR, DESIGN_PROJECT_CONFIG_FILE);
}

export async function loadDesignProjectConfig(projectPath: string): Promise<DesignProjectConfig> {
  try {
    const parsed = JSON.parse(await readFile(projectConfigPath(projectPath), "utf8")) as Partial<DesignProjectConfig>;
    const kind = sanitizeProjectKind(parsed.kind);
    return {
      kind,
      ...(parsed.devCommand ? { devCommand: sanitizeDevCommand(parsed.devCommand, kind) } : {}),
      ...(parsed.lastRuntime && typeof parsed.lastRuntime === "object" ? {
        lastRuntime: {
          ...(typeof parsed.lastRuntime.port === "number" ? { port: parsed.lastRuntime.port } : {}),
          ...(typeof parsed.lastRuntime.startedAt === "string" ? { startedAt: parsed.lastRuntime.startedAt } : {}),
          ...(typeof parsed.lastRuntime.stoppedAt === "string" ? { stoppedAt: parsed.lastRuntime.stoppedAt } : {}),
        },
      } : {}),
    };
  } catch {
    return { kind: "html" };
  }
}

export async function saveDesignProjectConfig(projectPath: string, config: DesignProjectConfig): Promise<DesignProjectConfig> {
  const path = projectConfigPath(projectPath);
  const next = normalizeConfig(config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function patchDesignProjectConfig(
  projectPath: string,
  patch: (config: DesignProjectConfig) => DesignProjectConfig,
): Promise<DesignProjectConfig> {
  return saveDesignProjectConfig(projectPath, patch(await loadDesignProjectConfig(projectPath)));
}

export function normalizeConfig(config: DesignProjectConfig): DesignProjectConfig {
  const kind = sanitizeProjectKind(config.kind);
  return {
    kind,
    ...(config.devCommand ? { devCommand: sanitizeDevCommand(config.devCommand, kind) } : kind === "react" ? { devCommand: defaultReactDevCommand() } : {}),
    ...(config.lastRuntime ? { lastRuntime: config.lastRuntime } : {}),
  };
}

export function sanitizeProjectKind(value: unknown): DesignProjectKind {
  return value === "react" ? "react" : "html";
}

function sanitizeDevCommand(value: unknown, kind: DesignProjectKind): DesignProjectDevCommand {
  if (!value || typeof value !== "object") return kind === "react" ? defaultReactDevCommand() : { command: "", args: [] };
  const input = value as Partial<DesignProjectDevCommand>;
  const command = typeof input.command === "string" && input.command.trim() ? input.command.trim() : defaultReactDevCommand().command;
  const args = Array.isArray(input.args)
    ? input.args.filter((item): item is string => typeof item === "string")
    : defaultReactDevCommand().args;
  return { command, args };
}
