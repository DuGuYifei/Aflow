import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const AskUserParams = Type.Object({
  question: Type.String({ description: "The question to ask the user." }),
  mode: Type.Optional(Type.Union([
    Type.Literal("text"),
    Type.Literal("choice"),
    Type.Literal("confirm"),
  ], { description: "Question style. Defaults to text unless options are provided." })),
  placeholder: Type.Optional(Type.String({ description: "Placeholder for text input." })),
  options: Type.Optional(Type.Array(Type.String(), { description: "Choice labels for choice mode. Use at most three labels when allowCustom is true, otherwise at most four." })),
  allowCustom: Type.Optional(Type.Boolean({ description: "Allow a final custom text input option in choice mode. Defaults to true, making the fourth displayed option custom input." })),
  customLabel: Type.Optional(Type.String({ description: "Label for the custom input option. Defaults to Custom..." })),
});

export function registerAskUserTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: "Ask the user for missing information through the Aflow TUI. Supports free text, option selection, and yes/no confirmation.",
    promptSnippet: "Ask the user for missing information before continuing a workflow command.",
    promptGuidelines: [
      "Use ask_user when a /specflow-* command lacks required information.",
      "Use choice mode with options when the user needs to pick one known value.",
      "By default, provide at most three explicit choice options; Aflow appends the fourth custom-input option.",
      "Do not guess workflow ids, run ids, required workflow variables, or business facts when they are absent.",
    ],
    parameters: AskUserParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return textResult("UI is not available; ask the user in chat instead.", { cancelled: true });
      }

      const mode = params.mode ?? (params.options?.length ? "choice" : "text");
      if (mode === "confirm") {
        const accepted = await ctx.ui.confirm("Aflow", params.question);
        return textResult(accepted ? "yes" : "no", { answer: accepted ? "yes" : "no", accepted });
      }

      if (mode === "choice") {
        const options = params.options?.filter((option) => option.trim()) ?? [];
        const allowCustom = params.allowCustom ?? true;
        const maxExplicitOptions = allowCustom ? 3 : 4;
        if (options.length === 0) {
          return textResult("Choice mode requires at least one option.", { cancelled: true });
        }
        if (options.length > maxExplicitOptions) {
          return textResult(
            allowCustom
              ? "Choice mode supports at most three explicit options when custom input is enabled."
              : "Choice mode supports at most four options.",
            { cancelled: true, optionCount: options.length, allowCustom },
          );
        }
        const customLabel = uniqueCustomLabel(params.customLabel?.trim() || "Custom...", options);
        const answer = await ctx.ui.select(params.question, allowCustom ? [...options, customLabel] : options);
        if (answer === customLabel && allowCustom) {
          const customAnswer = await ctx.ui.input(params.question, params.placeholder);
          return customAnswer === undefined
            ? textResult("User cancelled.", { cancelled: true })
            : textResult(customAnswer, { answer: customAnswer, source: "custom" });
        }
        return answer === undefined
          ? textResult("User cancelled.", { cancelled: true })
          : textResult(answer, { answer, source: "option" });
      }

      const answer = await ctx.ui.input(params.question, params.placeholder);
      return answer === undefined
        ? textResult("User cancelled.", { cancelled: true })
        : textResult(answer, { answer });
    },
  });
}

function uniqueCustomLabel(preferred: string, options: string[]): string {
  if (!options.includes(preferred)) return preferred;
  let suffix = 2;
  while (options.includes(`${preferred} ${suffix}`)) suffix += 1;
  return `${preferred} ${suffix}`;
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}
