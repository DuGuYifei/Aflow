import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Source of a skill, used to compute precedence when an unqualified
 * `/skill-name` matches more than one definition. `projectLocal` wins over
 * `global`, mirroring Zed's NativeAgent precedence.
 */
export type SkillSource = "global" | "projectLocal";

export interface Skill {
  /** Skill key — matches against `/<name>` in prompts. */
  name: string;
  description: string;
  source: SkillSource;
  /** Absolute path to the SKILL.md the skill was loaded from. */
  filePath: string;
  /** Markdown body with frontmatter stripped — what gets injected. */
  body: string;
}

export interface SkillStoreOptions {
  /** Workspace root used to locate `.agents/skills/` for projectLocal scope. */
  root: string;
  /**
   * Global skills directory. Override for tests. Defaults to
   * `~/.agents/skills/`.
   */
  globalDir?: string;
  /**
   * Project-local skills directory. Override for tests. Defaults to
   * `<root>/.agents/skills/`.
   */
  projectDir?: string;
}

/**
 * Reads SKILL.md files from `~/.agents/skills/<name>/SKILL.md` and
 * `<root>/.agents/skills/<name>/SKILL.md` (the latter wins on name collision).
 *
 * v1 re-scans the directories on every `list()` call; the IO is small in
 * practice and avoiding a watcher keeps the surface tiny. Promote to a
 * cached watcher when this shows up in profiles.
 */
export class SkillStore {
  readonly #globalDir: string;
  readonly #projectDir: string;

  constructor(options: SkillStoreOptions) {
    this.#globalDir = options.globalDir ?? join(homedir(), ".agents", "skills");
    this.#projectDir = options.projectDir ?? join(options.root, ".agents", "skills");
  }

  /**
   * Returns ALL skills from both scopes WITHOUT collapsing name collisions.
   * Keeping both a global and projectLocal entry of the same name is required
   * so scope-qualified lookups (`/:name` vs `/projectLocal:name`) can target a
   * specific scope. Consumers that want the "winning" skill per name (the UI
   * popup, unqualified `/name` resolution) apply precedence via
   * `pickSkillPrecedence`. Sorted by name, then projectLocal before global so
   * the first match in a straight `.find` is already the winner.
   */
  async list(): Promise<Skill[]> {
    const loadedSkills = [
      ...(await loadDir(this.#globalDir, "global")),
      ...(await loadDir(this.#projectDir, "projectLocal")),
    ];
    return loadedSkills.sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return sourcePrecedence(b.source) - sourcePrecedence(a.source);
    });
  }

  async find(name: string, options?: { source?: SkillSource }): Promise<Skill | undefined> {
    const skills = await this.list();
    if (options?.source) return skills.find((skill) => skill.name === name && skill.source === options.source);
    return pickSkillPrecedence(skills.filter((skill) => skill.name === name));
  }
}

/** projectLocal (2) outranks global (1). */
export function sourcePrecedence(source: SkillSource): number {
  return source === "projectLocal" ? 2 : 1;
}

/** Pick the highest-precedence skill from a same-name candidate set. */
export function pickSkillPrecedence(candidates: Skill[]): Skill | undefined {
  return candidates.reduce<Skill | undefined>((best, candidate) => {
    if (!best) return candidate;
    return sourcePrecedence(candidate.source) > sourcePrecedence(best.source) ? candidate : best;
  }, undefined);
}

async function loadDir(directory: string, source: SkillSource): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const skills: Skill[] = [];
  for (const name of entries) {
    const filePath = join(directory, name, "SKILL.md");
    try {
      const info = await stat(filePath);
      if (!info.isFile()) continue;
    } catch {
      // Either the subdir doesn't contain SKILL.md, or `name` is a stray
      // non-directory in `.agents/skills/`. Either way it isn't a skill.
      continue;
    }
    const rawValue = await readFile(filePath, "utf8");
    const parsed = parseSkillFile(rawValue, name, filePath);
    if (parsed) skills.push({ ...parsed, source });
  }
  return skills;
}

/**
 * Strip a `---\n…\n---\n` YAML frontmatter block from the head of a SKILL.md.
 * Returns the parsed frontmatter object and the body that follows. Skills
 * without frontmatter fall back to the directory name + empty description so
 * we still get something useful.
 */
function parseSkillFile(rawValue: string, dirName: string, filePath: string): Omit<Skill, "source"> | undefined {
  const trimmed = rawValue.replace(/^﻿/, "");
  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    // No frontmatter — the directory name is the skill name and the whole
    // file is the body. Lets users start with a one-line SKILL.md.
    return { name: dirName, description: "", body: trimmed.trim(), filePath };
  }
  let front: unknown;
  try {
    front = parseYaml(match[1]);
  } catch {
    return undefined;
  }
  if (!front || typeof front !== "object") return undefined;
  const frontmatter = front as Record<string, unknown>;
  const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : dirName;
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const body = trimmed.slice(match[0].length).trim();
  return { name, description, body, filePath };
}
