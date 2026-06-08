import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import type { DesignArtifact, DesignArtifactFrame, DesignProjectSummary } from "./types";

interface DesignProjectManifest {
  frames?: unknown;
}

export async function loadDesignProjectArtifact(
  projectName: string,
  projectPath: string,
): Promise<DesignArtifact> {
  const manifest = await readProjectManifest(projectPath);
  const frames = manifest ? sanitizeManifestFrames(manifest.frames) : await inferFramesFromProject(projectPath);
  const projectStat = await stat(projectPath);
  return {
    id: projectName,
    projectName,
    projectPath,
    createdAt: projectStat.mtime.toISOString(),
    ...(frames.length > 0 ? { frames } : {}),
  };
}

export function buildDesignExecutionPrompt(_project: DesignProjectSummary, message: string): string {
  return message;
}

async function readProjectManifest(projectPath: string): Promise<DesignProjectManifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(projectPath, "manifest.json"), "utf8")) as DesignProjectManifest;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeManifestFrames(value: unknown): DesignArtifactFrame[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => sanitizeFrame(entry, index))
    .filter((frame): frame is DesignArtifactFrame => Boolean(frame));
}

function sanitizeFrame(value: unknown, index: number): DesignArtifactFrame | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" && input.id.trim() ? slug(input.id, index) : `frame-${index + 1}`;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : titleFromId(id);
  const designPath = typeof input.designPath === "string" && input.designPath.trim()
    ? safeFrameHtmlFile(input.designPath)
    : undefined;
  const wireframePath = typeof input.wireframePath === "string" && input.wireframePath.trim()
    ? safeFrameHtmlFile(input.wireframePath)
    : undefined;
  const descriptionPath = typeof input.descriptionPath === "string" && input.descriptionPath.trim()
    ? safeFrameMarkdownFile(input.descriptionPath)
    : undefined;
  if (!designPath && !wireframePath) return undefined;
  return {
    id,
    title,
    ...(typeof input.kind === "string" && input.kind.trim() ? { kind: input.kind.trim() } : {}),
    width: positiveNumber(input.width, id.includes("mobile") ? 390 : 1440),
    height: positiveNumber(input.height, id.includes("mobile") ? 844 : 1024),
    x: numberValue(input.x, index * (id.includes("mobile") ? 470 : 1520)),
    y: numberValue(input.y, 0),
    ...(designPath ? { designPath } : {}),
    ...(wireframePath ? { wireframePath } : {}),
    ...(descriptionPath ? { descriptionPath } : {}),
  };
}

async function inferFramesFromProject(projectPath: string): Promise<DesignArtifactFrame[]> {
  const entries = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
    .map((entry) => entry.name)
    .sort();
  const existingFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  return htmlFiles.map((fileName, index) => {
    const id = slug(fileName.replace(/\.html$/i, ""), index);
    const descriptionPath = `${fileName.replace(/\.html$/i, "")}.md`;
    return {
      id,
      title: titleFromId(id),
      kind: id.includes("mobile") ? "mobile" : id.includes("wireframe") ? "wireframe" : "desktop",
      width: id.includes("mobile") ? 390 : 1440,
      height: id.includes("mobile") ? 844 : 1024,
      x: index * (id.includes("mobile") ? 470 : 1520),
      y: 0,
      designPath: fileName,
      ...(existingFiles.has(descriptionPath) ? { descriptionPath } : {}),
    };
  });
}

export function safeProjectRelativePath(path: string): string {
  const normalized = normalize(path.trim()).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`Invalid design project file path: ${path}`);
  }
  return normalized;
}

function safeFrameHtmlFile(path: string): string {
  const safePath = safeProjectRelativePath(path);
  if (safePath !== basename(safePath) || !safePath.toLowerCase().endsWith(".html")) {
    throw new Error(`Design frame path must be a root-level HTML file: ${path}`);
  }
  return safePath;
}

function safeFrameMarkdownFile(path: string): string {
  const safePath = safeProjectRelativePath(path);
  if (safePath !== basename(safePath) || !safePath.toLowerCase().endsWith(".md")) {
    throw new Error(`Design description path must be a root-level Markdown file: ${path}`);
  }
  return safePath;
}

function positiveNumber(value: unknown, fallback: number): number {
  const next = numberValue(value, fallback);
  return next > 0 ? next : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function titleFromId(id: string): string {
  return id.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || id;
}

function slug(value: string, index: number): string {
  const slugged = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slugged || `frame-${index + 1}`;
}
