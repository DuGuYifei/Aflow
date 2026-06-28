import { describe, expect, test } from "bun:test";
import { buildNativeResumeRecommendation } from "./index";

describe("native resume recommendations", () => {
  test("builds verified commands for known registry agents", () => {
    expect(buildNativeResumeRecommendation({
      agentServer: { id: "codex-acp", settings: { type: "registry", registryId: "codex-acp" } },
      acpSessionId: "session-1",
    })).toMatchObject({
      status: "resume",
      command: "codex",
      args: ["resume", "session-1"],
      displayCommand: "codex resume session-1",
    });
  });

  test("returns unavailable recommendations for custom and unknown agents", () => {
    expect(buildNativeResumeRecommendation({
      agentServer: { id: "my-agent", settings: { type: "custom" } },
      acpSessionId: "session-1",
    })).toMatchObject({
      status: "custom-unverified",
      displayCommand: "",
    });

    expect(buildNativeResumeRecommendation({
      agentServerId: "unlisted-agent",
      acpSessionId: "session-1",
    })).toBeUndefined();
  });
});
