import { prepareSpecflowWorkspace, startSpecflowServer } from "@specflow/server";
import { openUrlInDefaultBrowser, type OpenBrowserResult } from "./open-browser";

export interface LaunchSpecflowOnlyOptions {
  design?: boolean;
  autoOpenBrowser?: boolean;
  openBrowser?: (url: string) => Promise<OpenBrowserResult>;
}

export async function launchSpecflowOnly(options: LaunchSpecflowOnlyOptions = {}): Promise<void> {
  await prepareSpecflowWorkspace(process.cwd(), {
    createIfMissing: true,
    prewarmAgentServers: true,
    warn: (message) => console.warn(`Warning: ${message}`),
  });

  const server = await startSpecflowServer();
  const uiUrl = options.design ? new URL("design", server.url).toString() : server.url;
  console.log(options.design ? `Aflow Designer UI: ${uiUrl}` : `Aflow Specflow UI: ${uiUrl}`);

  if (options.autoOpenBrowser !== false) {
    const openBrowser = options.openBrowser ?? openUrlInDefaultBrowser;
    const result = await openBrowser(uiUrl);
    if (result.ok) {
      console.log("Opened in your default browser.");
    } else {
      console.warn(`Could not open the default browser${result.error ? `: ${result.error}` : ""}`);
      console.warn(`Open this URL manually: ${uiUrl}`);
    }
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
