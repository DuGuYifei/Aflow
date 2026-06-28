import { describe, expect, test } from "bun:test";
import { isDirectAflowCommand } from "./direct-dispatch";

describe("direct aflow commands", () => {
  test("recognizes upgrade as a direct command", () => {
    expect(isDirectAflowCommand("upgrade")).toBe(true);
    expect(isDirectAflowCommand("/upgrade")).toBe(false);
  });

  test("does not recognize legacy migration as a direct command", () => {
    expect(isDirectAflowCommand("/specflow-migrate-v2")).toBe(false);
    expect(isDirectAflowCommand("specflow-migrate-v2")).toBe(false);
  });

  test("does not treat ordinary messages as direct commands", () => {
    expect(isDirectAflowCommand("migrate this workflow")).toBe(false);
    expect(isDirectAflowCommand(undefined)).toBe(false);
  });
});
