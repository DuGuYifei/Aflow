import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions } from "../args";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";

export async function specflowContinueCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { serverUrl, rest } = parseCommonCommandOptions(args);
  const runId = rest[0];
  if (!runId) throw new Error("Usage: /specflow-continue <run-id> [--server URL]");
  if (rest.length > 1) throw new Error(`Unexpected argument: ${rest[1]}`);

  const connection = await connectOrStartSpecflowServer({ cwd: context.cwd, serverUrl });
  const run = await connection.client.continueWorkflowRun(runId);
  context.io.success([
    `Workflow continuation started: ${run.id}`,
    `Continued from: ${run.resumedFromRunId ?? runId}`,
    `Status: ${run.status}`,
  ].join("\n"));
}
