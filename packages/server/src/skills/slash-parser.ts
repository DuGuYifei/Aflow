/**
 * Parses slash commands embedded in a prompt body. Modeled after Zed's
 * NativeAgentConnection::prompt grammar (`crates/agent/src/agent.rs`):
 *
 *   /:<name>            scope-qualified skill (global)
 *   /<scope>:<name>     scope-qualified skill (any other scope)
 *   /<server>.<prompt>  MCP server prompt (v1 unresolved → passthrough)
 *   /<name>             unqualified — skill if known, else passthrough
 *
 * Slash commands are only recognized at the start of the line (or after pure
 * whitespace), matching how UIs like Zed/Claude Code highlight them. We do
 * NOT match `/foo` embedded mid-sentence — that's almost always file paths
 * or fractions, not commands.
 */

export type ParsedSlash =
  | {
      kind: "scope-qualified";
      scope: string; // empty string for `/:<name>` (means "global")
      name: string;
      argText: string;
      /** Inclusive start, exclusive end offsets in the source prompt. */
      range: [number, number];
      raw: string;
    }
  | {
      kind: "mcp-prompt";
      server: string;
      prompt: string;
      argText: string;
      range: [number, number];
      raw: string;
    }
  | {
      kind: "unqualified";
      name: string;
      argText: string;
      range: [number, number];
      raw: string;
    };

const NAME_CHARS = /[a-z0-9_-]/i;

/**
 * Walks the prompt and emits every recognized slash command. Mid-word `/` is
 * skipped on purpose: the regex anchors on line start (with optional leading
 * whitespace). Args go to end-of-line — a skill or command on its own line
 * gets the rest of the line as its argText, similar to MCP prompt arguments.
 */
export function parsePromptSlashCommands(prompt: string): ParsedSlash[] {
  const output: ParsedSlash[] = [];
  // Iterate by index so we can capture absolute offsets and skip ahead.
  let index = 0;
  while (index < prompt.length) {
    // Find the next `/` that starts a line (or follows only spaces/tabs).
    const lineStart = findLineStart(prompt, index);
    if (lineStart === -1) break;
    const slashIdx = skipHorizontalWhitespace(prompt, lineStart);
    if (slashIdx >= prompt.length || prompt[slashIdx] !== "/") {
      // No slash at the start of this line; advance to the next line.
      index = nextLineStart(prompt, lineStart);
      continue;
    }
    const parsed = parseSingle(prompt, slashIdx);
    if (parsed) {
      output.push(parsed);
      index = parsed.range[1];
    } else {
      index = nextLineStart(prompt, lineStart);
    }
  }
  return output;
}

function parseSingle(prompt: string, startIdx: number): ParsedSlash | undefined {
  // We're sitting on `/`. Scan forward through:
  //   identifier chars, optional `:` or `.` to separate scope/server, then
  //   identifier chars again, then optional whitespace + arg-to-end-of-line.
  let cursor = startIdx + 1; // skip the `/`
  const firstStart = cursor;
  while (cursor < prompt.length && (NAME_CHARS.test(prompt[cursor]) || prompt[cursor] === ":")) {
    cursor++;
  }
  const firstPart = prompt.slice(firstStart, cursor);
  let kind: "scope-qualified" | "mcp-prompt" | "unqualified" = "unqualified";
  let scope = "";
  let server = "";
  let promptName = firstPart;
  let name = firstPart;

  if (firstPart.includes(":")) {
    // `/:<name>` or `/<scope>:<name>` — colon is the boundary. Use rsplit so
    // scope labels themselves can contain colons (matching Zed semantics).
    const lastColon = firstPart.lastIndexOf(":");
    scope = firstPart.slice(0, lastColon);
    name = firstPart.slice(lastColon + 1);
    if (!name) return undefined;
    kind = "scope-qualified";
  } else if (cursor < prompt.length && prompt[cursor] === ".") {
    // `/<server>.<prompt>` — extend the parse to grab the prompt name.
    cursor++;
    const promptStart = cursor;
    while (cursor < prompt.length && NAME_CHARS.test(prompt[cursor])) cursor++;
    if (cursor === promptStart) return undefined;
    server = firstPart;
    promptName = prompt.slice(promptStart, cursor);
    kind = "mcp-prompt";
  } else if (!firstPart) {
    return undefined;
  }

  // Arg = remainder of the line (after one optional separating space).
  const afterName = cursor;
  const lineEnd = findLineEnd(prompt, afterName);
  const argText = prompt.slice(afterName, lineEnd).trim();
  const range: [number, number] = [startIdx, lineEnd];
  const rawValue = prompt.slice(startIdx, lineEnd);

  if (kind === "scope-qualified") {
    return { kind, scope, name, argText, range, raw: rawValue };
  }
  if (kind === "mcp-prompt") {
    return { kind, server, prompt: promptName, argText, range, raw: rawValue };
  }
  return { kind, name, argText, range, raw: rawValue };
}

function findLineStart(text: string, from: number): number {
  if (from === 0) return 0;
  // Already at a line start?
  if (text[from - 1] === "\n" || from >= text.length) return from < text.length ? from : -1;
  // Otherwise find the next newline and continue past it.
  const newline = text.indexOf("\n", from);
  if (newline === -1) return -1;
  return newline + 1 < text.length ? newline + 1 : -1;
}

function nextLineStart(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline === -1 ? text.length : newline + 1;
}

function skipHorizontalWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) index++;
  return index;
}

function findLineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline === -1 ? text.length : newline;
}
