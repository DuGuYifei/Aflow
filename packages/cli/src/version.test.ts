import { describe, expect, test } from "bun:test";
import {
  expectedSnapshotVersionForReleaseTag,
  formatSpecflowVersion,
  isVersionCommand,
  releaseVersionFromTag,
  setPackageVersion,
  validateReleaseVersion,
} from "./version";

describe("version commands", () => {
  test("recognizes top-level version commands", () => {
    expect(isVersionCommand(["--version"])).toBe(true);
    expect(isVersionCommand(["-v"])).toBe(true);
    expect(isVersionCommand(["version"])).toBe(true);
    expect(isVersionCommand(["run"])).toBe(false);
    expect(isVersionCommand(["--version", "extra"])).toBe(false);
  });

  test("formats the CLI version line", async () => {
    expect(await formatSpecflowVersion("1.2.3-beta.4")).toBe("specflow 1.2.3-beta.4");
  });
});

describe("release version validation", () => {
  test("resolves release versions from tags", () => {
    expect(releaseVersionFromTag("v0.0.1")).toBe("0.0.1");
    expect(releaseVersionFromTag("v0.0.1-beta.3")).toBe("0.0.1-beta.3");
    expect(() => releaseVersionFromTag("0.0.1")).toThrow("Release tag must be");
  });

  test("accepts matching stable and prerelease tags", () => {
    expect(validateReleaseVersion("v0.0.1", "0.0.1")).toBe("0.0.1");
    expect(validateReleaseVersion("v0.0.1-alpha.1", "0.0.1-alpha.1")).toBe("0.0.1-alpha.1");
    expect(validateReleaseVersion("v0.0.1-beta.2", "0.0.1-beta.2")).toBe("0.0.1-beta.2");
    expect(validateReleaseVersion("v0.0.1-rc.3", "0.0.1-rc.3")).toBe("0.0.1-rc.3");
  });

  test("rejects snapshot versions and mismatched tags", () => {
    expect(() => validateReleaseVersion("v0.0.1", "0.0.1-snapshot")).toThrow("package.json version");
    expect(() => validateReleaseVersion("v0.0.1", "0.0.2")).toThrow("does not match");
    expect(() => validateReleaseVersion("0.0.1", "0.0.1")).toThrow("Release tag must be");
  });
});

describe("post-release snapshot version", () => {
  test("uses next patch snapshot after stable releases", () => {
    expect(expectedSnapshotVersionForReleaseTag("v0.0.1")).toBe("0.0.2-snapshot");
    expect(expectedSnapshotVersionForReleaseTag("v1.2.9")).toBe("1.2.10-snapshot");
  });

  test("uses same baseline snapshot after prereleases", () => {
    expect(expectedSnapshotVersionForReleaseTag("v0.0.1-alpha.1")).toBe("0.0.1-snapshot");
    expect(expectedSnapshotVersionForReleaseTag("v0.0.1-beta.2")).toBe("0.0.1-snapshot");
    expect(expectedSnapshotVersionForReleaseTag("v0.0.1-rc.3")).toBe("0.0.1-snapshot");
  });
});

describe("package version updates", () => {
  test("updates only the version field", async () => {
    const packageJsonPath = `/tmp/specflow-version-${crypto.randomUUID()}.json`;
    await Bun.write(packageJsonPath, `${JSON.stringify({ name: "specflow-code", version: "0.0.0", private: true }, null, 2)}\n`);

    await setPackageVersion(packageJsonPath, "0.0.1-snapshot");

    expect(await Bun.file(packageJsonPath).json()).toEqual({
      name: "specflow-code",
      version: "0.0.1-snapshot",
      private: true,
    });
  });
});
