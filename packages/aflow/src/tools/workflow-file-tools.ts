import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  assertSymbolKey,
  keyFromLabel,
  loadAgentFlowFile,
  parseAgentFlowSource,
  stringifyAgentFlowSource,
  type AgentFlowDoc,
} from "@specflow/server";
import { Type } from "typebox";
import { connectOrStartSpecflowServer } from "../server/connect-or-start";
import {
  listWorkflowFiles,
  loadWorkflowYaml,
  workflowYamlPath,
} from "../workflows/workflow-resolver";

const ServerParam = {
  serverUrl: Type.Optional(Type.String({ description: "Optional Specflow server URL." })),
};

const WorkflowReadParams = Type.Object({
  target: Type.String({ description: "Workflow id or local YAML path." }),
  ...ServerParam,
});

const WorkflowWriteParams = Type.Object({
  workflowId: Type.String({ description: "Workflow id and YAML filename without extension." }),
  yaml: Type.String({ description: "Complete Specflow workflow YAML source." }),
  local: Type.Optional(Type.Boolean({ description: "Write to agentflows-local when true. Defaults to true." })),
});

const WorkflowForkParams = Type.Object({
  source: Type.String({ description: "Source workflow id or local YAML path." }),
  newWorkflowId: Type.Optional(Type.String({ description: "New workflow id. Defaults to a non-conflicting adapted id." })),
  newName: Type.Optional(Type.String({ description: "Optional display name for the copied workflow." })),
  ...ServerParam,
});

export function registerWorkflowFileTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "specflow_list_workflows",
    label: "List Workflows",
    description: "List saved Specflow workflows from the workspace.",
    promptSnippet: "List saved Specflow workflows when the user needs to pick one.",
    parameters: Type.Object(ServerParam),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const connection = await connectOrStartSpecflowServer({ cwd: ctx.cwd, serverUrl: params.serverUrl });
      const workflowsById = new Map((await connection.client.listCanvases()).map((workflow) => [workflow.id, workflow]));
      for (const workflow of await listWorkflowFiles(ctx.cwd)) {
        workflowsById.set(workflow.id, workflow);
      }
      const workflows = [...workflowsById.values()];
      return textResult(
        workflows.length
          ? workflows.map((workflow) => `${workflow.id}${workflow.local ? " (local)" : ""}: ${workflow.name}`).join("\n")
          : "No workflows found.",
        { workflows },
      );
    },
  });

  pi.registerTool({
    name: "specflow_read_workflow",
    label: "Read Workflow",
    description: "Read a Specflow workflow as YAML by id or local YAML path.",
    promptSnippet: "Read existing workflow YAML before editing or adapting it.",
    parameters: WorkflowReadParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const loaded = await loadWorkflowYaml(params.target, ctx.cwd, params.serverUrl);
      return textResult(loaded.yaml, loaded);
    },
  });

  pi.registerTool({
    name: "specflow_write_workflow",
    label: "Write Workflow",
    description: "Write complete Specflow workflow YAML into the workspace. Defaults to agentflows-local. New authored workflows should use Specflow Agentflow v2.",
    promptSnippet: "Persist a complete v2 workflow YAML draft or adaptation deterministically.",
    promptGuidelines: [
      "Use local=true for drafts and fork/adapt outputs.",
      "Pass the complete YAML document, not a patch.",
      "For new or rewritten workflows, write version: 2 with explicit start nodes, top-level variables, and no authored edge loopback or edge maxTraversals.",
    ],
    parameters: WorkflowWriteParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const workflowId = params.workflowId;
      assertSymbolKey(workflowId, "workflow id");
      const parsed = parseAgentFlowSource(params.yaml, workflowId);
      const local = params.local ?? true;
      const path = workflowYamlPath(ctx.cwd, workflowId, local);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, stringifyAgentFlowSource({ ...parsed, id: workflowId }), "utf8");
      return textResult(`Workflow written: ${path}`, {
        workflowId,
        path,
        local,
        name: parsed.name,
      });
    },
  });

  pi.registerTool({
    name: "specflow_fork_workflow_to_local",
    label: "Fork Workflow",
    description: "Copy a workflow to agentflows-local before adapting it. The copied draft can then be updated to the current v2 format.",
    promptSnippet: "Fork/adapt must copy the source workflow to agentflows-local before editing or migrating it.",
    promptGuidelines: [
      "Call this before modifying an existing workflow for a new problem.",
      "After this tool returns, edit the copied local workflow instead of the source.",
      "When rewriting a copied draft, write version: 2 workflow YAML. Legacy v1 workflow YAML is no longer supported.",
    ],
    parameters: WorkflowForkParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const source = await loadWorkflowYaml(params.source, ctx.cwd, params.serverUrl);
      const parsed = parseAgentFlowSource(source.yaml, source.workflowId);
      const newWorkflowId = await chooseForkId(ctx.cwd, params.newWorkflowId, source.workflowId);
      const forked: AgentFlowDoc = {
        ...parsed,
        id: newWorkflowId,
        name: params.newName?.trim() || `${parsed.name || source.workflowId} (local adaptation)`,
      };
      const path = workflowYamlPath(ctx.cwd, newWorkflowId, true);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, stringifyAgentFlowSource(forked), "utf8");
      return textResult(`Workflow forked to local draft: ${path}`, {
        sourceWorkflowId: source.workflowId,
        workflowId: newWorkflowId,
        path,
        local: true,
      });
    },
  });
}

async function chooseForkId(cwd: string, requested: string | undefined, sourceId: string): Promise<string> {
  const base = requested?.trim() || keyFromLabel(`${sourceId}-adapted`, `${sourceId}-adapted`);
  assertSymbolKey(base, "new workflow id");
  let candidate = base;
  let suffix = 2;
  while (await workflowExists(cwd, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function workflowExists(cwd: string, workflowId: string): Promise<boolean> {
  for (const local of [true, false]) {
    try {
      await loadAgentFlowFile(workflowYamlPath(cwd, workflowId, local));
      return true;
    } catch {
      // Missing or malformed means unavailable for fork target purposes.
    }
  }
  return false;
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}
