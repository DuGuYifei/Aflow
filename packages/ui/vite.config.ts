import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEV_UI_PORT } from "../shared/src/constants.ts";

const devUiPort = Number(process.env["SPECFLOW_DEV_UI_PORT"]) || DEV_UI_PORT;
const devUiPolling = parseBoolean(process.env["SPECFLOW_DEV_UI_POLLING"])
  ?? (process.platform === "linux" && /^\/mnt\/[a-z]\//i.test(process.cwd()));
const devUiPollInterval = Number(process.env["SPECFLOW_DEV_UI_POLL_INTERVAL"]) || 100;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: devUiPort,
    hmr: {
      host: "127.0.0.1",
      clientPort: devUiPort,
    },
    watch: devUiPolling ? {
      usePolling: true,
      interval: devUiPollInterval,
    } : undefined,
  },
});

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}
