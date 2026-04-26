import { describe, expect, it } from "vitest";
import { buildServer } from "./index.js";

describe("server routes", () => {
  it("responds to health checks", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "specflow-server"
    });
  });
});
