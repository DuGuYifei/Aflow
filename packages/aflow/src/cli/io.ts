import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface CommandIO {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleCommandIO: CommandIO = {
  info(message) {
    console.log(message);
  },
  success(message) {
    console.log(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  },
};

export function createExtensionCommandIO(ctx: ExtensionCommandContext): CommandIO {
  return {
    info(message) {
      ctx.ui.notify(message, "info");
    },
    success(message) {
      ctx.ui.notify(message, "info");
    },
    warn(message) {
      ctx.ui.notify(message, "warning");
    },
    error(message) {
      ctx.ui.notify(message, "error");
    },
  };
}
