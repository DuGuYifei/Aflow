#!/usr/bin/env bun

import { prepareAflowRuntimePackage } from "./bootstrap/runtime-package";
import { isHelpRequest, isVersionRequest, printAflowHelp, printAflowVersion } from "./cli/help";

if (import.meta.main) {
  try {
    prepareAflowRuntimePackage();
    process.title = "aflow";

    const args = Bun.argv.slice(2);
    if (isVersionRequest(args)) {
      printAflowVersion();
    } else if (isHelpRequest(args)) {
      printAflowHelp();
    } else {
      const { main } = await import("./index");
      await main(args);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
