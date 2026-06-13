import {
  assertServerRunnableAgentFlow,
  listAgentServers,
  prepareCanvasRun,
} from "@specflow/server";
import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions, parseDefineArgs, requiredValue } from "../args";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";
import { getServerCanvasOrExplainLocal } from "../../workflows/workflow-resolver";

export interface ParsedRunCommandArgs {
  workflowId: string;
  initialInput: string;
  variableValues: Record<string, string>;
  serverUrl?: string;
}

export async function specflowRunCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { workflowId, initialInput, variableValues, serverUrl } = parseRunCommandArgs(args);

  if (!workflowId) {
    throw new Error(runUsage());
  }

  const connection = await connectOrStartSpecflowServer({ cwd: context.cwd, serverUrl });
  const canvas = await getServerCanvasOrExplainLocal(
    workflowId,
    context.cwd,
    (target) => connection.client.getCanvas(target),
  );
  const prepared = prepareCanvasRun(canvas, { initialInput, variableValues });
  const agentServers = new Map((await listAgentServers(context.cwd)).map((entry) => [entry.id, entry]));
  assertServerRunnableAgentFlow(prepared.doc, agentServers);

  if (prepared.missingVariables.length > 0) {
    throw new Error([
      "Missing required workflow variables:",
      ...prepared.missingVariables.map((variable) => `- ${variable.name}${variable.description ? ` (${variable.description})` : ""}`),
      "Pass declared workflow variables with -Dspecflow_name=value. Use --context only for optional freeform run context.",
    ].join("\n"));
  }

  const run = await connection.client.runCanvas(workflowId, {
    initialInput,
    variableValues,
  });

  context.io.success([
    `Run started: ${run.id}`,
    `Workflow: ${run.workflowId}`,
    `Status: ${run.status}`,
    connection.started ? `Specflow server: ${connection.url} (started by Aflow)` : `Specflow server: ${connection.url}`,
  ].join("\n"));
}

export function parseRunCommandArgs(args: string[]): ParsedRunCommandArgs {
  const { serverUrl, rest: commonRest } = parseCommonCommandOptions(args);
  const { values: variableValues, rest } = parseDefineArgs(commonRest);
  let workflowId = "";
  let initialInput = "";

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--context") {
      initialInput = requiredValue(rest[++index], "--context");
      continue;
    }
    if (argument.startsWith("--context=")) {
      initialInput = argument.slice("--context=".length);
      continue;
    }
    if (argument === "--input") {
      initialInput = requiredValue(rest[++index], "--input");
      continue;
    }
    if (argument.startsWith("--input=")) {
      initialInput = argument.slice("--input=".length);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unexpected argument: ${argument}`);
    if (!workflowId) {
      workflowId = argument;
      continue;
    }
    throw new Error(`Unexpected argument: ${argument}`);
  }

  return { workflowId, initialInput, variableValues, serverUrl };
}

function runUsage(): string {
  return "Usage: /specflow-run <workflow-id> [--context TEXT] [-Dspecflow_name=value] [--server URL]";
}
