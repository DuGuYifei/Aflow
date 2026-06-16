import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const installScript = join(repoRoot, "install", "install.sh");
const workflowPath = join(repoRoot, ".github", "workflows", "release-binaries.yml");
const psInstallScript = join(repoRoot, "install", "install.ps1");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installer upgrade behavior", () => {
  test("skips install when versions and binary checksums already match", async () => {
    const root = await tempRoot();
    const bin = join(root, "bin");
    const fake = join(root, "fakebin");
    await mkdir(bin, { recursive: true });

    const specflow = join(bin, "specflow");
    const aflow = join(bin, "aflow");
    await writeExecutable(specflow, "#!/usr/bin/env sh\necho 'specflow 1.2.3'\n");
    await writeExecutable(aflow, "#!/usr/bin/env sh\necho '1.2.3'\n");

    const sums = [
      `${await sha256(specflow)}  specflow-code-linux-x64/specflow`,
      `${await sha256(aflow)}  specflow-code-linux-x64/aflow`,
      "",
    ].join("\n");
    const binarySums = join(root, "SHA256SUMS_BINARIES");
    await writeFile(binarySums, sums);
    await writeFakeCurl(fake, `
case "$url" in
  *SHA256SUMS_BINARIES) cp "$FAKE_BINARY_SUMS" "$out" ;;
  *specflow-code-linux-x64.tar.gz) echo "archive should not be downloaded" >&2; exit 66 ;;
  *) echo "unexpected curl url: $url" >&2; exit 44 ;;
esac
`);

    const result = await runInstall(root, bin, fake, {
      FAKE_BINARY_SUMS: binarySums,
      SPECFLOW_VERSION: "v1.2.3",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("already up to date");
    expect(result.stderr).not.toContain("archive should not be downloaded");
  });

  test("downloads, verifies, and installs when binaries are missing", async () => {
    const root = await tempRoot();
    const bin = join(root, "bin");
    const fake = join(root, "fakebin");
    const archive = await makeArchive(root, "1.2.3");
    const sums = join(root, "SHA256SUMS");
    await writeFile(sums, `${await sha256(archive)}  specflow-code-linux-x64.tar.gz\n`);
    await writeFakeCurl(fake, `
case "$url" in
  *SHA256SUMS) cp "$FAKE_SUMS" "$out" ;;
  *specflow-code-linux-x64.tar.gz) cp "$FAKE_ARCHIVE" "$out" ;;
  *) echo "unexpected curl url: $url" >&2; exit 44 ;;
esac
`);

    const result = await runInstall(root, bin, fake, {
      FAKE_ARCHIVE: archive,
      FAKE_SUMS: sums,
      SPECFLOW_VERSION: "v1.2.3",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(bin, "aflow"), "utf8")).toContain("1.2.3");
    expect(await readFile(join(bin, "specflow"), "utf8")).toContain("specflow 1.2.3");
  });

  test("fails install when archive checksum mismatches", async () => {
    const root = await tempRoot();
    const bin = join(root, "bin");
    const fake = join(root, "fakebin");
    const archive = await makeArchive(root, "1.2.3");
    const sums = join(root, "SHA256SUMS");
    await writeFile(sums, "0000000000000000000000000000000000000000000000000000000000000000  specflow-code-linux-x64.tar.gz\n");
    await writeFakeCurl(fake, `
case "$url" in
  *SHA256SUMS) cp "$FAKE_SUMS" "$out" ;;
  *specflow-code-linux-x64.tar.gz) cp "$FAKE_ARCHIVE" "$out" ;;
  *) echo "unexpected curl url: $url" >&2; exit 44 ;;
esac
`);

    const result = await runInstall(root, bin, fake, {
      FAKE_ARCHIVE: archive,
      FAKE_SUMS: sums,
      SPECFLOW_VERSION: "v1.2.3",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("checksum mismatch");
  });

  test("release workflow and PowerShell installer include binary checksum support", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toContain("SHA256SUMS_BINARIES");
    expect(workflow).toContain("dist/release/SHA256SUMS_BINARIES");
    expect(workflow).toContain("specflow-code-windows-x64/aflow.exe");

    const psInstaller = await readFile(psInstallScript, "utf8");
    expect(psInstaller).toContain("SHA256SUMS_BINARIES");
    expect(psInstaller).toContain("Get-FileHash");
    expect(psInstaller).toContain("already up to date");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aflow-install-test-"));
  tempRoots.push(root);
  return root;
}

async function makeArchive(root: string, version: string): Promise<string> {
  const payload = join(root, "payload");
  await mkdir(payload, { recursive: true });
  await writeExecutable(join(payload, "specflow"), `#!/usr/bin/env sh\necho 'specflow ${version}'\n`);
  await writeExecutable(join(payload, "aflow"), `#!/usr/bin/env sh\necho '${version}'\n`);
  const archive = join(root, "specflow-code-linux-x64.tar.gz");
  await run(["tar", "-czf", archive, "-C", payload, "specflow", "aflow"], {});
  return archive;
}

async function writeFakeCurl(fakeBin: string, body: string): Promise<void> {
  await mkdir(fakeBin, { recursive: true });
  await writeExecutable(join(fakeBin, "curl"), `#!/usr/bin/env sh
set -eu
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [ -z "$out" ]; then
  echo "fake curl requires -o" >&2
  exit 43
fi
${body}
`);
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function runInstall(
  root: string,
  installDir: string,
  fakeBin: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return run(["sh", installScript], {
    ...env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    SPECFLOW_INSTALL_DIR: installDir,
  });
}

async function run(command: string[], env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
