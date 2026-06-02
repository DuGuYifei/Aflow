import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions } from "../args";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";

export async function specflowResumeCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { serverUrl, rest } = parseCommonCommandOptions(args);
  const runId = rest[0];
  if (!runId) throw new Error("Usage: /specflow-resume <run-id> [--server URL]");
  if (rest.length > 1) throw new Error(`Unexpected argument: ${rest[1]}`);

  const connection = await connectOrStartSpecflowServer({ cwd: context.cwd, serverUrl });
  const run = await connection.client.resumeWorkflowRun(runId);
  context.io.success([
    `Workflow resume started: ${run.id}`,
    `Resumed from: ${run.resumedFromRunId ?? runId}`,
    `Status: ${run.status}`,
  ].join("\n"));
}
