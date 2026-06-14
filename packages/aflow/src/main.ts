import { dispatchDirectAflowCommand, isDirectAflowCommand } from "./cli/direct-dispatch";
import { consoleCommandIO } from "./cli/io";
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

  await runAflowAgent(args);
}
