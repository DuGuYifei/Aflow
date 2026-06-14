import { describe, expect, test } from "bun:test";
import {
  checkForAflowUpdate,
  formatAflowUpdateNotice,
  startAflowUpdateCheck,
  type AflowUpdateFetch,
  type AflowUpdateInfo,
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

  test("does not report slow checks after startup has moved on", async () => {
    let resolveCheck!: (value: AflowUpdateInfo | undefined) => void;
    const check = startAflowUpdateCheck([], () => new Promise((resolve) => {
      resolveCheck = resolve;
    }));

    expect(check.readIfSettled()).toBeUndefined();
    resolveCheck({ currentVersion: "0.0.4", latestVersion: "0.0.5" });
    await Promise.resolve();
    await Promise.resolve();
    expect(check.readIfSettled()).toEqual({ currentVersion: "0.0.4", latestVersion: "0.0.5" });
  });

  test("skips checks in offline mode", async () => {
    let called = false;
    const check = startAflowUpdateCheck(["--offline"], async () => {
      called = true;
      return { currentVersion: "0.0.4", latestVersion: "0.0.5" };
    });

    await Promise.resolve();
    expect(called).toBe(false);
    expect(check.readIfSettled()).toBeUndefined();
  });
});

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
