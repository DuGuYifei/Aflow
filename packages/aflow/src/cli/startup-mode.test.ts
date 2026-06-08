import { describe, expect, test } from "bun:test";
import { STARTUP_MODE_OPTIONS } from "./startup-mode";

describe("Aflow startup mode menu", () => {
  test("offers native, specflow, and designer modes without PRD", () => {
    expect(STARTUP_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      "native",
      "specflow",
      "designer",
    ]);
    expect(STARTUP_MODE_OPTIONS.some((option) => option.label === "PRD")).toBe(false);
  });
});
