import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { buildNativeResumeRecommendation, type NativeResumeStatus } from "@specflow/native-resume";
import type { AgentServerEntry } from "@specflow/bridge";
import type { AgentSessionRecord } from "./agent-session-store";
import type { RunRecord } from "./run-store";

export interface NativeResumeCommandSummary {
  agentSessionId: string;
  workflowId: string;
  latestRunId: string;
  latestInvocationId: string;
  latestStatus: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId: string;
  nodeId?: string;
  nodeTitle?: string;
  nativeResume: {
    available: boolean;
    status: NativeResumeStatus;
    command?: string;
    args?: string[];
    displayCommand?: string;
    commandExists?: boolean;
    agentDisplayName?: string;
    caveat?: string;
    reason?: string;
  };
}

export async function nativeResumeSummaryForSession(input: {
  session: AgentSessionRecord;
  run?: RunRecord;
  agentServers: AgentServerEntry[];
}): Promise<NativeResumeCommandSummary> {
  const { session, run, agentServers } = input;
  const agentServer = agentServers.find((entry) => entry.id === session.agentServerId);
  const recommendation = buildNativeResumeRecommendation({
    agentServer,
    agentServerId: session.agentServerId,
    acpSessionId: session.acpSessionId,
  });
  const latestInvocation = session.invocations.find((invocation) => invocation.invocationId === session.latestInvocationId)
    ?? session.invocations.at(-1);
  const nodeId = latestInvocation?.nodeId;
  const nodeTitle = nodeId
    ? run?.agentflowSnapshot.nodes.find((node) => node.id === nodeId)?.title
    : undefined;

  if (!recommendation) {
    return {
      ...sessionFields(session, nodeId, nodeTitle),
      nativeResume: {
        available: false,
        status: "unknown",
        reason: "Specflow does not have a verified native resume rule for this agent server.",
      },
    };
  }

  if (!recommendation.displayCommand) {
    return {
      ...sessionFields(session, nodeId, nodeTitle),
      nativeResume: {
        available: false,
        status: recommendation.status,
        agentDisplayName: recommendation.adapter.displayName,
        caveat: recommendation.caveat,
        reason: reasonForUnavailable(recommendation.status),
      },
    };
  }

  const exists = await commandExists(recommendation.command);
  return {
    ...sessionFields(session, nodeId, nodeTitle),
    nativeResume: {
      available: true,
      status: recommendation.status,
      command: recommendation.command,
      args: recommendation.args,
      displayCommand: recommendation.displayCommand,
      commandExists: exists,
      agentDisplayName: recommendation.adapter.displayName,
      caveat: recommendation.caveat,
      reason: exists ? undefined : `Native CLI command not found on PATH: ${recommendation.command}`,
    },
  };
}

function sessionFields(session: AgentSessionRecord, nodeId: string | undefined, nodeTitle: string | undefined) {
  return {
    agentSessionId: session.id,
    workflowId: session.workflowId,
    latestRunId: session.latestRunId,
    latestInvocationId: session.latestInvocationId,
    latestStatus: session.latestStatus,
    agentId: session.agentId,
    agentServerId: session.agentServerId,
    specflowSessionId: session.specflowSessionId,
    acpSessionId: session.acpSessionId,
    nodeId,
    nodeTitle,
  };
}

function reasonForUnavailable(status: NativeResumeStatus): string {
  if (status === "acp-only") return "This agent is known to support ACP resume/inspect, but no native CLI resume command is verified.";
  if (status === "custom-unverified") return "This is a custom agent server; Specflow cannot verify its native CLI resume semantics.";
  if (status === "selector") return "This agent is known to offer a native selector, but no direct session-id resume command is verified.";
  if (status === "unsupported") return "This agent is known but does not support a verified native resume command.";
  return "Specflow does not have a verified native resume command for this agent.";
}

async function commandExists(command: string): Promise<boolean> {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
    return canAccess(command);
  }
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    if (await canAccess(join(entry, command))) return true;
  }
  return false;
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
