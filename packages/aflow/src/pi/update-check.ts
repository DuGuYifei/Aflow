import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAflowVersion } from "../bootstrap/runtime-package";

export interface AflowUpdateInfo {
  currentVersion: string;
  latestVersion: string;
}

export interface AflowUpdateCache {
  latestVersion: string;
  lastCheckedAt: string;
  dismissedVersion: string | null;
}

export interface AflowUpdateCheckOptions {
  currentVersion?: string;
  fetchImpl?: AflowUpdateFetch;
  repo?: string;
  timeoutMs?: number;
}

export interface AflowUpdateCacheOptions {
  cachePath?: string;
  currentVersion?: string;
}

export interface AflowUpdateRefreshOptions extends AflowUpdateCheckOptions {
  cachePath?: string;
  now?: () => Date;
}

export type AflowUpdateFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface StartedAflowUpdateCheck {
  cachedUpdate: AflowUpdateInfo | undefined;
  refresh: Promise<void> | undefined;
}

const DEFAULT_REPO = "DuGuYifei/Aflow";
const DEFAULT_TIMEOUT_MS = 1200;

export async function checkForAflowUpdate(options: AflowUpdateCheckOptions = {}): Promise<AflowUpdateInfo | undefined> {
  const currentVersion = options.currentVersion ?? getAflowVersion();
  const current = parseStableVersion(currentVersion);
  if (!current) return undefined;

  const latestVersion = await fetchLatestStableAflowVersion(options);
  if (!latestVersion) return undefined;
  const latest = parseStableVersion(latestVersion);
  if (!latest || compareStableVersions(latest, current) <= 0) return undefined;

  return { currentVersion, latestVersion };
}

export function startAflowUpdateCheck(
  args: string[],
  options: AflowUpdateRefreshOptions = {},
): StartedAflowUpdateCheck {
  const cachedUpdate = readCachedAflowUpdate(options);

  if (args.some((arg) => arg === "--offline")) {
    return { cachedUpdate, refresh: undefined };
  }

  return {
    cachedUpdate,
    refresh: refreshAflowUpdateCache(options),
  };
}

export function formatAflowUpdateNotice(update: AflowUpdateInfo): string {
  return `Aflow ${update.latestVersion} is available. Run aflow upgrade to update.`;
}

export function getAflowUpdateCachePath(): string {
  return join(homedir(), ".aflow", "version.json");
}

export function readAflowUpdateCache(options: Pick<AflowUpdateCacheOptions, "cachePath"> = {}): AflowUpdateCache | undefined {
  try {
    const path = options.cachePath ?? getAflowUpdateCachePath();
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Partial<AflowUpdateCache>;
    if (typeof record.latestVersion !== "string") return undefined;
    if (typeof record.lastCheckedAt !== "string") return undefined;
    if (record.dismissedVersion !== null && typeof record.dismissedVersion !== "string") return undefined;
    return {
      latestVersion: record.latestVersion,
      lastCheckedAt: record.lastCheckedAt,
      dismissedVersion: record.dismissedVersion,
    };
  } catch {
    return undefined;
  }
}

export function writeAflowUpdateCache(
  cache: AflowUpdateCache,
  options: Pick<AflowUpdateCacheOptions, "cachePath"> = {},
): void {
  const path = options.cachePath ?? getAflowUpdateCachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`);
}

export function dismissAflowUpdate(
  update: AflowUpdateInfo,
  options: Pick<AflowUpdateCacheOptions, "cachePath"> = {},
): void {
  const existing = readAflowUpdateCache(options);
  writeAflowUpdateCache({
    latestVersion: update.latestVersion,
    lastCheckedAt: existing?.lastCheckedAt ?? new Date().toISOString(),
    dismissedVersion: update.latestVersion,
  }, options);
}

export function updateInfoFromCache(
  cache: AflowUpdateCache | undefined,
  options: Pick<AflowUpdateCacheOptions, "currentVersion"> = {},
): AflowUpdateInfo | undefined {
  if (!cache) return undefined;
  const currentVersion = options.currentVersion ?? getAflowVersion();
  const current = parseStableVersion(currentVersion);
  const latest = parseStableVersion(cache.latestVersion);
  if (!current || !latest) return undefined;
  if (cache.dismissedVersion && sameStableVersion(cache.dismissedVersion, latest)) return undefined;
  if (compareStableVersions(latest, current) <= 0) return undefined;
  return { currentVersion, latestVersion: formatStableVersion(latest) };
}

export function readCachedAflowUpdate(options: AflowUpdateCacheOptions = {}): AflowUpdateInfo | undefined {
  return updateInfoFromCache(readAflowUpdateCache(options), options);
}

export async function refreshAflowUpdateCache(options: AflowUpdateRefreshOptions = {}): Promise<void> {
  const currentVersion = options.currentVersion ?? getAflowVersion();
  if (!parseStableVersion(currentVersion)) return;
  try {
    const latestVersion = await fetchLatestStableAflowVersion(options);
    if (!latestVersion) return;
    const latest = parseStableVersion(latestVersion);
    if (!latest) return;
    const existing = readAflowUpdateCache(options);
    writeAflowUpdateCache({
      latestVersion,
      lastCheckedAt: (options.now ?? (() => new Date()))().toISOString(),
      dismissedVersion: existing?.dismissedVersion && sameStableVersion(existing.dismissedVersion, latest)
        ? existing.dismissedVersion
        : null,
    }, options);
  } catch {
    // Update checks should never affect startup.
  }
}

type StableVersion = { major: number; minor: number; patch: number };

function latestStableVersionFromReleases(rawValue: unknown): string | undefined {
  if (!Array.isArray(rawValue)) return undefined;
  for (const release of rawValue) {
    if (!release || typeof release !== "object") continue;
    const record = release as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
    if (record.prerelease === true || record.draft === true) continue;
    if (typeof record.tag_name !== "string") continue;
    const parsed = parseStableVersion(record.tag_name);
    if (parsed) return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  }
  return undefined;
}

async function fetchLatestStableAflowVersion(options: AflowUpdateCheckOptions = {}): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const repo = options.repo ?? process.env["SPECFLOW_REPO"] ?? DEFAULT_REPO;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases`, {
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return undefined;
    return latestStableVersionFromReleases(await response.json());
  } catch {
    return undefined;
  }
}

function parseStableVersion(value: string): StableVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareStableVersions(left: StableVersion, right: StableVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function formatStableVersion(version: StableVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function sameStableVersion(value: string, version: StableVersion): boolean {
  const parsed = parseStableVersion(value);
  return !!parsed && compareStableVersions(parsed, version) === 0;
}
