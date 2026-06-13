import { access, mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AgentFlowDoc,
  AgentFlowNode,
  CanvasDoc,
  CanvasLayoutDoc,
  CanvasNode,
  CanvasNodeLayout,
} from "./canvas-doc";
import { parseAgentFlowSource, stringifyAgentFlowSource } from "./agentflow-source";
import { analyzeAgentFlowLoops } from "./loop-analysis";
import {
  agentflowsDir,
  canvasDir,
  localAgentflowsDir,
} from "../workspace-paths";

function agentflowPath(id: string, root: string, local = false) {
  return join(local ? localAgentflowsDir(root) : agentflowsDir(root), `${id}.yaml`);
}

function canvasPath(id: string, root: string) {
  return join(canvasDir(root), `${id}.json`);
}

export async function listCanvases(root: string): Promise<{ id: string; name: string; version: 1 | 2; local?: boolean; deprecated?: boolean }[]> {
  const results = new Map<string, { id: string; name: string; version: 1 | 2; local?: boolean; deprecated?: boolean }>();
  await collectCanvases(results, agentflowsDir(root), false);
  await collectCanvases(results, localAgentflowsDir(root), true);
  return [...results.values()];
}

async function collectCanvases(
  results: Map<string, { id: string; name: string; version: 1 | 2; local?: boolean; deprecated?: boolean }>,
  directory: string,
  local: boolean,
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return;
  }
  for (const file of files.filter((file) => file.endsWith(".yaml"))) {
    try {
      const rawValue = await readFile(join(directory, file), "utf8");
      const id = basename(file, ".yaml");
      const canvasDocument = parseAgentFlowSource(rawValue, id);
      const version = canvasDocument.version ?? 1;
      results.set(id, {
        id: canvasDocument.id,
        name: canvasDocument.name,
        version,
        ...(version === 1 ? { deprecated: true } : {}),
        ...(local ? { local: true } : {}),
      });
    } catch {
      // skip malformed
    }
  }
}

export async function loadCanvas(id: string, root: string): Promise<CanvasDoc> {
  const agentflow = await loadAgentFlow(id, root);
  const layout = await loadOrCreateCanvasLayout(agentflow, root);
  return combineAgentFlowAndLayout(agentflow, layout);
}

export async function loadAgentFlow(id: string, root: string): Promise<AgentFlowDoc> {
  const path = await readableAgentflowPath(id, root);
  const rawValue = await readFile(path, "utf8");
  return parseAgentFlowSource(rawValue, id);
}

export async function loadOrCreateCanvasLayout(
  agentflow: AgentFlowDoc,
  root: string,
): Promise<CanvasLayoutDoc> {
  try {
    const rawValue = await readFile(await readableCanvasPath(agentflow.id, root), "utf8");
    const layout = JSON.parse(rawValue) as CanvasLayoutDoc;
    if (layout.workflowId === agentflow.id) {
      const normalized = normalizeCanvasLayout(agentflow, layout);
      await saveCanvasLayout(agentflow.id, normalized, root);
      return normalized;
    }
  } catch {
    // Missing or malformed layout is regenerated below.
  }
  const generated = generateCanvasLayout(agentflow);
  await saveCanvasLayout(agentflow.id, generated, root);
  return generated;
}

export async function saveCanvas(id: string, canvasDocument: CanvasDoc, root: string): Promise<void> {
  const { agentflow, layout } = splitCanvasDoc({ ...canvasDocument, id });
  const path = await writableAgentflowPath(id, root);
  await mkdir(agentflowsDir(root), { recursive: true });
  await mkdir(localAgentflowsDir(root), { recursive: true });
  await Promise.all([
    writeFile(path, stringifyAgentFlowSource(agentflow), "utf8"),
    saveCanvasLayout(id, layout, root),
  ]);
}

export async function saveAgentFlowAndLayout(
  id: string,
  agentflow: AgentFlowDoc,
  layout: CanvasLayoutDoc,
  root: string,
  options: { local?: boolean } = {},
): Promise<void> {
  await mkdir(agentflowsDir(root), { recursive: true });
  await mkdir(localAgentflowsDir(root), { recursive: true });
  await Promise.all([
    writeFile(agentflowPath(id, root, options.local === true), stringifyAgentFlowSource({ ...agentflow, id }), "utf8"),
    saveCanvasLayout(id, layout, root),
  ]);
}

