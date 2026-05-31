import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEV_UI_PORT } from "../shared/src/constants.ts";

const devUiPort = Number(process.env["SPECFLOW_DEV_UI_PORT"]) || DEV_UI_PORT;

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
  },
});
