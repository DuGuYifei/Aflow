const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;

interface ReleaseTagParts {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
}

export function isVersionCommand(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "version");
}

export async function getSpecflowVersion(): Promise<string> {
  const injectedVersion = process.env.SPECFLOW_VERSION;
  if (injectedVersion) return injectedVersion;
  return readPackageVersion(new URL("../../../package.json", import.meta.url));
}

export async function formatSpecflowVersion(version?: string): Promise<string> {
  return `specflow ${version ?? await getSpecflowVersion()}`;
}

export async function readPackageVersion(packageJsonPath: string | URL): Promise<string> {
  const rawValue = await Bun.file(packageJsonPath).json();
  const version = typeof rawValue === "object" && rawValue !== null && "version" in rawValue
    ? (rawValue as { version?: unknown }).version
    : undefined;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Missing package version in ${String(packageJsonPath)}`);
  }
  return version;
}

export async function setPackageVersion(packageJsonPath: string | URL, version: string): Promise<void> {
  const rawValue = await Bun.file(packageJsonPath).json();
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
    throw new Error(`Invalid package.json at ${String(packageJsonPath)}`);
  }
  await Bun.write(packageJsonPath, `${JSON.stringify({ ...rawValue, version }, null, 2)}\n`);
}

export function validateReleaseVersion(tag: string, packageVersion: string): string {
  const release = parseReleaseTag(tag);
  if (!VERSION_PATTERN.test(packageVersion)) {
    throw new Error("package.json version must be X.Y.Z, X.Y.Z-alpha.N, X.Y.Z-beta.N, or X.Y.Z-rc.N for releases.");
  }
  if (packageVersion !== release.version) {
    throw new Error(`Release tag ${tag} does not match package.json version ${packageVersion}. Expected ${release.version}.`);
  }
  return release.version;
}

export function releaseVersionFromTag(tag: string): string {
  return parseReleaseTag(tag).version;
}

export function expectedSnapshotVersionForReleaseTag(tag: string): string {
  const release = parseReleaseTag(tag);
  if (release.prerelease) return `${release.major}.${release.minor}.${release.patch}-snapshot`;
  return `${release.major}.${release.minor}.${release.patch + 1}-snapshot`;
}

function parseReleaseTag(tag: string): ReleaseTagParts {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error("Release tag must be vX.Y.Z, vX.Y.Z-alpha.N, vX.Y.Z-beta.N, or vX.Y.Z-rc.N.");
  }
  const [, majorRaw, minorRaw, patchRaw, prereleaseLabel] = match;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  return {
    version: tag.slice(1),
    major,
    minor,
    patch,
    prerelease: Boolean(prereleaseLabel),
  };
}

if (import.meta.main) {
  try {
    const [command, ...args] = Bun.argv.slice(2);
    if (command === "package-version") {
      console.log(await readPackageVersion(args[0] ?? "package.json"));
    } else if (command === "set-package-version") {
      const [packageJsonPath = "package.json", version] = args;
      if (!version) throw new Error("Usage: version.ts set-package-version <package.json> <version>");
      await setPackageVersion(packageJsonPath, version);
    } else if (command === "validate-release") {
      const [tag, packageVersion] = args;
      if (!tag || !packageVersion) throw new Error("Usage: version.ts validate-release <tag> <package-version>");
      console.log(validateReleaseVersion(tag, packageVersion));
    } else if (command === "release-version") {
      const [tag] = args;
      if (!tag) throw new Error("Usage: version.ts release-version <tag>");
      console.log(releaseVersionFromTag(tag));
    } else if (command === "expected-snapshot") {
      const [tag] = args;
      if (!tag) throw new Error("Usage: version.ts expected-snapshot <tag>");
      console.log(expectedSnapshotVersionForReleaseTag(tag));
    } else {
      throw new Error("Usage: version.ts <package-version|set-package-version|validate-release|expected-snapshot> ...");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
