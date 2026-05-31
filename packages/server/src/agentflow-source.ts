import { parse, stringify } from "yaml";
import type {
  AgentFlowDoc,
  AgentFlowNode,
  CanvasBranch,
  CanvasEdge,
  CanvasSession,
  CanvasVariable,
} from "./canvas-doc";
import {
  assertSymbolKey,
  assertValidAgentFlowDraft,
  edgeIdFromReferences,
  normalizeAgentFlowDraft,
} from "./agentflow-validation";

export { assertSymbolKey, edgeIdFromReferences } from "./agentflow-validation";

export const AGENTFLOW_SOURCE_VERSION = 1;
const SYMBOL_KEY = /^[a-z][a-z0-9-]*$/;

export function parseAgentFlowSource(raw: string, workflowId: string): AgentFlowDoc {
  assertSymbolKey(workflowId, "workflow filename");
  const source = asRecord(parse(raw), "agentflow");
  if (source.version !== AGENTFLOW_SOURCE_VERSION) {
    throw new Error(`Agentflow "${workflowId}" must declare version: ${AGENTFLOW_SOURCE_VERSION}.`);
  }

  const sessions = parseSessions(asRecord(source.sessions, "sessions"));
  const nodes = parseNodes(asRecord(source.nodes, "nodes"));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = parseEdges(source.edges, nodes, nodeIds);

  const doc = normalizeAgentFlowDraft({
    id: workflowId,
    name: optionalString(source.name) ?? "",
    sessions,
    nodes,
    edges,
    variables: parseVariables(source.variables),
  });
  assertValidAgentFlowDraft(doc);
  return doc;
}

export function stringifyAgentFlowSource(doc: AgentFlowDoc): string {
  const normalized = normalizeAgentFlowDraft(doc);
  assertValidAgentFlowDraft(normalized);

  return stringify({
    version: AGENTFLOW_SOURCE_VERSION,
    name: normalized.name,
    sessions: Object.fromEntries(normalized.sessions.map((session) => [
      session.id,
      {
        agentServerId: session.agentServerId,
        ...(session.agent ? { agent: session.agent } : {}),
        ...(session.mcpServers && session.mcpServers.trim() ? { mcpServers: session.mcpServers } : {}),
      },
    ])),
    nodes: Object.fromEntries(normalized.nodes.map((node) => [node.id, serializeNode(node)])),
    edges: normalized.edges.map(({ id: _id, ...edge }) => edge),
    ...(normalized.variables ? { variables: normalized.variables } : {}),
  });
}

export function keyFromLabel(label: string, fallback: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SYMBOL_KEY.test(key) ? key : fallback;
}

function parseSessions(raw: Record<string, unknown>): CanvasSession[] {
  return Object.entries(raw).map(([id, input]) => {
    assertSymbolKey(id, "session key");
    const session = asRecord(input, `session "${id}"`);
    return {
      id,
      name: id,
      agentServerId: optionalString(session.agentServerId) ?? "",
      ...(typeof session.agent === "string" ? { agent: session.agent } : {}),
      ...(typeof session.mcpServers === "string"
        ? { mcpServers: assertMcpServersString(session.mcpServers, id) }
        : {}),
    };
  });
}

/**
 * MCP servers are stored as a JSON string so users can paste a McpServer[]
 * config from Claude Desktop / Cursor / etc. without inventing a parallel
 * YAML schema. We do basic JSON validity + array-shape checks here so the
 * error fires at parse time, not when the agent finally fails to start.
 */
