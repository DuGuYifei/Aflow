import { getAflowVersion } from "../bootstrap/runtime-package";

export interface AflowUpdateInfo {
  currentVersion: string;
  latestVersion: string;
}

export interface AflowUpdateCheckOptions {
  currentVersion?: string;
  fetchImpl?: AflowUpdateFetch;
  repo?: string;
  timeoutMs?: number;
}

export type AflowUpdateFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface StartedAflowUpdateCheck {
  readIfSettled(): AflowUpdateInfo | undefined;
}

const DEFAULT_REPO = "DuGuYifei/Aflow";
const DEFAULT_TIMEOUT_MS = 1200;

export async function checkForAflowUpdate(options: AflowUpdateCheckOptions = {}): Promise<AflowUpdateInfo | undefined> {
  const currentVersion = options.currentVersion ?? getAflowVersion();
  const current = parseStableVersion(currentVersion);
  if (!current) return undefined;

  const fetchImpl = options.fetchImpl ?? fetch;
  const repo = options.repo ?? process.env["SPECFLOW_REPO"] ?? DEFAULT_REPO;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases`, {
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return undefined;

    const latestVersion = latestStableVersionFromReleases(await response.json());
    if (!latestVersion) return undefined;
    const latest = parseStableVersion(latestVersion);
    if (!latest || compareStableVersions(latest, current) <= 0) return undefined;

    return { currentVersion, latestVersion };
  } catch {
    return undefined;
  }
}

export function startAflowUpdateCheck(
  args: string[],
  checker: () => Promise<AflowUpdateInfo | undefined> = () => checkForAflowUpdate(),
): StartedAflowUpdateCheck {
  let settled = false;
  let update: AflowUpdateInfo | undefined;

  if (args.some((arg) => arg === "--offline")) {
    return { readIfSettled: () => undefined };
  }

  void checker()
    .then((result) => {
      update = result;
    }, () => {
      update = undefined;
    })
    .finally(() => {
      settled = true;
    });

  return {
    readIfSettled() {
      return settled ? update : undefined;
    },
  };
}

export function formatAflowUpdateNotice(update: AflowUpdateInfo): string {
  return `Aflow ${update.latestVersion} is available. Run aflow upgrade to update.`;
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
