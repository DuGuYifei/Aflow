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
  options: Type.Optional(Type.Array(Type.String(), { description: "Choice labels for choice mode." })),
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
      "Do not guess workflow ids, run ids, or business inputs when they are absent.",
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
        if (options.length === 0) {
          return textResult("Choice mode requires at least one option.", { cancelled: true });
        }
        const answer = await ctx.ui.select(params.question, options);
        return answer === undefined
          ? textResult("User cancelled.", { cancelled: true })
          : textResult(answer, { answer });
      }

      const answer = await ctx.ui.input(params.question, params.placeholder);
      return answer === undefined
        ? textResult("User cancelled.", { cancelled: true })
        : textResult(answer, { answer });
    },
  });
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}
