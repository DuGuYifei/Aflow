import { dispatchDirectAflowCommand, isDirectAflowCommand } from "./cli/direct-dispatch";
import { consoleCommandIO } from "./cli/io";
import { launchSpecflowOnly } from "./cli/launch-specflow";
import { chooseAflowStartupMode } from "./cli/startup-mode";
import { runAflowAgent } from "./pi/pi-sdk-host";

export async function main(args: string[]): Promise<void> {
  if (isDirectAflowCommand(args[0])) {
    await dispatchDirectAflowCommand(args, {
      cwd: process.cwd(),
      io: consoleCommandIO,
      nativeTerminalHandoff: true,
    });
    return;
  }

  if (args.length === 0) {
    const mode = await chooseAflowStartupMode();
    if (mode === "designer") {
      await launchSpecflowOnly({ design: true });
      return;
    }
    if (mode === "specflow") {
      await launchSpecflowOnly();
      return;
    }
    if (mode === "prd") {
      console.log("Aflow PRD mode is reserved for a future workflow.");
      return;
    }
  }

  await runAflowAgent(args);
}
