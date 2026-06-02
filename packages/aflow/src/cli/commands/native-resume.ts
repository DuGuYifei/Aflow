import type { AgentServerEntry } from "@specflow/agent-proxy";
import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions } from "../args";
import { commandExists } from "../../native/command-detection";
import { handoffToNativeTerminal } from "../../native/terminal-handoff";
import { buildNativeResumeRecommendation } from "../../native/native-agent-adapters";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";

export async function specflowNativeResumeCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { serverUrl, rest } = parseCommonCommandOptions(args);
  let runId = "";
  let execute = false;
  let nativeSessionId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (argument === "--native-session") {
      nativeSessionId = rest[++index];
      if (!nativeSessionId) throw new Error("--native-session requires a value.");
      continue;
    }
    if (argument.startsWith("--native-session=")) {
      nativeSessionId = argument.slice("--native-session=".length);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unexpected argument: ${argument}`);
    if (!runId) {
      runId = argument;
      continue;
    }
    throw new Error(`Unexpected argument: ${argument}`);
  }

  if (!runId) {
    throw new Error("Usage: /specflow-native-resume <run-id> [--native-session ID] [--execute] [--server URL]");
  }

  const connection = await connectOrStartSpecflowServer({ cwd: context.cwd, serverUrl });
  const resumable = await connection.client.getResumableSession(runId);
  const agentServers = await connection.client.listAgentServers();
  const agentServer = agentServers.find((entry) => entry.id === resumable.agentServerId);
  const recommendation = buildNativeResumeRecommendation({
    agentServer,
    agentServerId: resumable.agentServerId,
    acpSessionId: resumable.acpSessionId,
    nativeSessionId,
  });

  if (!recommendation) {
    context.io.warn([
      "No native resume recommendation is available for this agent.",
      `Agent server: ${resumable.agentServerId}`,
      "Use ACP resume/restore from Aflow, or type the native CLI command manually if you know it.",
    ].join("\n"));
    return;
  }

  if (recommendation.status === "acp-only" || recommendation.status === "unsupported" || recommendation.status === "unknown") {
    context.io.warn(formatRecommendation(recommendation, agentServer));
    return;
  }

  if (!execute) {
    context.io.info([
      formatRecommendation(recommendation, agentServer),
      "",
      "Add --execute to hand off this terminal to the native CLI.",
    ].join("\n"));
    return;
  }

  if (context.nativeTerminalHandoff === false) {
    context.io.warn([
      formatRecommendation(recommendation, agentServer),
      "",
      "Native execution is disabled in the current Pi-backed TUI because Aflow cannot safely suspend Pi's renderer yet.",
      "Run the recommended command manually, or invoke this command from the direct Aflow CLI with --execute.",
    ].join("\n"));
    return;
  }

  if (!(await commandExists(recommendation.command))) {
    throw new Error(`Native CLI command not found on PATH: ${recommendation.command}`);
  }
  await handoffToNativeTerminal(recommendation);
}

function formatRecommendation(
  recommendation: NonNullable<ReturnType<typeof buildNativeResumeRecommendation>>,
  agentServer: AgentServerEntry | undefined,
): string {
  return [
    `Agent: ${displayAgentServer(agentServer, recommendation.adapter.displayName)}`,
    `Native status: ${recommendation.status}`,
    recommendation.displayCommand ? `Recommended command: ${recommendation.displayCommand}` : "Recommended command: unavailable",
    recommendation.caveat ? `Caveat: ${recommendation.caveat}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function displayAgentServer(agentServer: AgentServerEntry | undefined, fallback: string): string {
  if (!agentServer) return fallback;
  if (agentServer.settings.type === "registry") return `${agentServer.id} (${agentServer.settings.registryId})`;
  return agentServer.id;
}
