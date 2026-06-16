import { describe, expect, test } from "bun:test";
import { AFLOW_SYSTEM_PROMPT } from "./prompt-content";
import { withAflowSystemPrompt } from "./system-prompt";

describe("withAflowSystemPrompt", () => {
  test("appends the Aflow domain prompt without replacing Pi's base prompt", () => {
    expect(withAflowSystemPrompt(["hello"])).toEqual([
      "hello",
      "--append-system-prompt",
      AFLOW_SYSTEM_PROMPT,
    ]);
  });

  test("leaves help and version requests unchanged", () => {
    expect(withAflowSystemPrompt(["--help"])).toEqual(["--help"]);
    expect(withAflowSystemPrompt(["--version"])).toEqual(["--version"]);
  });

  test("can be disabled for debugging", () => {
    const original = process.env["AFLOW_DISABLE_SYSTEM_PROMPT"];
    process.env["AFLOW_DISABLE_SYSTEM_PROMPT"] = "1";
    try {
      expect(withAflowSystemPrompt(["hello"])).toEqual(["hello"]);
    } finally {
      if (original === undefined) delete process.env["AFLOW_DISABLE_SYSTEM_PROMPT"];
      else process.env["AFLOW_DISABLE_SYSTEM_PROMPT"] = original;
    }
  });
});
