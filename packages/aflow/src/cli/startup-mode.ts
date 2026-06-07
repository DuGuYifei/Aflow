export type AflowStartupMode = "designer" | "prd" | "specflow" | "native";

interface StartupModeOption {
  mode: AflowStartupMode;
  label: string;
  description: string;
}

const OPTIONS: StartupModeOption[] = [
  { mode: "native", label: "Native Aflow", description: "Start the original Aflow agent TUI" },
  { mode: "specflow", label: "Specflow", description: "Open the Agentflow canvas server" },
  { mode: "designer", label: "Designer", description: "Open the design workbench at /design" },
  { mode: "prd", label: "PRD", description: "Placeholder for future PM workflows" },
];

export async function chooseAflowStartupMode(): Promise<AflowStartupMode> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "native";

  let selectedIndex = 0;
  const render = () => {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write("Aflow\n\n");
    process.stdout.write("Choose a workspace mode:\n\n");
    for (let index = 0; index < OPTIONS.length; index += 1) {
      const option = OPTIONS[index]!;
      const active = index === selectedIndex ? ">" : " ";
      process.stdout.write(`${active} ${index + 1}. ${option.label.padEnd(13)} ${option.description}\n`);
    }
    process.stdout.write("\nUse Up/Down, 1-4, Enter to select, Ctrl+C to exit.\n");
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
    const onData = (chunk: Buffer) => {
      const value = chunk.toString("utf8");
      if (value === "\u0003") {
        cleanup();
        process.exit(130);
      }
      if (value === "\r" || value === "\n") {
        finish(OPTIONS[selectedIndex]!.mode);
        return;
      }
      if (/^[1-4]$/.test(value)) {
        finish(OPTIONS[Number(value) - 1]!.mode);
        return;
      }
      if (value === "\x1b[A") {
        selectedIndex = (selectedIndex + OPTIONS.length - 1) % OPTIONS.length;
        render();
        return;
      }
      if (value === "\x1b[B") {
        selectedIndex = (selectedIndex + 1) % OPTIONS.length;
        render();
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    render();
  });
}
