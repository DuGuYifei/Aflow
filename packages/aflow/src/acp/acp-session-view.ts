import type {
  AgentRestoreMode,
  AgentSessionRecord,
  PausedNodeSession,
  RestoreStreamEvent,
  RunInteraction,
  SpecflowClient,
} from "../server/specflow-client";
import { RESTORE_SSE_EVENTS } from "@specflow/shared";
import type { ConversationSnippet, NodeDisplayInfo } from "./session-summary";
import { latestInvocation } from "./session-summary";

export interface OpenAcpSessionViewOptions {
  client: SpecflowClient;
  ui: AflowCustomUi;
  session: AgentSessionRecord;
  mode: AgentRestoreMode;
  node?: NodeDisplayInfo;
  snippets: ConversationSnippet[];
}

export interface OpenPausedNodeAcpViewOptions {
  client: SpecflowClient;
  ui: AflowCustomUi;
  paused: PausedNodeSession;
  node?: NodeDisplayInfo;
  snippets: ConversationSnippet[];
  continueOptions?: { play?: boolean; pauseAfterNextActivation?: boolean };
}

export interface AflowCustomUi {
  notify(message: string, type?: "info" | "warning" | "error"): void;
  select(title: string, options: string[]): Promise<string | undefined>;
  custom<T>(
    factory: (
      tui: { requestRender(force?: boolean): void },
      theme: ThemeLike,
      keybindings: unknown,
      done: (result: T) => void,
    ) => { render(width: number): string[]; invalidate(): void; handleInput?(data: string): void; dispose?(): void },
  ): Promise<T>;
}

interface ThemeLike {
  fg?(name: string, text: string): string;
  bg?(name: string, text: string): string;
  bold?(text: string): string;
}

interface AcpSessionViewResult {
  restoreId: string;
  closed: boolean;
}

type TranscriptRole = "user" | "assistant" | "system";

interface TranscriptLine {
  role: TranscriptRole;
  text: string;
}

