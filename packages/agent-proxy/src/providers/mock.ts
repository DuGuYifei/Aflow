import type { AgentCommandRequest } from "../proxy";

export function createMockRequest(prompt: string, cwd: string): AgentCommandRequest {
  return {
    provider: "mock",
    prompt,
    cwd,
  };
}
