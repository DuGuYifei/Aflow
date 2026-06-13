export type AflowStartupMode = "designer" | "specflow" | "native";

interface StartupModeOption {
  mode: AflowStartupMode;
  label: string;
  description: string;
}

export const STARTUP_MODE_OPTIONS: StartupModeOption[] = [
  { mode: "native", label: "Native Aflow", description: "Open the Aflow agent TUI for workflow authoring and execution" },
  { mode: "specflow", label: "Specflow", description: "Open the Specflow Agentflow canvas server" },
  { mode: "designer", label: "Designer", description: "Open the design workbench at /design" },
];

export async function chooseAflowStartupMode(): Promise<AflowStartupMode> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "native";

  let selectedIndex = 0;
  const render = () => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write("Aflow\n\n");
    process.stdout.write("Choose a workspace mode:\n\n");
    for (let index = 0; index < STARTUP_MODE_OPTIONS.length; index += 1) {
      const option = STARTUP_MODE_OPTIONS[index]!;
      const active = index === selectedIndex ? ">" : " ";
      process.stdout.write(`${active} ${index + 1}. ${option.label.padEnd(13)} ${option.description}\n`);
    }
    process.stdout.write("\nUse Up/Down, 1-3, Enter to select, Ctrl+C to exit.\n");
  };

  return new Promise<AflowStartupMode>((resolve) => {
    const stdin = process.stdin;
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const finish = (mode: AflowStartupMode) => {
      cleanup();
      resolve(mode);
    };
    const numericPattern = new RegExp(`^[1-${STARTUP_MODE_OPTIONS.length}]$`);
    const onData = (chunk: Buffer) => {
      const value = chunk.toString("utf8");
      if (value === "\u0003") {
        cleanup();
        process.exit(130);
      }
      if (value === "\r" || value === "\n") {
        finish(STARTUP_MODE_OPTIONS[selectedIndex]!.mode);
        return;
      }
      if (numericPattern.test(value)) {
        finish(STARTUP_MODE_OPTIONS[Number(value) - 1]!.mode);
        return;
      }
      if (value === "\x1b[A") {
        selectedIndex = (selectedIndex + STARTUP_MODE_OPTIONS.length - 1) % STARTUP_MODE_OPTIONS.length;
        render();
        return;
      }
      if (value === "\x1b[B") {
        selectedIndex = (selectedIndex + 1) % STARTUP_MODE_OPTIONS.length;
        render();
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    render();
  });
}
