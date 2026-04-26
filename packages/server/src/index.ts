import Fastify from "fastify";
import {
  CONTINUOUS_CODING_CATEGORY,
  LOCAL_FOUNDATION_STATUS,
  formatDefaultWorkflowFlow
} from "@specflow/shared";

export function buildServer() {
  const server = Fastify({
    logger: true
  });

  server.get("/health", async () => ({
    status: "ok",
    service: "specflow-server"
  }));

  server.get("/api/project", async () => ({
    name: "Specflow",
    category: CONTINUOUS_CODING_CATEGORY,
    status: LOCAL_FOUNDATION_STATUS,
    flow: formatDefaultWorkflowFlow(),
    runtime: "placeholder"
  }));

  return server;
}

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = buildServer();

  await server.listen({ port, host });
}

if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  await start();
}
