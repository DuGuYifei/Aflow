import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertServerRunnableAgentFlow,
  listAgentServers,
  loadAgentFlowFile,
  type AgentFlowDoc,
} from "@specflow/server";
import type { DirectCommandContext } from "../direct-dispatch";
import { parseCommonCommandOptions } from "../args";
import { connectOrStartSpecflowServer } from "../../server/connect-or-start";

export async function specflowValidateCommand(args: string[], context: DirectCommandContext): Promise<void> {
  const { serverUrl, rest } = parseCommonCommandOptions(args);
  const target = rest[0];
  if (!target) {
    throw new Error("Usage: /specflow-validate <workflow-id|path/to/workflow.yaml> [--server URL]");
  }
  if (rest.length > 1) throw new Error(`Unexpected argument: ${rest[1]}`);

  const doc = await loadWorkflowForValidation(target, context.cwd, serverUrl);
  const agentServers = new Map((await listAgentServers(context.cwd)).map((entry) => [entry.id, entry]));
  assertServerRunnableAgentFlow(doc, agentServers);

  context.io.success([
    `OK workflow "${doc.id}" (${doc.name})`,
    `${doc.sessions.length} session(s), ${doc.nodes.length} node(s), ${doc.edges.length} edge(s)`,
  ].join("\n"));
}

async function loadWorkflowForValidation(
  target: string,
  cwd: string,
  serverUrl: string | undefined,
): Promise<AgentFlowDoc> {
  const localPath = resolve(cwd, target);
  if (looksLikePath(target) || existsSync(localPath)) {
    return loadAgentFlowFile(localPath);
  }

  const connection = await connectOrStartSpecflowServer({ cwd, serverUrl });
  return connection.client.getCanvas(target);
}

function looksLikePath(value: string): boolean {
  return value.endsWith(".yaml") || value.endsWith(".yml") || value.includes("/") || value.includes("\\");
}
