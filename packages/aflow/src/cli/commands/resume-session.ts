import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions } from "../args";
import { resumeAgentSessionForRun } from "../../resume/session-resume";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";

export async function specflowResumeSessionCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { serverUrl, rest } = parseCommonCommandOptions(args);
  const runId = rest[0];
  if (!runId) throw new Error("Usage: /specflow-resume-session <run-id> [--server URL]");
  if (rest.length > 1) throw new Error(`Unexpected argument: ${rest[1]}`);

  const connection = await connectOrStartSpecflowServer({ cwd: context.cwd, serverUrl });
  const result = await resumeAgentSessionForRun({
    client: connection.client,
    runId,
    hasUI: false,
  });
  context.io.info(result.text);
}
