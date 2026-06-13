import { describe, expect, test } from "bun:test";
import { isDirectAflowCommand } from "./direct-dispatch";

describe("direct aflow commands", () => {
  test("recognizes migration as a direct command", () => {
    expect(isDirectAflowCommand("/specflow-migrate-v2")).toBe(true);
    expect(isDirectAflowCommand("specflow-migrate-v2")).toBe(true);
  });

  test("does not treat ordinary messages as direct commands", () => {
    expect(isDirectAflowCommand("migrate this workflow")).toBe(false);
    expect(isDirectAflowCommand(undefined)).toBe(false);
  });
});
