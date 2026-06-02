import { spawn, spawnSync } from "node:child_process";
import type { NativeResumeRecommendation } from "./native-agent-adapters";

const AFLOW_GREEN = "\x1b[38;5;118m";
const RESET = "\x1b[0m";

export async function handoffToNativeTerminal(recommendation: NativeResumeRecommendation): Promise<number> {
  if (!recommendation.command) throw new Error("Native resume command is unavailable.");
  printAflowLine(`Aflow handoff -> ${recommendation.displayCommand}`);

  const previousSigintListeners = process.listeners("SIGINT");
  process.removeAllListeners("SIGINT");
  process.on("SIGINT", noop);

  const child = spawn(recommendation.command, recommendation.args, {
    stdio: "inherit",
    shell: false,
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) resolve(128 + signalToNumber(signal));
      else resolve(code ?? 0);
    });
  }).finally(() => {
    process.removeListener("SIGINT", noop);
    for (const listener of previousSigintListeners) {
      process.on("SIGINT", listener);
    }
  });

  printAflowLine(`Aflow resumed <- native CLI exited with code ${exitCode}`);
  return exitCode;
}

export async function handoffToNativeTerminalFromTui(
  recommendation: NativeResumeRecommendation,
  ui: {
    custom<T>(
      factory: (
        tui: { stop(): void; start(): void; requestRender(force?: boolean): void },
        theme: unknown,
        keybindings: unknown,
        done: (result: T) => void,
      ) => { render(): string[]; invalidate(): void },
    ): Promise<T>;
  },
): Promise<number> {
  if (!recommendation.command) throw new Error("Native resume command is unavailable.");
  return ui.custom<number>((tui, _theme, _keybindings, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");
    printAflowLine(`Aflow handoff -> ${recommendation.displayCommand}`);
    const result = spawnSync(recommendation.command, recommendation.args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    const exitCode = result.signal
      ? 128 + signalToNumber(result.signal)
      : result.status ?? (result.error ? 1 : 0);
    printAflowLine(`Aflow resumed <- native CLI exited with code ${exitCode}`);
    tui.start();
    tui.requestRender(true);
    done(exitCode);
    return { render: () => [], invalidate: () => {} };
  });
}

function printAflowLine(message: string): void {
  console.log(`${AFLOW_GREEN}${message}${RESET}`);
}

function noop(): void {
  // Keep Ctrl+C scoped to the inherited native terminal child during handoff.
}

function signalToNumber(signal: NodeJS.Signals): number {
  if (signal === "SIGINT") return 2;
  if (signal === "SIGTERM") return 15;
  return 0;
}
