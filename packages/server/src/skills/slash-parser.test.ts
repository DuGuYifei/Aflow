import { describe, expect, test } from "bun:test";
import { parsePromptSlashCommands } from "./slash-parser";

describe("parsePromptSlashCommands", () => {
  test("parses an unqualified slash at line start", () => {
    const parsed = parsePromptSlashCommands("/plan-skeleton do the thing");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ kind: "unqualified", name: "plan-skeleton", argText: "do the thing" });
  });

  test("parses a scope-qualified global skill /:name", () => {
    const parsed = parsePromptSlashCommands("/:shared-intro");
    expect(parsed[0]).toMatchObject({ kind: "scope-qualified", scope: "", name: "shared-intro" });
  });

  test("parses a scope-qualified projectLocal skill", () => {
    const parsed = parsePromptSlashCommands("/projectLocal:reviewer");
    expect(parsed[0]).toMatchObject({ kind: "scope-qualified", scope: "projectLocal", name: "reviewer" });
  });

  test("parses an MCP server prompt", () => {
    const parsed = parsePromptSlashCommands("/github.create_pr title here");
    expect(parsed[0]).toMatchObject({ kind: "mcp-prompt", server: "github", prompt: "create_pr", argText: "title here" });
  });

  test("ignores mid-line slashes (file paths, fractions)", () => {
    const parsed = parsePromptSlashCommands("see src/foo/bar.ts and 1/2 of the cases");
    expect(parsed).toHaveLength(0);
  });

  test("recognizes a slash after leading whitespace", () => {
    const parsed = parsePromptSlashCommands("   /helper go");
    expect(parsed[0]).toMatchObject({ kind: "unqualified", name: "helper" });
  });

  test("captures multiple commands across lines", () => {
    const parsed = parsePromptSlashCommands("/first\nsome text\n/second arg");
    expect(parsed.map((p) => (p.kind === "unqualified" ? p.name : ""))).toEqual(["first", "second"]);
  });

  test("range covers the whole command token", () => {
    const prompt = "/plan now";
    const [parsed] = parsePromptSlashCommands(prompt);
    expect(prompt.slice(parsed.range[0], parsed.range[1])).toBe("/plan now");
  });
});
