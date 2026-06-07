import { prepareSpecflowWorkspace, startSpecflowServer } from "@specflow/server";

export interface LaunchSpecflowOnlyOptions {
  design?: boolean;
}

export async function launchSpecflowOnly(options: LaunchSpecflowOnlyOptions = {}): Promise<void> {
  await prepareSpecflowWorkspace(process.cwd(), {
    createIfMissing: true,
    prewarmAgentServers: true,
    warn: (message) => console.warn(`Warning: ${message}`),
  });

  const server = await startSpecflowServer();
  if (options.design) {
    console.log(`Aflow Designer UI: ${new URL("design", server.url).toString()}`);
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nStopping Specflow (${signal})...`);
    server.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP", () => stop("SIGHUP"));
  process.once("exit", () => {
    if (!stopping) server.stop();
  });

  await new Promise<void>(() => {
    // Keep the CLI process alive until a signal arrives.
  });
}