function assertMcpServersString(value: string, sessionId: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`session "${sessionId}".mcpServers must be valid JSON: ${detail}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`session "${sessionId}".mcpServers must be a JSON array of McpServer objects.`);
  }
  return value;
}

function parseNodes(raw: Record<string, unknown>): AgentFlowNode[] {
  return Object.entries(raw).map(([id, input]) => {
    assertSymbolKey(id, "node key");
    const node = asRecord(input, `node "${id}"`);
    const kind = requireString(node.kind, `node "${id}".kind`);
    const title = optionalString(node.title) ?? "";

    if (kind === "input") {
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? "",
        title,
        variableName: optionalString(node.variableName) ?? "",
        ...(node.required === false ? { required: false } : {}),
        defaultValue: optionalString(node.defaultValue),
        description: optionalString(node.description),
        sessionId: null,
      };
    }
    if (kind === "end") {
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? "",
        title,
        sessionId: null,
      };
    }

    if (kind === "step") {
      const sessionId = optionalString(node.session) ?? "";
      const modeId = optionalString(node.modeId);
      const configOptions = parseConfigOptions(node.configOptions, id);
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? "",
        title,
        prompt: optionalString(node.prompt) ?? "",
        sessionId,
        ...(node.pauseAfterRun === true ? { pauseAfterRun: true } : {}),
        ...(node.locked === true ? { locked: true } : {}),
        ...(Array.isArray(node.images) ? { images: parseImages(node.images, id) } : {}),
        ...(Array.isArray(node.paths) ? { paths: parsePaths(node.paths, id) } : {}),
        ...(modeId ? { modeId } : {}),
        ...(configOptions ? { configOptions } : {}),
      };
    }
    if (kind === "gate") {
      if (node.modeId !== undefined) {
        throw new Error(`Gate node "${id}" must not define modeId — only step nodes accept a per-node ACP mode override.`);
      }
      const configOptions = parseConfigOptions(node.configOptions, id);
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? "",
        title,
        decisionCriteria: optionalString(node.decisionCriteria) ?? "",
        branches: node.branches === undefined ? [] : parseBranches(asRecord(node.branches, `node "${id}".branches`), id),
        ...(configOptions ? { configOptions } : {}),
      };
    }
    throw new Error(`Node "${id}" has unsupported kind "${kind}".`);
  });
}

function parseBranches(raw: Record<string, unknown>, nodeId: string): CanvasBranch[] {
  const branches = Object.entries(raw).map(([id, input]) => {
    assertSymbolKey(id, `node "${nodeId}" branch key`);
    const branch = input == null ? {} : asRecord(input, `node "${nodeId}" branch "${id}"`);
    return {
      id,
      label: optionalString(branch.label) ?? id,
      ...(optionalString(branch.description) ? { description: optionalString(branch.description) } : {}),
    };
  });
  return branches;
}

function parseEdges(raw: unknown, nodes: AgentFlowNode[], nodeIds: Set<string>): CanvasEdge[] {
  if (!Array.isArray(raw)) throw new Error("edges must be an array.");
  const branchesByGate = new Map(
    nodes
      .filter((node) => node.kind === "gate")
      .map((node) => [node.id, new Set(node.branches.map((branch) => branch.id))]),
  );
  const edgeIds = new Set<string>();

  return raw.map((input, index) => {
    const edge = asRecord(input, `edges[${index}]`);
    const from = requireString(edge.from, `edges[${index}].from`);
    const to = requireString(edge.to, `edges[${index}].to`);
    if (!nodeIds.has(from)) throw new Error(`Edge references missing source node "${from}".`);
    if (!nodeIds.has(to)) throw new Error(`Edge references missing target node "${to}".`);
    const branch = optionalString(edge.branch);
    if (branch && !branchesByGate.get(from)?.has(branch)) {
      throw new Error(`Edge from "${from}" references missing branch "${branch}".`);
    }
    const parsed: CanvasEdge = {
      id: edgeIdFromReferences({ from, to, branch }),
      from,
      to,
      ...(edge.transmit === true ? { transmit: true } : {}),
      ...(optionalString(edge.outputTag) ? { outputTag: optionalString(edge.outputTag)! } : {}),
      ...(optionalString(edge.handoffPrompt) ? { handoffPrompt: optionalString(edge.handoffPrompt)! } : {}),
      ...(branch ? { branch } : {}),
      ...(edge.loopback === true ? { loopback: true } : {}),
      ...(parseMaxTraversals(edge.maxTraversals, `edges[${index}].maxTraversals`) != null
        ? { maxTraversals: parseMaxTraversals(edge.maxTraversals, `edges[${index}].maxTraversals`)! }
        : {}),
    };
    if (edgeIds.has(parsed.id)) {
      throw new Error(`Duplicate edge "${parsed.id}".`);
    }
    edgeIds.add(parsed.id);
    return parsed;
  });
}

function serializeNode(node: AgentFlowNode): Record<string, unknown> {
  if (node.kind === "input") {
    return compact({
      kind: node.kind,
      alias: node.alias,
      title: node.title,
      variableName: node.variableName,
      required: node.required,
      defaultValue: node.defaultValue,
      description: node.description,
    });
  }
  if (node.kind === "end") {
    return compact({ kind: node.kind, alias: node.alias, title: node.title });
  }
  if (node.kind === "step") {
    return compact({
      kind: node.kind,
      alias: node.alias,
      title: node.title,
      prompt: node.prompt,
      session: node.sessionId,
      pauseAfterRun: node.pauseAfterRun,
      locked: node.locked,
      images: node.images,
      paths: node.paths,
      modeId: node.modeId,
      configOptions: node.configOptions && Object.keys(node.configOptions).length > 0 ? node.configOptions : undefined,
    });
  }
  return compact({
    kind: node.kind,
    alias: node.alias,
    title: node.title,
    decisionCriteria: node.decisionCriteria,
    branches: Object.fromEntries(node.branches.map((branch) => [
      branch.id,
      compact({
        label: branch.label === branch.id ? undefined : branch.label,
        description: branch.description,
      }),
    ])),
    configOptions: node.configOptions && Object.keys(node.configOptions).length > 0 ? node.configOptions : undefined,
  });
}

function parseImages(raw: unknown[], nodeId: string): Array<{ path: string; label?: string; mimeType?: string }> {
  return raw.map((input, index) => {
    const image = asRecord(input, `node "${nodeId}".images[${index}]`);
    return compact({
      path: requireString(image.path, `node "${nodeId}".images[${index}].path`),
      label: optionalString(image.label),
      mimeType: optionalString(image.mimeType),
    });
  });
}

function parsePaths(raw: unknown[], nodeId: string): string[] {
  return raw.map((input, index) => requireString(input, `node "${nodeId}".paths[${index}]`));
}

function parseConfigOptions(raw: unknown, nodeId: string): Record<string, string | boolean> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`node "${nodeId}".configOptions must be a key/value object.`);
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string" && typeof value !== "boolean") {
      throw new Error(`node "${nodeId}".configOptions["${key}"] must be a string or boolean.`);
    }
    out[key] = value;
  }
  return out;
}

function parseVariables(raw: unknown): CanvasVariable[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("variables must be an array.");
  return raw.map((input, index) => {
    const variable = asRecord(input, `variables[${index}]`);
    return compact({
      name: requireString(variable.name, `variables[${index}].name`),
      defaultValue: optionalString(variable.defaultValue),
      description: optionalString(variable.description),
    }) as CanvasVariable;
  });
}

function parseMaxTraversals(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  return value as number;
}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
