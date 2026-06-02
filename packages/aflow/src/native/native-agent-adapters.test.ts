import { describe, expect, test } from "bun:test";
import type { AgentServerEntry } from "@specflow/agent-proxy";
import { buildNativeResumeRecommendation } from "./native-agent-adapters";

describe("native agent adapters", () => {
  test("builds a known registry resume command", () => {
    const recommendation = buildNativeResumeRecommendation({
      agentServer: registryAgent("codex-acp", "codex"),
      acpSessionId: "acp-123",
    });

    expect(recommendation?.displayCommand).toBe("codex resume acp-123");
    expect(recommendation?.status).toBe("resume");
  });

  test("does not infer native resume from custom command names", () => {
    const recommendation = buildNativeResumeRecommendation({
      agentServer: customAgent("my-codex", "codex"),
      acpSessionId: "acp-123",
    });

    expect(recommendation?.status).toBe("custom-unverified");
    expect(recommendation?.displayCommand).toBe("");
    expect(recommendation?.caveat).toContain("custom agent server");
  });
});

function registryAgent(id: string, registryId: string): AgentServerEntry {
  return {
    id,
    settings: {
      type: "registry",
      registryId,
    },
  };
}

function customAgent(id: string, command: string): AgentServerEntry {
  return {
    id,
    settings: {
      type: "custom",
      command,
    },
  };
}
