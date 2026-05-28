import type { AgentAvailableCommand } from "@specflow/agent-proxy";
import { parsePromptSlashCommands, type ParsedSlash } from "./slash-parser";
import { pickSkillPrecedence, type Skill } from "./skill-store";

export interface SlashResolveInput {
  prompt: string;
  /** All skills currently visible to the user (already with projectLocal/global precedence applied). */
  skills: Skill[];
  /** Agent-advertised commands for the agent this prompt will run against, used for `unresolved` warnings only. */
  availableCommands?: AgentAvailableCommand[];
}

export interface SlashResolveOutput {
  /** The prompt with every recognized skill `/foo` replaced by an XML-wrapped body. Unresolved slashes are left untouched. */
  prompt: string;
  /** What we did with each slash command we saw; useful for diagnostics + UI underlining. */
  diagnostics: SlashDiagnostic[];
}

export type SlashDiagnostic =
  | { kind: "skill-injected"; raw: string; range: [number, number]; skill: Pick<Skill, "name" | "source" | "filePath"> }
  | { kind: "mcp-prompt-passthrough"; raw: string; range: [number, number]; server: string; prompt: string }
  | { kind: "agent-command-passthrough"; raw: string; range: [number, number]; commandName: string }
  | { kind: "unknown-passthrough"; raw: string; range: [number, number]; commandName: string };

/**
 * Apply the three-branch slash command dispatch described in the plan:
 *   1. Scope-qualified `/:<name>` or `/<scope>:<name>` → skill body injection.
 *   2. MCP prompt `/<server>.<prompt>` → unresolved in v1; left in the prompt.
 *   3. Unqualified `/<name>` → skill body injection if a skill matches,
 *      else passthrough so the agent gets to handle its own `available_commands`.
 *
 * The unresolved variants come back as diagnostics so callers can decide
 * whether to show a UI warning ("not in this agent's available_commands").
 */
export function resolveSlashCommands(input: SlashResolveInput): SlashResolveOutput {
  const slashes = parsePromptSlashCommands(input.prompt);
  if (slashes.length === 0) {
    return { prompt: input.prompt, diagnostics: [] };
  }

  const diagnostics: SlashDiagnostic[] = [];
  const availableCommandNames = new Set((input.availableCommands ?? []).map((c) => c.name));
  // We replace from the END so earlier offsets remain valid as we splice.
  const sorted = [...slashes].sort((a, b) => b.range[0] - a.range[0]);
  let result = input.prompt;

  for (const slash of sorted) {
    const resolution = resolveOne(slash, input.skills, availableCommandNames);
    diagnostics.push(resolution.diagnostic);
    if (resolution.replacement !== undefined) {
      result = result.slice(0, slash.range[0]) + resolution.replacement + result.slice(slash.range[1]);
    }
  }

  // Restore source order so callers iterating diagnostics see them top-to-bottom.
  diagnostics.reverse();
  return { prompt: result, diagnostics };
}

interface ResolutionResult {
  /** New text to splice in for `slash.range`. `undefined` means leave the original substring alone. */
  replacement?: string;
  diagnostic: SlashDiagnostic;
}

function resolveOne(slash: ParsedSlash, skills: Skill[], availableCommands: Set<string>): ResolutionResult {
  if (slash.kind === "scope-qualified") {
    const skill = skills.find((s) => s.name === slash.name && matchesScope(s.source, slash.scope));
    if (skill) {
      return {
        replacement: wrapSkill(skill, slash.argText),
        diagnostic: { kind: "skill-injected", raw: slash.raw, range: slash.range, skill: { name: skill.name, source: skill.source, filePath: skill.filePath } },
      };
    }
    return {
      diagnostic: { kind: "unknown-passthrough", raw: slash.raw, range: slash.range, commandName: `${slash.scope}:${slash.name}` },
    };
  }
  if (slash.kind === "mcp-prompt") {
    // v1: we don't connect to MCP servers from the proxy, so MCP prompts are
    // passthrough. The diagnostic still names server + prompt so callers can
    // surface a "MCP prompts not yet supported" UI warning.
    return {
      diagnostic: { kind: "mcp-prompt-passthrough", raw: slash.raw, range: slash.range, server: slash.server, prompt: slash.prompt },
    };
  }
  // Unqualified: try skills first; otherwise check the agent's advertised commands.
  // Apply precedence explicitly since `skills` may contain both a global and a
  // projectLocal entry with the same name.
  const skill = pickSkillPrecedence(skills.filter((s) => s.name === slash.name));
  if (skill) {
    return {
      replacement: wrapSkill(skill, slash.argText),
      diagnostic: { kind: "skill-injected", raw: slash.raw, range: slash.range, skill: { name: skill.name, source: skill.source, filePath: skill.filePath } },
    };
  }
  if (availableCommands.has(slash.name)) {
    return {
      diagnostic: { kind: "agent-command-passthrough", raw: slash.raw, range: slash.range, commandName: slash.name },
    };
  }
  return {
    diagnostic: { kind: "unknown-passthrough", raw: slash.raw, range: slash.range, commandName: slash.name },
  };
}

function matchesScope(source: Skill["source"], typedScope: string): boolean {
  if (typedScope === "") return source === "global"; // `/:<name>` means global
  // For now `projectLocal` is the only non-global scope. Use a literal name so
  // users can type `/projectLocal:<name>`. Future worktree-scoped skills will
  // need an explicit scope label here.
  return typedScope === source;
}

function wrapSkill(skill: Skill, argText: string): string {
  const body = skill.body.trim();
  const args = argText ? `\n<args>${argText}</args>\n` : "";
  return `<skill name="${escapeAttr(skill.name)}" source="${skill.source}">\n${body}${args}\n</skill>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
