import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserTool } from "./ask-user-tool";

describe("ask_user tool", () => {
  test("returns the selected option in choice mode", async () => {
    const tool = captureAskUserTool();
    const result = await tool.execute(
      "tool-1",
      {
        question: "Pick one",
        mode: "choice",
        options: ["alpha", "beta"],
      },
      new AbortController().signal,
      () => undefined,
      uiContext({
        select: async (_question, options) => {
          expect(options).toEqual(["alpha", "beta", "Custom..."]);
          return "beta";
        },
      }),
    );

    expect(result.content[0]?.text).toBe("beta");
    expect(result.details).toEqual({ answer: "beta", source: "option" });
  });

  test("opens a custom text input from the final choice option", async () => {
    const tool = captureAskUserTool();
    const result = await tool.execute(
      "tool-1",
      {
        question: "Pick one",
        mode: "choice",
        options: ["alpha", "Custom..."],
        placeholder: "custom value",
      },
      new AbortController().signal,
      () => undefined,
      uiContext({
        select: async (_question, options) => {
          expect(options).toEqual(["alpha", "Custom...", "Custom... 2"]);
          return "Custom... 2";
        },
        input: async (question, placeholder) => {
          expect(question).toBe("Pick one");
          expect(placeholder).toBe("custom value");
          return "gamma";
        },
      }),
    );

    expect(result.content[0]?.text).toBe("gamma");
    expect(result.details).toEqual({ answer: "gamma", source: "custom" });
  });

  test("rejects more than three explicit choice options when custom input is enabled", async () => {
    const tool = captureAskUserTool();
    const result = await tool.execute(
      "tool-1",
      {
        question: "Pick one",
        mode: "choice",
        options: ["a", "b", "c", "d"],
      },
      new AbortController().signal,
      () => undefined,
      uiContext(),
    );

    expect(result.content[0]?.text).toBe("Choice mode supports at most three explicit options when custom input is enabled.");
    expect(result.details).toEqual({ cancelled: true, optionCount: 4, allowCustom: true });
  });

  test("allows four fixed options when custom input is disabled", async () => {
    const tool = captureAskUserTool();
    const result = await tool.execute(
      "tool-1",
      {
        question: "Pick one",
        mode: "choice",
        options: ["a", "b", "c", "d"],
        allowCustom: false,
      },
      new AbortController().signal,
      () => undefined,
      uiContext({
        select: async (_question, options) => {
          expect(options).toEqual(["a", "b", "c", "d"]);
          return "d";
        },
      }),
    );

    expect(result.content[0]?.text).toBe("d");
    expect(result.details).toEqual({ answer: "d", source: "option" });
  });
});

type AskUserTool = {
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: unknown,
  ): Promise<ToolResult>;
};

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details: Record<string, unknown>;
};

function captureAskUserTool(): AskUserTool {
  let captured: unknown;
  registerAskUserTool({
    registerTool(tool) {
      captured = tool;
    },
  } as ExtensionAPI);
  if (!captured) throw new Error("ask_user tool was not registered.");
  return captured as AskUserTool;
}

function uiContext(overrides: Partial<Ui> = {}) {
  const ui: Ui = {
    input: async () => undefined,
    select: async () => undefined,
    confirm: async () => false,
    notify: () => undefined,
    openCustomView: async () => undefined,
    closeCustomView: async () => undefined,
    ...overrides,
  };
  return {
    cwd: "/tmp",
    hasUI: true,
    ui,
  };
}

type Ui = {
  input(question: string, placeholder?: string): Promise<string | undefined>;
  select(question: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level?: string): void;
  openCustomView(options: unknown): Promise<unknown>;
  closeCustomView(id: string): Promise<void>;
};
