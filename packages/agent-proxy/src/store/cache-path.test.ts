import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveAgentCacheDir } from "./cache-path";

describe("agent cache path", () => {
  test("defaults to the user-level Specflow agent cache", () => {
    expect(resolveAgentCacheDir({ env: {}, homeDir: "/home/tester" }))
      .toBe(join("/home/tester", ".aflow", ".specflow", "cache", "agents"));
  });

  test("prefers explicit cacheDir and expands home", () => {
    expect(resolveAgentCacheDir({
      cacheDir: "~/custom-agents",
      env: { SPECFLOW_AGENT_CACHE_DIR: "/ignored" },
      homeDir: "/home/tester",
    })).toBe(join("/home/tester", "custom-agents"));
  });

  test("uses SPECFLOW_AGENT_CACHE_DIR before the default path", () => {
    expect(resolveAgentCacheDir({
      env: { SPECFLOW_AGENT_CACHE_DIR: "~/.cache/specflow-agents" },
      homeDir: "/home/tester",
    })).toBe(join("/home/tester", ".cache", "specflow-agents"));
  });
});
