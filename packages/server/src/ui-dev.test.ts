import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";
import { findAvailableDevUiPort } from "./ui-dev";

describe("dev UI port selection", () => {
  test("skips an occupied preferred port", async () => {
    const occupied = await listenOnPortInRange(55174, 55220);
    try {
      const selected = await findAvailableDevUiPort(occupied.port);
      expect(selected).toBeGreaterThan(occupied.port);
      expect(selected).toBeLessThan(occupied.port + 20);
    } finally {
      await closeServer(occupied.server);
    }
  });
});

async function listenOnPortInRange(
  start: number,
  end: number,
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  for (let port = start; port <= end; port += 1) {
    const server = await tryListen(port);
    if (server) return { server, port };
  }
  throw new Error(`Failed to bind a local test port in ${start}-${end}.`);
}

function tryListen(port: number): Promise<ReturnType<typeof createServer> | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(undefined));
    server.listen({ host: "127.0.0.1", port }, () => resolve(server));
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