export async function openAcpSessionView(options: OpenAcpSessionViewOptions): Promise<AcpSessionViewResult> {
  const restore = await options.client.restoreAgentSession(options.session.id, options.mode);
  return options.ui.custom<AcpSessionViewResult>((tui, theme, _keybindings, done) => {
    const abortController = new AbortController();
    const transcript = seedTranscript(options.snippets);
    const pendingInteractions: RunInteraction[] = [];
    let status = "restoring";
    let selectedPrimitive = "";
    let draft = "";
    let sending = false;
    let closed = false;
    let streamEnded = false;
    let scroll = 0;

    const refresh = () => tui.requestRender(true);
    const append = (role: TranscriptRole, text: string) => {
      if (!text) return;
      const previous = transcript.at(-1);
      if (previous && previous.role === role && role === "assistant") {
        previous.text += text;
      } else {
        transcript.push({ role, text });
      }
    };

    const finish = async () => {
      if (closed) return;
      closed = true;
      abortController.abort();
      if (options.mode === "continue") {
        await options.client.closeRestoredSession(restore.restoreId).catch(() => undefined);
      }
      done({ restoreId: restore.restoreId, closed: true });
    };

    const resolveInteraction = async (interaction: RunInteraction, resolution: unknown) => {
      pendingInteractions.splice(pendingInteractions.indexOf(interaction), 1);
      append("system", `Resolved ${interaction.kind} interaction.`);
      refresh();
      try {
        await options.client.respondRunInteraction(interaction.runId, interaction.id, resolution);
      } catch (error) {
        append("system", `Interaction failed: ${errorMessage(error)}`);
      }
      refresh();
    };

    const submitPrompt = async () => {
      const prompt = draft.trim();
      if (!prompt || sending || status !== "ready") return;
      draft = "";
      sending = true;
      append("user", prompt);
      refresh();
      try {
        const before = transcript.at(-1);
        const result = await options.client.promptRestoredSession(restore.restoreId, prompt);
        if (result.output.trim() && before === transcript.at(-1)) {
          append("assistant", result.output);
        }
      } catch (error) {
        append("system", `Prompt failed: ${errorMessage(error)}`);
      } finally {
        sending = false;
        refresh();
      }
    };

    const handleRestoreEvent = (event: RestoreStreamEvent) => {
      if (event.type === "error") {
        status = "error";
        append("system", event.error);
      } else if (event.type === RESTORE_SSE_EVENTS.restoreStatus) {
        if (event.status === "success") {
          selectedPrimitive = event.selectedPrimitive ? ` via ${event.selectedPrimitive}` : "";
          status = event.requestedMode === "continue" ? "ready" : "inspected";
          append("system", `ACP session restored${selectedPrimitive}.`);
        } else if (event.status === "failure") {
          status = "error";
          append("system", `Restore failed: ${event.error ?? "unknown error"}`);
        } else {
          status = "restoring";
        }
      } else if (event.type === RESTORE_SSE_EVENTS.terminal) {
        append("system", event.chunk);
      } else if (event.type === RESTORE_SSE_EVENTS.sessionUpdate) {
        const text = agentMessageChunkText(event.update);
        if (text) append("assistant", text);
      } else if (event.type === RESTORE_SSE_EVENTS.interactionRequested) {
        if (!pendingInteractions.some((candidate) => candidate.id === event.interaction.id)) {
          pendingInteractions.push(event.interaction);
          append("system", `${event.interaction.kind} interaction requested.`);
        }
      }
      refresh();
    };

    void options.client.streamRestoreEvents(restore.restoreId, handleRestoreEvent, {
      signal: abortController.signal,
    }).then(() => {
      streamEnded = true;
      refresh();
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        status = "error";
        append("system", `Restore event stream failed: ${errorMessage(error)}`);
        refresh();
      }
    });

    const component = {
      render(width: number): string[] {
        const lines: string[] = [];
        const add = (text = "") => lines.push(truncate(text, width));
        const nodeTitle = options.node?.title ?? latestInvocation(options.session)?.nodeId ?? "Agent session";
        const title = `Aflow ACP · ${nodeTitle}`;
        add(style(theme, "accent", title));
        add(`Run: ${options.session.latestRunId} · Workflow: ${options.session.workflowId}`);
        add(`Agent: ${options.session.agentServerId} · ACP: ${options.session.acpSessionId}`);
        add(`Mode: ${options.mode} · Status: ${status}${selectedPrimitive}`);
        add(rule(width));

        const pending = pendingInteractions[0];
        if (pending) {
          renderInteraction(lines, width, pending, theme);
          add(rule(width));
        }

        const body = renderTranscript(transcript, Math.max(24, width), Math.max(8, terminalBodyHeight(width)));
        const visibleBody = scroll > 0 ? body.slice(Math.max(0, body.length - terminalBodyHeight(width) - scroll), body.length - scroll) : body.slice(-terminalBodyHeight(width));
        for (const line of visibleBody) add(line);
        add(rule(width));

        if (options.mode === "inspect") {
          add(streamEnded ? "Esc: return to Aflow" : "Inspecting session... Esc: return to Aflow");
        } else if (pending) {
          add("Resolve the pending interaction above before sending another prompt.");
        } else if (status !== "ready") {
          add("Restoring ACP session... Esc: return to Aflow");
        } else {
          add(`${sending ? "Sending..." : "Prompt"}: ${draft || style(theme, "dim", "(type and press Enter)")}`);
          add("Enter: send · Esc/Shift+Esc: return · Ctrl+U: clear · PgUp/PgDn: scroll");
        }
        return lines;
      },
      invalidate() {
        refresh();
      },
      handleInput(data: string) {
        if (isEscape(data)) {
          void finish();
          return;
        }
        if (data === "\x15") {
          draft = "";
          refresh();
          return;
        }
        if (data === "\x1b[5~") {
          scroll += 8;
          refresh();
          return;
        }
        if (data === "\x1b[6~") {
          scroll = Math.max(0, scroll - 8);
          refresh();
          return;
        }

        const pending = pendingInteractions[0];
        if (pending) {
          handleInteractionInput(data, pending, resolveInteraction);
          return;
        }

        if (options.mode !== "continue" || status !== "ready" || sending) return;
        if (data === "\r" || data === "\n") {
          void submitPrompt();
          return;
        }
        if (data === "\x7f" || data === "\b") {
          draft = draft.slice(0, -1);
          refresh();
          return;
        }
        if (isPrintable(data)) {
          draft += data;
          scroll = 0;
          refresh();
        }
      },
      dispose() {
        abortController.abort();
        if (!closed && options.mode === "continue") {
          void options.client.closeRestoredSession(restore.restoreId).catch(() => undefined);
        }
      },
    };

    return component;
  });
}

