import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  checkForAflowUpdate,
  formatAflowUpdateNotice,
  readAflowUpdateCache,
  readCachedAflowUpdate,
  refreshAflowUpdateCache,
  startAflowUpdateCheck,
  type AflowUpdateFetch,
} from "./update-check";

describe("Aflow startup update check", () => {
  test("returns a notice when a newer stable release is available", async () => {
    const update = await checkForAflowUpdate({
      currentVersion: "0.0.4",
      fetchImpl: releasesFetch([
        { tag_name: "v0.0.5", prerelease: false, draft: false },
      ]),
    });

    expect(update).toEqual({ currentVersion: "0.0.4", latestVersion: "0.0.5" });
    expect(update && formatAflowUpdateNotice(update)).toBe("Aflow 0.0.5 is available. Run aflow upgrade to update.");
  });

  test("ignores snapshots, equal versions, prereleases, and fetch failures", async () => {
    let called = false;
    expect(await checkForAflowUpdate({
      currentVersion: "0.0.4-snapshot",
      fetchImpl: async () => {
        called = true;
        return jsonResponse([]);
      },
    })).toBeUndefined();
    expect(called).toBe(false);

    expect(await checkForAflowUpdate({
      currentVersion: "0.0.4",
      fetchImpl: releasesFetch([{ tag_name: "v0.0.4" }]),
    })).toBeUndefined();

    expect(await checkForAflowUpdate({
      currentVersion: "0.0.4",
      fetchImpl: releasesFetch([{ tag_name: "v0.0.5-beta.1" }, { tag_name: "v0.0.4" }]),
    })).toBeUndefined();

    expect(await checkForAflowUpdate({
      currentVersion: "0.0.4",
      fetchImpl: async () => { throw new Error("network down"); },
    })).toBeUndefined();
  });

  test("returns a cached update when the cached stable version is newer", async () => {
    const cachePath = await tempCachePath();
    await writeFile(cachePath, JSON.stringify({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    }), "utf8");

    expect(readCachedAflowUpdate({ cachePath, currentVersion: "0.0.4" })).toEqual({
      currentVersion: "0.0.4",
      latestVersion: "0.0.5",
    });
  });

  test("ignores cache entries that should not produce a notice", async () => {
    const cachePath = await tempCachePath();
    await writeFile(cachePath, JSON.stringify({
      latestVersion: "0.0.4",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    }), "utf8");
    expect(readCachedAflowUpdate({ cachePath, currentVersion: "0.0.4" })).toBeUndefined();

    await writeFile(cachePath, JSON.stringify({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: "0.0.5",
    }), "utf8");
    expect(readCachedAflowUpdate({ cachePath, currentVersion: "0.0.4" })).toBeUndefined();

    await writeFile(cachePath, JSON.stringify({
      latestVersion: "0.0.5-beta.1",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    }), "utf8");
    expect(readCachedAflowUpdate({ cachePath, currentVersion: "0.0.4" })).toBeUndefined();

    await writeFile(cachePath, JSON.stringify({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    }), "utf8");
    expect(readCachedAflowUpdate({ cachePath, currentVersion: "0.0.4-snapshot" })).toBeUndefined();
  });

  test("ignores missing and malformed cache files", async () => {
    const cachePath = await tempCachePath();
    expect(readAflowUpdateCache({ cachePath })).toBeUndefined();
    await writeFile(cachePath, "{not-json", "utf8");
    expect(readAflowUpdateCache({ cachePath })).toBeUndefined();
    expect(readCachedAflowUpdate({ cachePath, currentVersion: "0.0.4" })).toBeUndefined();
  });

  test("refreshes the cache with the latest stable release", async () => {
    const cachePath = await tempCachePath();
    await refreshAflowUpdateCache({
      cachePath,
      currentVersion: "0.0.6",
      fetchImpl: releasesFetch([{ tag_name: "v0.0.5", prerelease: false, draft: false }]),
      now: () => new Date("2026-06-21T17:08:58.454Z"),
    });

    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    });
  });

  test("does not damage an existing cache when refresh fails", async () => {
    const cachePath = await tempCachePath();
    const existing = JSON.stringify({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    });
    await writeFile(cachePath, existing, "utf8");

    await refreshAflowUpdateCache({
      cachePath,
      currentVersion: "0.0.4",
      fetchImpl: async () => { throw new Error("network down"); },
    });

    expect(await readFile(cachePath, "utf8")).toBe(existing);
  });

  test("uses cached notices but skips network refresh in offline mode", async () => {
    const cachePath = await tempCachePath();
    await writeFile(cachePath, JSON.stringify({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    }), "utf8");
    let called = false;
    const check = startAflowUpdateCheck(["--offline"], {
      cachePath,
      currentVersion: "0.0.4",
      fetchImpl: async () => {
        called = true;
        return jsonResponse([]);
      },
    });

    expect(called).toBe(false);
    expect(check.cachedUpdate).toEqual({ currentVersion: "0.0.4", latestVersion: "0.0.5" });
    expect(check.refresh).toBeUndefined();
  });

  test("starts a background refresh for non-offline startup checks", async () => {
    const cachePath = await tempCachePath();
    const check = startAflowUpdateCheck([], {
      cachePath,
      currentVersion: "0.0.4",
      fetchImpl: releasesFetch([{ tag_name: "v0.0.5" }]),
      now: () => new Date("2026-06-21T17:08:58.454Z"),
    });

    expect(check.cachedUpdate).toBeUndefined();
    await check.refresh;
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual({
      latestVersion: "0.0.5",
      lastCheckedAt: "2026-06-21T17:08:58.454Z",
      dismissedVersion: null,
    });
  });
});

async function tempCachePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "aflow-update-cache-")), "version.json");
}

function releasesFetch(releases: unknown[]): AflowUpdateFetch {
  return async () => jsonResponse(releases);
}

function jsonResponse(value: unknown): Awaited<ReturnType<AflowUpdateFetch>> {
  return {
    ok: true,
    async json() {
      return value;
    },
  };
}
