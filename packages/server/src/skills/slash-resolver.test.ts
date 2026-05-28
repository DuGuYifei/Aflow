import { describe, expect, test } from "bun:test";
import { resolveSlashCommands } from "./slash-resolver";
import type { Skill } from "./skill-store";

function skill(name: string, source: Skill["source"], body: string): Skill {
  return { name, source, body, description: "", filePath: `/skills/${name}/SKILL.md` };
}

describe("resolveSlashCommands", () => {
  test("injects an unqualified skill body wrapped in XML", () => {
    const result = resolveSlashCommands({
      prompt: "/plan build the feature",
      skills: [skill("plan", "global", "Step 1. Step 2.")],
    });
    expect(result.prompt).toContain('<skill name="plan" source="global">');
    expect(result.prompt).toContain("Step 1. Step 2.");
    expect(result.prompt).toContain("<args>build the feature</args>");
    expect(result.diagnostics[0]).toMatchObject({ kind: "skill-injected" });
  });

  test("projectLocal precedence: caller passes the already-resolved skill list", () => {
    // list() in SkillStore applies precedence; here we simulate the winner.
    const result = resolveSlashCommands({
      prompt: "/review",
      skills: [skill("review", "projectLocal", "project body")],
    });
    expect(result.prompt).toContain("project body");
    expect(result.prompt).toContain('source="projectLocal"');
  });

  test("scope-qualified global only matches a global skill", () => {
    const result = resolveSlashCommands({
      prompt: "/:intro",
      skills: [skill("intro", "projectLocal", "wrong"), skill("intro", "global", "right")],
    });
    expect(result.prompt).toContain("right");
    expect(result.prompt).not.toContain("wrong");
  });

  test("leaves agent commands as passthrough with a diagnostic", () => {
    const result = resolveSlashCommands({
      prompt: "/compact",
      skills: [],
      availableCommands: [{ name: "compact", description: "Compact context" }],
    });
    expect(result.prompt).toBe("/compact");
    expect(result.diagnostics[0]).toMatchObject({ kind: "agent-command-passthrough", commandName: "compact" });
  });

  test("unknown command is left verbatim and flagged unknown", () => {
    const result = resolveSlashCommands({ prompt: "/mystery now", skills: [] });
    expect(result.prompt).toBe("/mystery now");
    expect(result.diagnostics[0]).toMatchObject({ kind: "unknown-passthrough", commandName: "mystery" });
  });

  test("MCP prompt is passthrough in v1", () => {
    const result = resolveSlashCommands({ prompt: "/github.create_pr title", skills: [] });
    expect(result.prompt).toBe("/github.create_pr title");
    expect(result.diagnostics[0]).toMatchObject({ kind: "mcp-prompt-passthrough", server: "github", prompt: "create_pr" });
  });

  test("multiple skills on multiple lines all get injected with offsets intact", () => {
    const result = resolveSlashCommands({
      prompt: "/a\nmiddle\n/b",
      skills: [skill("a", "global", "AAA"), skill("b", "global", "BBB")],
    });
    expect(result.prompt).toContain("AAA");
    expect(result.prompt).toContain("BBB");
    expect(result.prompt).toContain("middle");
    expect(result.diagnostics).toHaveLength(2);
  });

  test("no slash commands → prompt unchanged, no diagnostics", () => {
    const result = resolveSlashCommands({ prompt: "just a normal prompt", skills: [] });
    expect(result.prompt).toBe("just a normal prompt");
    expect(result.diagnostics).toHaveLength(0);
  });
});
