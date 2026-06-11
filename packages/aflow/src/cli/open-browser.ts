export interface BrowserCommand {
  command: string;
  args: string[];
}

export interface OpenBrowserResult {
  ok: boolean;
  command?: string;
  error?: string;
}

export interface BrowserChildProcess {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  unref?(): void;
}

export type BrowserSpawn = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore" },
) => BrowserChildProcess;

export function resolveBrowserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): BrowserCommand {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32" || env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
    return { command: "cmd.exe", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export async function openUrlInDefaultBrowser(
  url: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    spawn?: BrowserSpawn;
  } = {},
): Promise<OpenBrowserResult> {
  const launcher = resolveBrowserCommand(url, options.platform, options.env);
  const spawnBrowser = options.spawn ?? await defaultSpawn();

  try {
    const child = spawnBrowser(launcher.command, launcher.args, { detached: true, stdio: "ignore" });
    return await new Promise<OpenBrowserResult>((resolve) => {
      let settled = false;
      const finish = (result: OpenBrowserResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.once("error", (error) => finish({ ok: false, command: launcher.command, error: error.message }));
      child.once("spawn", () => {
        child.unref?.();
        finish({ ok: true, command: launcher.command });
      });
    });
  } catch (error) {
    return {
      ok: false,
      command: launcher.command,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function defaultSpawn(): Promise<BrowserSpawn> {
  const childProcess = await import("node:child_process");
  return childProcess.spawn as BrowserSpawn;
}