export async function openPausedNodeAcpView(options: OpenPausedNodeAcpViewOptions): Promise<{ continued: boolean }> {
  return options.ui.custom<{ continued: boolean }>((tui, theme, _keybindings, done) => {
    const transcript = seedTranscript(options.snippets);
    let draft = "";
    let sending = false;
    let closed = false;
    let scroll = 0;

    const refresh = () => tui.requestRender(true);
    const append = (role: TranscriptRole, text: string) => {
      if (!text) return;
      const previous = transcript.at(-1);
      if (previous && previous.role === role && role === "assistant") {
        previous.text += text;
      } else {
        transcript.push({ role, text });
      }
    };

    const finish = (continued: boolean) => {
      if (closed) return;
      closed = true;
      done({ continued });
    };

    const sendPrompt = async () => {
      const prompt = draft.trim();
      if (!prompt || sending) return;
      draft = "";
      sending = true;
      append("user", prompt);
      refresh();
      try {
        const result = await options.client.promptPausedNode(options.paused.runId, options.paused.nodeId, prompt);
        append("assistant", result.output || "(no output)");
      } catch (error) {
        append("system", `Prompt failed: ${errorMessage(error)}`);
      } finally {
        sending = false;
        refresh();
      }
    };

    const continueWorkflow = async () => {
      if (sending) return;
      sending = true;
      append("system", "Continuing workflow...");
      refresh();
      try {
        await options.client.continuePausedNode(options.paused.runId, options.paused.nodeId, options.continueOptions);
        finish(true);
      } catch (error) {
        sending = false;
        append("system", `Continue failed: ${errorMessage(error)}`);
        refresh();
      }
    };

    return {
      render(width: number): string[] {
        const lines: string[] = [];
        const add = (text = "") => lines.push(truncate(text, width));
        const nodeTitle = options.node?.title ?? options.paused.nodeId;
        add(style(theme, "accent", `Aflow ACP Pause · ${nodeTitle}`));
        add(`Run: ${options.paused.runId} · Node: ${options.paused.nodeId}`);
        add(`Agent: ${options.paused.agentServerId} · Specflow session: ${options.paused.specflowSessionId}`);
        add("This workflow is paused. Talk to the active ACP session, then continue the workflow.");
        add(rule(width));

        const body = renderTranscript(transcript, Math.max(24, width), Math.max(8, terminalBodyHeight(width)));
        const visibleBody = scroll > 0 ? body.slice(Math.max(0, body.length - terminalBodyHeight(width) - scroll), body.length - scroll) : body.slice(-terminalBodyHeight(width));
        for (const line of visibleBody) add(line);
        add(rule(width));

        add(`${sending ? "Working..." : "Prompt"}: ${draft || style(theme, "dim", "(type, /continue, or Esc)")}`);
        add("Enter: send · /continue: continue workflow · Esc/Shift+Esc: leave paused · Ctrl+U: clear · PgUp/PgDn: scroll");
        return lines;
      },
      invalidate() {
        refresh();
      },
      handleInput(data: string) {
        if (isEscape(data)) {
          finish(false);
          return;
        }
        if (data === "\x15") {
          draft = "";
          refresh();
          return;
        }
        if (data === "\x1b[5~") {
          scroll += 8;
          refresh();
          return;
        }
        if (data === "\x1b[6~") {
          scroll = Math.max(0, scroll - 8);
          refresh();
          return;
        }
        if (data === "\r" || data === "\n") {
          if (draft.trim() === "/continue") {
            void continueWorkflow();
          } else {
            void sendPrompt();
          }
          return;
        }
        if (data === "\x7f" || data === "\b") {
          draft = draft.slice(0, -1);
          refresh();
          return;
        }
        if (isPrintable(data)) {
          draft += data;
          scroll = 0;
          refresh();
        }
      },
    };
  });
}