export async function saveCanvasLayout(id: string, layout: CanvasLayoutDoc, root: string): Promise<void> {
  await mkdir(canvasDir(root), { recursive: true });
  await writeFile(canvasPath(id, root), `${JSON.stringify(layout, null, 2)}\n`, "utf8");
}

export async function deleteCanvas(id: string, root: string): Promise<void> {
  await Promise.all([
    unlink(agentflowPath(id, root)).catch(() => {}),
    unlink(agentflowPath(id, root, true)).catch(() => {}),
    unlink(canvasPath(id, root)).catch(() => {}),
  ]);
}

async function readableAgentflowPath(id: string, root: string): Promise<string> {
  const candidates = [
    agentflowPath(id, root, true),
    agentflowPath(id, root),
  ];
  for (const path of candidates) {
    if (await pathExists(path)) return path;
  }
  return agentflowPath(id, root);
}

async function writableAgentflowPath(id: string, root: string): Promise<string> {
  if (await pathExists(agentflowPath(id, root, true))) {
    return agentflowPath(id, root, true);
  }
  return agentflowPath(id, root);
}

async function readableCanvasPath(id: string, root: string): Promise<string> {
  return canvasPath(id, root);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function splitCanvasDoc(canvasDocument: CanvasDoc): { agentflow: AgentFlowDoc; layout: CanvasLayoutDoc } {
  const nodes: AgentFlowNode[] = canvasDocument.nodes.map((node) => stripLayout(node));
  const layout: CanvasLayoutDoc = {
    workflowId: canvasDocument.id,
    version: 1,
    nodes: canvasDocument.nodes.map((node) => ({
      nodeId: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
    })),
  };
  return {
    agentflow: {
      id: canvasDocument.id,
      version: canvasDocument.version ?? 1,
      name: canvasDocument.name,
      sessions: canvasDocument.sessions,
      nodes,
      edges: canvasDocument.edges,
      variables: canvasDocument.variables,
    },
    layout,
  };
}

export function combineAgentFlowAndLayout(
  agentflow: AgentFlowDoc,
  layout: CanvasLayoutDoc,
): CanvasDoc {
  const layoutByNode = new Map(layout.nodes.map((node) => [node.nodeId, node]));
  const generated = generateCanvasLayout(agentflow);
  const generatedByNode = new Map(generated.nodes.map((node) => [node.nodeId, node]));
  return {
    id: agentflow.id,
    version: agentflow.version ?? 1,
    name: agentflow.name,
    sessions: agentflow.sessions,
    nodes: agentflow.nodes.map((node) => {
      const nodeLayout = layoutByNode.get(node.id) ?? generatedByNode.get(node.id);
      return {
        ...node,
        x: nodeLayout?.x ?? 0,
        y: nodeLayout?.y ?? 0,
        w: nodeLayout?.w ?? defaultWidth(node.kind),
      } as CanvasNode;
    }),
    edges: agentflow.edges,
    variables: agentflow.variables,
    ...((agentflow.version ?? 1) === 2
      ? { derived: { loopClosingEdgeIds: analyzeAgentFlowLoops(agentflow).loopClosingEdgeIds } }
      : {}),
  };
}

export function generateCanvasLayout(agentflow: AgentFlowDoc): CanvasLayoutDoc {
  const derivedLoopClosingEdgeIds = (agentflow.version ?? 1) === 2
    ? analyzeAgentFlowLoops(agentflow).loopClosingEdgeIds
    : [];
  const ignoredEdges = new Set([
    ...agentflow.edges.filter((edge) => edge.loopback).map((edge) => edge.id),
    ...derivedLoopClosingEdgeIds,
  ]);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of agentflow.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of agentflow.edges) {
    if (ignoredEdges.has(edge.id)) continue;
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) continue;
    incoming.get(edge.to)!.push(edge.from);
    outgoing.get(edge.from)!.push(edge.to);
  }

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const byId = new Map(agentflow.nodes.map((node) => [node.id, node]));

  const computeRank = (nodeId: string): number => {
    const existing = rank.get(nodeId);
    if (existing != null) return existing;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const node = byId.get(nodeId);
    const parents = incoming.get(nodeId) ?? [];
    const value = node?.kind === "input" || node?.kind === "start" || parents.length === 0
      ? 0
      : Math.max(...parents.map((parentId) => computeRank(parentId) + 1));
    visiting.delete(nodeId);
    rank.set(nodeId, value);
    return value;
  };

  for (const node of agentflow.nodes) computeRank(node.id);

  const columns = new Map<number, AgentFlowNode[]>();
  for (const node of agentflow.nodes) {
    const rankValue = rank.get(node.id) ?? 0;
    const column = columns.get(rankValue) ?? [];
    column.push(node);
    columns.set(rankValue, column);
  }

  const layouts: CanvasNodeLayout[] = [];
  const sortedRanks = [...columns.keys()].sort((a, b) => a - b);
  const xByRank = new Map<number, number>();
  let previousRank: number | undefined;
  for (const rankValue of sortedRanks) {
    if (previousRank === undefined) {
      xByRank.set(rankValue, 60);
    } else {
      const previousColumn = columns.get(previousRank)!;
      const previousWidth = Math.max(...previousColumn.map((node) => defaultWidth(node.kind)));
      const labelWidth = maximumEdgeLabelWidth(agentflow, rank, previousRank, rankValue);
      xByRank.set(rankValue, (xByRank.get(previousRank) ?? 60) + previousWidth + Math.max(80, labelWidth + 48));
    }
    previousRank = rankValue;
  }
  for (const rankValue of sortedRanks) {
    const column = columns.get(rankValue)!;
    column.sort(compareNodesForLayout);
    for (let index = 0; index < column.length; index += 1) {
      const node = column[index]!;
      layouts.push({
        nodeId: node.id,
        x: xByRank.get(rankValue) ?? 60,
        y: 80 + index * 180,
        w: defaultWidth(node.kind),
      });
    }
  }

  return {
    workflowId: agentflow.id,
    version: 1,
    nodes: layouts,
  };
}

