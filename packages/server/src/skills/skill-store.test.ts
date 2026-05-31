import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SkillStore } from "./skill-store";

async function writeSkill(directory: string, name: string, frontmatter: string, body: string): Promise<void> {
  const skillDir = join(directory, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

describe("SkillStore", () => {
  test("loads skills with frontmatter from global + projectLocal", async () => {
    const globalDir = await mkdtemp(join(tmpdir(), "skills-global-"));
    const projectDir = await mkdtemp(join(tmpdir(), "skills-project-"));
    await writeSkill(globalDir, "intro", "name: intro\ndescription: A global skill", "Global intro body.");
    await writeSkill(projectDir, "reviewer", "name: reviewer\ndescription: Project reviewer", "Review carefully.");

    const store = new SkillStore({ root: "/unused", globalDir, projectDir });
    const skills = await store.list();
    const byName = Object.fromEntries(skills.map((skill) => [skill.name, skill]));
    expect(byName.intro).toMatchObject({ source: "global", description: "A global skill", body: "Global intro body." });
    expect(byName.reviewer).toMatchObject({ source: "projectLocal", body: "Review carefully." });
  });

  test("list returns both scopes on name collision, projectLocal first", async () => {
    const globalDir = await mkdtemp(join(tmpdir(), "skills-global-"));
    const projectDir = await mkdtemp(join(tmpdir(), "skills-project-"));
    await writeSkill(globalDir, "shared", "name: shared", "GLOBAL VERSION");
    await writeSkill(projectDir, "shared", "name: shared", "PROJECT VERSION");

    const store = new SkillStore({ root: "/unused", globalDir, projectDir });
    const skills = await store.list();
    expect(skills).toHaveLength(2);
    // projectLocal sorts ahead of global within the same name so the first
    // match wins for unqualified resolution.
    expect(skills[0]).toMatchObject({ source: "projectLocal", body: "PROJECT VERSION" });
    expect(skills[1]).toMatchObject({ source: "global", body: "GLOBAL VERSION" });
  });

  test("find returns the highest-precedence skill by name", async () => {
    const globalDir = await mkdtemp(join(tmpdir(), "skills-global-"));
    const projectDir = await mkdtemp(join(tmpdir(), "skills-project-"));
    await writeSkill(globalDir, "x", "name: x", "g");
    await writeSkill(projectDir, "x", "name: x", "p");
    const store = new SkillStore({ root: "/unused", globalDir, projectDir });
    expect((await store.find("x"))?.body).toBe("p");
    expect((await store.find("x", { source: "global" }))?.body).toBe("g");
  });

  test("missing directories yield no skills", async () => {
    const store = new SkillStore({ root: "/unused", globalDir: "/nope/global", projectDir: "/nope/project" });
    expect(await store.list()).toEqual([]);
  });

  test("falls back to directory name when frontmatter omits name", async () => {
    const globalDir = await mkdtemp(join(tmpdir(), "skills-global-"));
    const projectDir = await mkdtemp(join(tmpdir(), "skills-project-"));
    await mkdir(join(globalDir, "bare"), { recursive: true });
    await writeFile(join(globalDir, "bare", "SKILL.md"), "Just a body, no frontmatter.\n");
    const store = new SkillStore({ root: "/unused", globalDir, projectDir });
    const skills = await store.list();
    expect(skills[0]).toMatchObject({ name: "bare", body: "Just a body, no frontmatter." });
  });
});
