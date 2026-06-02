import {
  assertServerRunnableAgentFlow,
  listAgentServers,
  prepareCanvasRun,
} from "@specflow/server";
import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions, parseDefineArgs, requiredValue } from "../args";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";
import { getServerCanvasOrExplainLocal } from "../../workflows/workflow-resolver";

export async function specflowRunCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { serverUrl, rest: commonRest } = parseCommonCommandOptions(args);
  const { values, rest } = parseDefineArgs(commonRest);
  let workflowId = "";
  let initialInput = "";

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
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

  if (!workflowId) {
    throw new Error("Usage: /specflow-run <workflow-id> [--input TEXT] [-Dname=value] [--server URL]");
  }

  const connection = await connectOrStartSpecflowServer({ cwd: context.cwd, serverUrl });
  const canvas = await getServerCanvasOrExplainLocal(
    workflowId,
    context.cwd,
    (target) => connection.client.getCanvas(target),
  );
  const prepared = prepareCanvasRun(canvas, { initialInput, variableValues: values });
  const agentServers = new Map((await listAgentServers(context.cwd)).map((entry) => [entry.id, entry]));
  assertServerRunnableAgentFlow(prepared.doc, agentServers);

  if (prepared.missingVariables.length > 0) {
    throw new Error([
      "Missing required variables:",
      ...prepared.missingVariables.map((variable) => `- ${variable.name}${variable.description ? ` (${variable.description})` : ""}`),
      "Pass values with -Dname=value.",
    ].join("\n"));
  }

  const run = await connection.client.runCanvas(workflowId, {
    initialInput,
    variableValues: values,
  });

  context.io.success([
    `Run started: ${run.id}`,
    `Workflow: ${run.workflowId}`,
    `Status: ${run.status}`,
    connection.started ? `Specflow server: ${connection.url} (started by Aflow)` : `Specflow server: ${connection.url}`,
  ].join("\n"));
}
