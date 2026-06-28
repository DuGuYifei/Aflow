import type { ExtensionAPI, ExtensionCommandContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  buildCreateWorkflowPrompt,
  buildContinueWorkflowPrompt,
  buildForkAdaptWorkflowPrompt,
  buildResumeSessionPrompt,
  buildRunWorkflowPrompt,
  buildValidateWorkflowPrompt,
} from "./slash-prompts";
import { registerAflowTools } from "../tools";

const AFLOW_GREEN = "\x1b[38;5;118m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const PANDA = "ʕ•ᴥ•ʔ";
const AFLOW_LOGO_LINES = [
  "▄▀█ █▀▀ █   █▀█ █ █ █",
  "█▀█ █▀  █▄▄ █▄█ ▀▄▀▄▀",
];

export interface AflowPiExtensionOptions {
  specflowUrl?: string;
}

export function createAflowPiExtension(options: AflowPiExtensionOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    registerAflowTools(pi);
    const identityLines = buildAflowIdentityLines(options.specflowUrl);

    pi.registerCommand("specflow-create", {
      description: "Create a Specflow v2 workflow from a business goal",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildCreateWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-fork-adapt", {
      description: "Copy and adapt a Specflow workflow as a local v2 draft",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildForkAdaptWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-validate", {
      description: "Validate a saved workflow or YAML file",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildValidateWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-run", {
      description: "Run a saved workflow and collect required workflow variables",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildRunWorkflowPrompt(args));
      },
    });

    pi.registerCommand("specflow-continue", {
      description: "Continue a stopped or failed Specflow workflow run",
      handler: async (args, ctx) => {
        sendAflowCommandPrompt(pi, ctx, buildContinueWorkflowPrompt(args));
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
      if (ctx.hasUI) {
        ctx.ui.setHeader((_tui, theme) => ({
          render(width: number): string[] {
            if (width < 42) {
              return [
                `${PANDA} ${AFLOW_GREEN}Aflow${RESET}`,
                theme.fg("muted", "Agentic Workflow Agent"),
                ...identityLines,
              ];
            }

            return [
              `   ${PANDA}`,
              `${AFLOW_GREEN}${AFLOW_LOGO_LINES[0]}${RESET}`,
              `${AFLOW_GREEN}${AFLOW_LOGO_LINES[1]}${RESET}`,
              theme.fg("muted", "Agentic Workflow Agent"),
              ...identityLines,
            ];
          },
          invalidate() {},
        }));
      }
    });
  };
}

function buildAflowIdentityLines(specflowUrl: string | undefined): string[] {
  const lines = [
    `${AFLOW_GREEN}Aflow Agent${RESET} is built on Pi.`,
    `${DIM}- You can ask Aflow to create, adapt, validate, run, and continue Specflow workflows.${RESET}`,
    `${DIM}- Pi can explain its own features and look up its docs. Ask it how to use or extend Pi / Aflow.${RESET}`,
  ];

  if (specflowUrl) {
    lines.push(`${DIM}- Specflow UI: ${specflowUrl}${RESET}`);
    lines.push(`${DIM}- Designer: ${new URL("design", specflowUrl).toString()}${RESET}`);
  }

  return lines;
}

function sendAflowCommandPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string): void {
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  ctx.ui.notify("Aflow command sent to the agent.", "info");
}

export type AflowExtensionCommandContext = ExtensionCommandContext;
