import type { ExtensionAPI, ExtensionCommandContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  buildCreateWorkflowPrompt,
  buildForkAdaptWorkflowPrompt,
  buildResumeSessionPrompt,
  buildResumeWorkflowPrompt,
  buildRunWorkflowPrompt,
  buildValidateWorkflowPrompt,
} from "./slash-prompts";
import { registerAflowTools } from "../tools";

const AFLOW_GREEN = "\x1b[38;5;118m";
const RESET = "\x1b[0m";

export function createAflowPiExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    registerAflowTools(pi);

    pi.registerCommand("specflow-create", {
      description: "Draft a Specflow workflow from a business goal",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildCreateWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-fork-adapt", {
      description: "Adapt an existing Specflow workflow for a new problem",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildForkAdaptWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-validate", {
      description: "Validate a workflow file or saved workflow",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildValidateWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-run", {
      description: "Run a saved workflow through the Specflow server",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildRunWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-resume", {
      description: "Resume a cancelled or failed Specflow workflow run",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildResumeWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-resume-session", {
      description: "Resume or inspect a recorded agent session from a run",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildResumeSessionPrompt(args));
      },
    });

    pi.on("session_start", (_event, ctx) => {
      ctx.ui.setTitle("Aflow");
      ctx.ui.setStatus("aflow", `${AFLOW_GREEN}Aflow${RESET}`);
      ctx.ui.setWidget("aflow.identity", [`${AFLOW_GREEN}Aflow${RESET}`], { placement: "aboveEditor" });
    });
  };
}

function sendAflowCommandPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string): void {
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  ctx.ui.notify("Aflow command sent to the agent.", "info");
}

export type AflowExtensionCommandContext = ExtensionCommandContext;