function seedTranscript(snippets: ConversationSnippet[]): TranscriptLine[] {
  if (snippets.length === 0) {
    return [{ role: "system", text: "No recent run log context was found for this ACP session." }];
  }
  return snippets.flatMap((snippet) => [
    { role: "user" as const, text: snippet.user },
    { role: "assistant" as const, text: snippet.assistant || "(assistant output unavailable)" },
  ]);
}

function renderTranscript(transcript: TranscriptLine[], width: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const entry of transcript) {
    const prefix = entry.role === "user" ? "You" : entry.role === "assistant" ? "Agent" : "Aflow";
    const wrapped = wrap(entry.text.trimEnd() || "(empty)", Math.max(12, width - prefix.length - 3));
    for (let index = 0; index < wrapped.length; index += 1) {
      lines.push(index === 0 ? `${prefix}: ${wrapped[index]}` : `${" ".repeat(prefix.length + 2)}${wrapped[index]}`);
    }
  }
  return lines.slice(-Math.max(1, maxLines * 2));
}

function renderInteraction(lines: string[], width: number, interaction: RunInteraction, theme: ThemeLike): void {
  const add = (text: string) => lines.push(truncate(text, width));
  add(style(theme, "warning", `${interaction.kind.toUpperCase()} interaction pending`));
  if (interaction.kind === "permission") {
    add(`Tool call: ${summarizeUnknown(interaction.toolCall)}`);
    const options = interaction.options ?? [];
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      add(`${index + 1}. ${option.name ?? option.optionId}`);
    }
    add("Press option number, or x to cancel.");
    return;
  }
  add(`Request: ${summarizeUnknown(interaction.request)}`);
  add("Press a to accept empty content, d to decline, or x to cancel.");
}

function handleInteractionInput(
  data: string,
  interaction: RunInteraction,
  resolve: (interaction: RunInteraction, resolution: unknown) => Promise<void>,
): void {
  if (interaction.kind === "permission") {
    if (data.toLowerCase() === "x") {
      void resolve(interaction, { outcome: "cancelled" });
      return;
    }
    const index = Number(data) - 1;
    const option = interaction.options?.[index];
    if (option) {
      void resolve(interaction, { outcome: "selected", optionId: option.optionId });
    }
    return;
  }

  const key = data.toLowerCase();
  if (key === "a") {
    void resolve(interaction, { action: "accept", content: {} });
  } else if (key === "d") {
    void resolve(interaction, { action: "decline" });
  } else if (key === "x" || key === "c") {
    void resolve(interaction, { action: "cancel" });
  }
}

function agentMessageChunkText(update: unknown): string | undefined {
  if (!update || typeof update !== "object") return undefined;
  const value = update as {
    sessionUpdate?: unknown;
    content?: { type?: unknown; text?: unknown };
  };
  if (value.sessionUpdate !== "agent_message_chunk") return undefined;
  if (value.content?.type !== "text" || typeof value.content.text !== "string") return undefined;
  return value.content.text;
}

function terminalBodyHeight(width: number): number {
  return width < 80 ? 12 : 18;
}

function wrap(text: string, width: number): string[] {
  const normalized = text.replace(/\r/g, "");
  const lines: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    let line = rawLine;
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
    lines.push(line);
  }
  return lines;
}

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + "…";
}

function rule(width: number): string {
  return "─".repeat(Math.max(0, Math.min(width, 120)));
}

function style(theme: ThemeLike, name: string, text: string): string {
  return theme.fg?.(name, text) ?? text;
}

function isEscape(data: string): boolean {
  return data === "\x1b" || data === "\x1b[27;2;27~";
}

function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

function summarizeUnknown(value: unknown): string {
  if (value === undefined || value === null) return "(none)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
