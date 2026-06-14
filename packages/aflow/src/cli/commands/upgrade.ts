import type { DirectCommandContext } from "../direct-dispatch";

export const AFLOW_UPGRADE_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/DuGuYifei/Aflow/install-v2/install/install.sh | bash";

export type UpgradeCommandRunner = (command: string, context: DirectCommandContext) => Promise<number>;

export async function aflowUpgradeCommand(
  args: string[],
  context: DirectCommandContext,
  runner: UpgradeCommandRunner = runShellCommand,
): Promise<void> {
  if (args.length > 0) throw new Error("Usage: aflow upgrade");

  context.io.info("Updating Aflow and Specflow to the latest stable version...");
  const exitCode = await runner(AFLOW_UPGRADE_COMMAND, context);
  if (exitCode !== 0) throw new Error(`Aflow upgrade failed with exit code ${exitCode}.`);
}

async function runShellCommand(command: string, context: DirectCommandContext): Promise<number> {
  const process = Bun.spawn(["bash", "-lc", command], {
    cwd: context.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return process.exited;
}