function normalizeCanvasLayout(agentflow: AgentFlowDoc, layout: CanvasLayoutDoc): CanvasLayoutDoc {
  const knownNodeIds = new Set(agentflow.nodes.map((node) => node.id));
  const generated = generateCanvasLayout(agentflow);
  const layoutByNode = new Map(layout.nodes.map((node) => [node.nodeId, node]));
  const nodes = generated.nodes.map((fallback) => {
    const existing = layoutByNode.get(fallback.nodeId);
    if (!existing || !knownNodeIds.has(existing.nodeId)) return fallback;
    return {
      nodeId: existing.nodeId,
      x: existing.x,
      y: existing.y,
      w: existing.w || fallback.w,
    };
  });
  return {
    workflowId: agentflow.id,
    version: 1,
    nodes,
    viewport: layout.viewport,
  };
}

function stripLayout(node: CanvasNode): AgentFlowNode {
  const { x: _x, y: _y, w: _w, ...rest } = node;
  return rest;
}

function defaultWidth(kind: AgentFlowNode["kind"]): number {
  if (kind === "start") return 140;
  if (kind === "gate") return 200;
  if (kind === "input") return 200;
  if (kind === "end") return 140;
  return 220;
}

function compareNodesForLayout(a: AgentFlowNode, b: AgentFlowNode): number {
  return (a.alias || "").localeCompare(b.alias || "", undefined, { numeric: true }) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
}

function maximumEdgeLabelWidth(
  agentflow: AgentFlowDoc,
  rank: Map<string, number>,
  sourceRank: number,
  targetRank: number,
): number {
  let maximum = 0;
  for (const edge of agentflow.edges) {
    if (edge.loopback || rank.get(edge.from) !== sourceRank || rank.get(edge.to) !== targetRank) continue;
    maximum = Math.max(maximum, estimateEdgeLabelWidth(edge, agentflow));
  }
  return maximum;
}

function estimateEdgeLabelWidth(edge: AgentFlowDoc["edges"][number], agentflow: AgentFlowDoc): number {
  const source = agentflow.nodes.find((node) => node.id === edge.from);
  const target = agentflow.nodes.find((node) => node.id === edge.to);
  const visibleLabels = [
    target?.kind === "gate" ? "gate input" : edge.outputTag ? `<specflow_${edge.outputTag}>` : "no transfer",
    source?.kind === "gate" ? source.branches.find((branch) => branch.id === edge.branch)?.label ?? edge.branch ?? "" : "",
  ];
  return Math.max(...visibleLabels.map((label) => label.length * 7 + 24));
}
