import { connectWorkspaceServer, type ConnectWorkspaceServerOptions } from "./workspace-server";
import { isAbsolute, resolve } from "node:path";
import type {
  CanvasDoc,
  RunGraphOperation,
  RunRecordDetail,
  RunReachability,
  SpecflowClient,
} from "@specflow/client";

export interface SpecflowMcpServerOptions {
  serveCommand?: string[];
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, options: SpecflowMcpServerOptions) => Promise<unknown>;
}

const COMMON_PROPERTIES = {
  cwd: {
    type: "string",
    description: "Absolute path to the Specflow workspace. Defaults to the MCP process cwd.",
  },
  serverUrl: {
    type: "string",
    description: "Optional explicit Specflow server URL.",
  },
};

const tools: ToolDefinition[] = [
  tool("specflow_health", "Connect to the workspace Specflow server and return health.", {}, async (args, options) => {
    const connection = await connectionFor(args, options);
    return { url: connection.url, started: connection.started, health: connection.health };
  }),
  tool("specflow_list_workflows", "List Specflow workflows visible in the workspace.", {}, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, workflows: await client.listWorkflows() };
  }),
  tool("specflow_read_workflow", "Read workflow YAML by id or workspace-relative YAML path.", {
    target: { type: "string" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, ...(await client.readWorkflowSource(requiredString(args, "target"))) };
  }),
  tool("specflow_write_workflow", "Write canonical workflow YAML to agentflows-local by default.", {
    workflowId: { type: "string" },
    yaml: { type: "string" },
    local: { type: "boolean" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, ...(await client.writeWorkflowSource({
      workflowId: requiredString(args, "workflowId"),
      yaml: requiredString(args, "yaml"),
      local: optionalBoolean(args, "local"),
    })) };
  }),
  tool("specflow_fork_workflow_to_local", "Fork a workflow to agentflows-local before adapting it.", {
    source: { type: "string" },
    newWorkflowId: { type: "string" },
    newName: { type: "string" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, ...(await client.forkWorkflowSource({
      source: requiredString(args, "source"),
      newWorkflowId: optionalString(args, "newWorkflowId"),
      newName: optionalString(args, "newName"),
      local: true,
    })) };
  }),
  tool("specflow_import_assets", "Rare: copy external files into .aflow/.specflow/agentflow/assets for a workflow only when the user explicitly wants durable/shareable assets. For files already in the repo, usually reference relative paths instead of importing.", {
    workflowId: { type: "string" },
    kind: { type: "string", enum: ["image", "path"] },
    filePaths: { type: "array" },
    relativePaths: { type: "array" },
    directory: { type: "boolean" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    const cwd = optionalString(args, "cwd") ?? process.cwd();
    const filePaths = stringArrayArg(args, "filePaths");
    const relativePaths = optionalStringArray(args, "relativePaths");
    return { serverUrl: url, ...(await client.importWorkflowAssets(requiredString(args, "workflowId"), {
      kind: assetKind(args),
      directory: optionalBoolean(args, "directory"),
      files: filePaths.map((path, index) => ({
        path: isAbsolute(path) ? path : resolve(cwd, path),
        relativePath: relativePaths[index],
      })),
    })) };
  }),
  tool("specflow_validate_workflow", "Validate workflow with server runnable validation.", {
    target: { type: "string" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, ...(await client.validateWorkflow(requiredString(args, "target"))) };
  }),
  tool("specflow_prepare_run", "Prepare a run and return missing variables/auth/validation status.", {
    workflowId: { type: "string" },
    initialInput: { type: "string" },
    variableValues: { type: "object" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return withAuthUiGuidance({ serverUrl: url, ...(await client.prepareWorkflowRun({
      workflowId: requiredString(args, "workflowId"),
      initialInput: optionalString(args, "initialInput"),
      variableValues: stringRecord(args["variableValues"]),
    })) });
  }),
  tool("specflow_start_run", "Start a normal or dynamic run. Dynamic mode pauses after first activation.", {
    workflowId: { type: "string" },
    initialInput: { type: "string" },
    variableValues: { type: "object" },
    dynamicReview: { type: "boolean" },
    waitForCheckpoint: { type: "boolean" },
    timeoutMs: { type: "number" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    const dynamicReview = optionalBoolean(args, "dynamicReview") === true;
    let run;
    try {
      run = await client.startRun(requiredString(args, "workflowId"), {
        initialInput: optionalString(args, "initialInput"),
        variableValues: stringRecord(args["variableValues"]),
        pauseAfterFirstActivation: dynamicReview,
      });
    } catch (error) {
      const authRequired = authUiGuidanceFromError(error);
      if (authRequired) return { serverUrl: url, ...authRequired };
      throw error;
    }
    if (optionalBoolean(args, "waitForCheckpoint") === false) return { serverUrl: url, dynamicReview, run };
    return {
      serverUrl: url,
      dynamicReview,
      ...(dynamicReview
        ? await waitForDynamicCheckpoint(client, run.id, timeoutMs(args))
        : await waitForRunState(client, run.id, timeoutMs(args))),
    };
  }),
  tool("specflow_get_run", "Inspect an existing, external, historical, or context-recovered run by id. For runs started by this tool call, prefer the returned run result and dynamic checkpoint tools.", {
    runId: { type: "string" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, run: await client.getRun(requiredString(args, "runId")) };
  }),
  tool("specflow_get_run_checkpoint", "Inspect a dynamic run checkpoint without playing.", {
    runId: { type: "string" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, ...(await dynamicCheckpoint(client, requiredString(args, "runId"))) };
  }),
  tool("specflow_run_to_next_checkpoint", "Advance a dynamic run to the next checkpoint or terminal state.", {
    runId: { type: "string" },
    timeoutMs: { type: "number" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    const runId = requiredString(args, "runId");
    const before = await client.getRun(runId);
    let ignoreCheckpointToken: string | undefined;
    if (before.status === "paused" || before.status === "interrupted") {
      ignoreCheckpointToken = dynamicCheckpointToken(before);
      await client.playRun(runId, { pauseAfterNextActivation: true });
    }
    return { serverUrl: url, ...(await waitForDynamicCheckpoint(client, runId, timeoutMs(args), { ignoreCheckpointToken })) };
  }),
  tool("specflow_patch_run_graph", "Patch only the current run snapshot with structured operations.", {
    runId: { type: "string" },
    operations: { type: "array" },
    summary: { type: "string" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, ...(await client.patchRunGraph(requiredString(args, "runId"), {
      operations: arrayArg(args, "operations") as RunGraphOperation[],
      summary: optionalString(args, "summary"),
    })) };
  }),
  tool("specflow_pause_run", "Request pause for a running run.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.pauseRun(requiredString(args, "runId")))),
  tool("specflow_play_run", "Play the same paused or interrupted run from its checkpoint. Do not use after stop; stopped runs need specflow_continue_workflow.", {
    runId: { type: "string" },
    pauseAfterNextActivation: { type: "boolean" },
  }, async (args, options) => runTool(args, options, (client) => client.playRun(requiredString(args, "runId"), {
    pauseAfterNextActivation: optionalBoolean(args, "pauseAfterNextActivation"),
  }))),
  tool("specflow_interrupt_run", "Interrupt the active ACP prompt turn.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.interruptRun(requiredString(args, "runId")))),
  tool("specflow_stop_run", "Stop a run. This is terminal for that run id; use specflow_continue_workflow to create a new continuation run if more work is needed.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.stopRun(requiredString(args, "runId")))),
  tool("specflow_continue_workflow", "Continue a stopped or failed workflow by creating a continuation run.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.continueWorkflowRun(requiredString(args, "runId")))),
  tool("specflow_rerun", "Rerun an existing run snapshot, optionally overriding input variables.", {
    runId: { type: "string" },
    initialInput: { type: "string" },
    variableValues: { type: "object" },
  }, async (args, options) => runTool(args, options, (client) => client.rerunRun(requiredString(args, "runId"), {
    initialInput: optionalString(args, "initialInput"),
    variableValues: stringRecord(args["variableValues"]),
  }))),
  tool("specflow_delete_run", "Delete a run record and its logs.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.deleteRun(requiredString(args, "runId")))),
  tool("specflow_save_run_best_practice", "Save a successful run snapshot as a local or shared workflow.", {
    runId: { type: "string" },
    name: { type: "string" },
    shared: { type: "boolean" },
  }, async (args, options) => runTool(args, options, (client) => client.saveRunBestPractice(requiredString(args, "runId"), {
    name: optionalString(args, "name"),
    shared: optionalBoolean(args, "shared"),
  }))),
  tool("specflow_get_run_logs", "Get recent logs for an existing, external, historical, or context-recovered run. Do not use as the default monitoring path for a run just started in this conversation.", {
    runId: { type: "string" },
    tail: { type: "number" },
  }, async (args, options) => {
    const { client, url } = await connectionFor(args, options);
    return { serverUrl: url, logs: await client.getRunLogs(requiredString(args, "runId"), { tail: optionalNumber(args, "tail") }) };
  }),
  tool("specflow_list_paused_nodes", "List authored pauseAfterRun ACP nodes for a run.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.listPausedNodes(requiredString(args, "runId")))),
  tool("specflow_prompt_paused_node", "Send a prompt to a paused ACP node.", {
    runId: { type: "string" },
    nodeId: { type: "string" },
    prompt: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.promptPausedNode(
    requiredString(args, "runId"),
    requiredString(args, "nodeId"),
    requiredString(args, "prompt"),
  ))),
  tool("specflow_continue_paused_node", "Continue a paused ACP node. Use play=false in dynamic mode, then run_to_next_checkpoint.", {
    runId: { type: "string" },
    nodeId: { type: "string" },
    play: { type: "boolean" },
    pauseAfterNextActivation: { type: "boolean" },
  }, async (args, options) => runTool(args, options, (client) => client.continuePausedNode(
    requiredString(args, "runId"),
    requiredString(args, "nodeId"),
    {
      play: optionalBoolean(args, "play"),
      pauseAfterNextActivation: optionalBoolean(args, "pauseAfterNextActivation"),
    },
  ))),
  tool("specflow_list_pending_interactions", "List pending ACP permission/elicitation interactions.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.listPendingInteractions(requiredString(args, "runId")))),
  tool("specflow_respond_interaction", "Resolve an ACP permission/elicitation interaction.", {
    runId: { type: "string" },
    interactionId: { type: "string" },
    resolution: { type: "object" },
  }, async (args, options) => runTool(args, options, (client) => client.respondRunInteraction(
    requiredString(args, "runId"),
    requiredString(args, "interactionId"),
    args["resolution"] ?? {},
  ))),
  tool("specflow_list_agent_sessions", "List recorded ACP agent sessions.", {
    workflowId: { type: "string" },
    agentServerId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.listAgentSessions({
    workflowId: optionalString(args, "workflowId"),
    agentServerId: optionalString(args, "agentServerId"),
  }))),
  tool("specflow_get_agent_session", "Get one recorded ACP agent session.", {
    agentSessionId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.getAgentSession(requiredString(args, "agentSessionId")))),
  tool("specflow_get_native_resume_commands", "Return verified native CLI resume command recommendations for all recorded agent sessions in a run. Unknown/custom agents return unavailable; do not invent commands.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.getRunNativeResumeCommands(requiredString(args, "runId")))),
  tool("specflow_get_agent_session_native_resume_command", "Return the verified native CLI resume command recommendation for one recorded agent session. If unavailable, use ACP restore/inspect or ask the user.", {
    agentSessionId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.getAgentSessionNativeResumeCommand(requiredString(args, "agentSessionId")))),
  tool("specflow_get_resumable_session", "Find the best session to resume for a run.", {
    runId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.getResumableSession(requiredString(args, "runId")))),
  tool("specflow_restore_agent_session", "Restore a recorded ACP agent session in inspect or continue mode.", {
    agentSessionId: { type: "string" },
    mode: { type: "string", enum: ["inspect", "continue"] },
  }, async (args, options) => runTool(args, options, (client) => client.restoreAgentSession(
    requiredString(args, "agentSessionId"),
    restoreMode(args),
  ))),
  tool("specflow_prompt_restored_session", "Prompt an active restored ACP session.", {
    restoreId: { type: "string" },
    prompt: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.promptRestoredSession(requiredString(args, "restoreId"), requiredString(args, "prompt")))),
  tool("specflow_cancel_restored_session", "Cancel a restore attempt or restored session.", {
    restoreId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.cancelRestoredSession(requiredString(args, "restoreId")))),
  tool("specflow_close_restored_session", "Close a restored ACP session.", {
    restoreId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.closeRestoredSession(requiredString(args, "restoreId")))),
  tool("specflow_list_agent_servers", "List configured agent servers.", {}, async (args, options) => runTool(args, options, (client) => client.listAgentServers())),
  tool("specflow_list_agent_registry", "List registry agent servers that can be installed/configured. Use this before saving a registry agent server or choosing model/permission-capable runtimes.", {}, async (args, options) => runTool(args, options, (client) => client.listAgentRegistry())),
  tool("specflow_install_registry_agent", "Install/configure a registry agent server from the Specflow registry/CDN. Use only when the user explicitly asks to add an agent. For agents outside the registry, ask the user to configure them in Specflow UI.", {
    registryId: { type: "string" },
    agentServerId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.installRegistryAgent(
    requiredString(args, "registryId"),
    { agentServerId: optionalString(args, "agentServerId") },
  ))),
  tool("specflow_update_registry_agent", "Update an existing registry-backed agent server to the latest registry version. Does not handle custom/headless agents; use Specflow UI for those.", {
    agentServerId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.updateRegistryAgent(requiredString(args, "agentServerId")))),
  tool("specflow_remove_agent_server", "Remove a local agent server override only when the user explicitly asks. This does not uninstall external CLIs or perform auth cleanup.", {
    agentServerId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.removeAgentServer(requiredString(args, "agentServerId")))),
  tool("specflow_get_agent_capabilities", "Read cached agent capabilities.", {
    agentServerId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.getAgentCapabilities(requiredString(args, "agentServerId")))),
  tool("specflow_refresh_agent_capabilities", "Refresh agent capabilities by probing the ACP runtime.", {
    agentServerId: { type: "string" },
  }, async (args, options) => runTool(args, options, (client) => client.refreshAgentCapabilities(requiredString(args, "agentServerId")))),
];

const toolsByName = new Map(tools.map((entry) => [entry.name, entry]));

export function listSpecflowMcpToolNames(): string[] {
  return tools.map((entry) => entry.name);
}

export function listSpecflowMcpTools(): Array<{ name: string; description: string }> {
  return tools.map(({ name, description }) => ({ name, description }));
}

export async function runSpecflowMcpServer(options: SpecflowMcpServerOptions = {}): Promise<void> {
  const transport = new StdioJsonRpcTransport();
  transport.onMessage(async (message) => {
    if (message.id === undefined || message.id === null) return;
    try {
      const result = await handleRequest(message, options);
      transport.respond({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      transport.respond({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
  await transport.start();
}

async function handleRequest(message: JsonRpcRequest, options: SpecflowMcpServerOptions): Promise<unknown> {
  if (message.method === "initialize") {
    return {
      protocolVersion: protocolVersion(message.params),
      capabilities: { tools: {} },
      serverInfo: { name: "specflow", version: "0.1.0" },
      instructions: [
        "Use Specflow MCP tools for workflow file operations, validation, prepare-run, runs, dynamic checkpoints, runtime graph patches, pauseAfterRun ACP conversations, interactions, and sessions.",
        "Codex does not perform agent authentication. If prepare/start reports auth is required, ask the user to open Specflow UI and authenticate there, then retry.",
        "Use registry install/update tools only when the user explicitly asks to add/update registry agents; custom/headless agents must be configured in Specflow UI.",
        "Use native resume command tools only for recorded sessions, and do not invent commands when the tool reports unavailable.",
        "For dynamic pauseAfterRun, prompt/continue the paused node first, continue with play:false, then call specflow_run_to_next_checkpoint.",
        "Stop is terminal for that run id; paused/interrupted runs can play the same run from checkpoint, stopped runs need a new continuation run.",
        "Every long-running result includes runId/serverUrl so future tool calls can reconnect.",
      ].join("\n"),
    };
  }
  if (message.method === "ping") return {};
  if (message.method === "tools/list") {
    return {
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    };
  }
  if (message.method === "tools/call") {
    const params = asRecord(message.params);
    const name = requiredString(params, "name");
    const selected = toolsByName.get(name);
    if (!selected) throw new Error(`Unknown tool: ${name}`);
    const args = asRecord(params["arguments"]);
    const data = await selected.handler(args, options);
    return mcpToolResult(data);
  }
  if (message.method === "resources/list") return { resources: [] };
  if (message.method === "prompts/list") return { prompts: [] };
  throw new Error(`Unsupported MCP method: ${message.method}`);
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  handler: ToolDefinition["handler"],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_PROPERTIES,
        ...properties,
      },
      additionalProperties: false,
    },
    handler,
  };
}

async function connectionFor(args: Record<string, unknown>, options: SpecflowMcpServerOptions) {
  return connectWorkspaceServer({
    cwd: optionalString(args, "cwd"),
    serverUrl: optionalString(args, "serverUrl"),
    serveCommand: options.serveCommand,
  });
}

async function runTool(
  args: Record<string, unknown>,
  options: SpecflowMcpServerOptions,
  run: (client: SpecflowClient) => Promise<unknown>,
): Promise<unknown> {
  const { client, url } = await connectionFor(args, options);
  return { serverUrl: url, result: await run(client) };
}

async function waitForRunState(client: SpecflowClient, runId: string, timeoutMsValue: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMsValue;
  for (;;) {
    const [run, pausedNodes, pendingInteractions] = await Promise.all([
      client.getRun(runId),
      client.listPausedNodes(runId).catch(() => []),
      client.listPendingInteractions(runId).catch(() => []),
    ]);
    if (pausedNodes.length > 0) return { run, pausedNodes, nextAction: "prompt_or_continue_paused_node" };
    if (pendingInteractions.length > 0) return { run, pendingInteractions, nextAction: "respond_interaction" };
    if (!isInFlightStatus(run.status)) return { run, terminal: isTerminalStatus(run.status) };
    if (Date.now() >= deadline) return { run, timeout: true, nextAction: "call_get_run_or_wait_again" };
    await sleep(750);
  }
}

async function waitForDynamicCheckpoint(
  client: SpecflowClient,
  runId: string,
  timeoutMsValue: number,
  options: { ignoreCheckpointToken?: string } = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMsValue;
  for (;;) {
    const [run, pausedNodes, pendingInteractions] = await Promise.all([
      client.getRun(runId),
      client.listPausedNodes(runId).catch(() => []),
      client.listPendingInteractions(runId).catch(() => []),
    ]);
    if (pausedNodes.length > 0) {
      return {
        ...(await dynamicCheckpoint(client, runId, run)),
        pausedNodes,
        nextAction: "prompt_paused_node_then_continue_with_play_false",
      };
    }
    if (pendingInteractions.length > 0) return { run, pendingInteractions, nextAction: "respond_interaction" };
    if (!isInFlightStatus(run.status)) {
      if (options.ignoreCheckpointToken && dynamicCheckpointToken(run) === options.ignoreCheckpointToken) {
        if (Date.now() >= deadline) return { run, timeout: true, checkpointReady: false, nextAction: "call_run_to_next_checkpoint_again" };
        await sleep(750);
        continue;
      }
      return dynamicCheckpoint(client, runId, run);
    }
    if (Date.now() >= deadline) return { run, timeout: true, checkpointReady: false, nextAction: "call_run_to_next_checkpoint_again" };
    await sleep(750);
  }
}

async function dynamicCheckpoint(
  client: SpecflowClient,
  runId: string,
  prefetchedRun?: RunRecordDetail,
): Promise<Record<string, unknown>> {
  const run = prefetchedRun ?? await client.getRun(runId);
  if (isInFlightStatus(run.status)) {
    return {
      dynamicReview: true,
      checkpointReady: false,
      run,
      nextAction: "wait",
    };
  }
  const [reachability, graph] = await Promise.all([
    client.getRunReachability(runId).catch(() => undefined),
    run.agentflowSnapshot ? Promise.resolve(run.agentflowSnapshot) : client.getWorkflow(run.workflowId).catch(() => undefined),
  ]);
  return {
    dynamicReview: true,
    checkpointReady: run.status === "paused" || run.status === "interrupted",
    runId: run.id,
    workflowId: run.workflowId,
    status: run.status,
    completed: completedNodeOutput(run, graph),
    snapshotRevision: run.snapshotRevision,
    nodeStates: run.nodeStates,
    pausedNodeId: run.pausedNodeId,
    reachability,
    editableNodes: summarizeEditableNodes(graph, reachability, ["current", "future", "history_future"]),
    nonEditableNodes: summarizeEditableNodes(graph, reachability, ["history_only", "inactive"]),
    graph: graphSummary(graph, reachability),
    errorMsg: run.errorMsg,
    nextAction: isTerminalStatus(run.status) ? "done" : "patch_or_run_to_next_checkpoint",
  };
}

function completedNodeOutput(run: RunRecordDetail, graph?: CanvasDoc): unknown {
  const nodeId = run.checkpoint?.pendingCompletion?.nodeId
    ?? run.checkpoint?.suspension?.nodeId
    ?? run.checkpoint?.activeNodeId
    ?? run.pausedNodeId
    ?? run.activeNode;
  const node = nodeId ? graph?.nodes.find((candidate) => candidate.id === nodeId) : undefined;
  return {
    nodeId,
    title: typeof node?.title === "string" ? node.title : nodeId,
    text: typeof run.checkpoint?.pendingCompletion?.output === "string"
      ? run.checkpoint.pendingCompletion.output
      : nodeId ? run.nodeOutputs?.[nodeId] : undefined,
  };
}

function dynamicCheckpointToken(run: RunRecordDetail): string {
  const pending = run.checkpoint?.pendingCompletion as ({ executionKey?: unknown } | undefined);
  const suspension = run.checkpoint?.suspension as ({ executionKey?: unknown } | undefined);
  return [
    run.status,
    run.snapshotRevision ?? "",
    run.checkpoint?.createdAt ?? "",
    typeof pending?.executionKey === "string" ? pending.executionKey : "",
    typeof suspension?.executionKey === "string" ? suspension.executionKey : "",
    run.checkpoint?.activeNodeId ?? "",
    run.pausedNodeId ?? "",
  ].join("|");
}

function summarizeEditableNodes(
  graph: CanvasDoc | undefined,
  reachability: RunReachability | undefined,
  classes: string[],
): unknown[] | undefined {
  if (!graph || !reachability) return undefined;
  const allowed = new Set(classes);
  return graph.nodes
    .map((node) => ({ nodeId: node.id, title: node.title ?? node.id, editClass: reachability.nodes[node.id] }))
    .filter((entry) => entry.editClass && allowed.has(entry.editClass));
}

function graphSummary(graph: CanvasDoc | undefined, reachability: RunReachability | undefined): unknown {
  if (!graph) return undefined;
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title ?? node.id,
      editClass: reachability?.nodes[node.id],
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      branch: edge.branch,
    })),
  };
}

function withAuthUiGuidance<T extends Record<string, unknown>>(result: T): T {
  const statuses = Array.isArray(result["authStatuses"]) ? result["authStatuses"] : [];
  const required = statuses.filter((status) =>
    status && typeof status === "object" && (status as { needsAuth?: unknown }).needsAuth === true
  );
  if (required.length === 0) return result;
  return {
    ...result,
    authRequired: true,
    authGuidance: "Open the Specflow UI for this workspace, authenticate the required agent there, then retry this MCP tool. Codex does not perform terminal/TUI auth through the plugin.",
    nextAction: "open_specflow_ui_auth_then_retry",
  };
}

function authUiGuidanceFromError(error: unknown): Record<string, unknown> | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.toLowerCase().includes("authentication required")) return undefined;
  return {
    authRequired: true,
    error: message,
    authGuidance: "Open the Specflow UI for this workspace, authenticate the required agent there, then retry this MCP tool. Codex does not perform terminal/TUI auth through the plugin.",
    nextAction: "open_specflow_ui_auth_then_retry",
  };
}

function mcpToolResult(data: unknown): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function protocolVersion(params: unknown): string {
  const value = asRecord(params)["protocolVersion"];
  return typeof value === "string" ? value : "2024-11-05";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing ${key}`);
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  return typeof input[key] === "boolean" ? input[key] : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  return typeof input[key] === "number" && Number.isFinite(input[key]) ? input[key] : undefined;
}

function timeoutMs(input: Record<string, unknown>): number {
  const value = optionalNumber(input, "timeoutMs") ?? 60_000;
  return Math.max(1_000, Math.min(value, 300_000));
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function arrayArg(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`Missing ${key}`);
  return value;
}

function stringArrayArg(input: Record<string, unknown>, key: string): string[] {
  const values = arrayArg(input, key);
  if (!values.every((value) => typeof value === "string" && value.trim() !== "")) {
    throw new Error(`${key} must be an array of non-empty strings`);
  }
  return values.map((value) => (value as string).trim());
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings`);
  if (!value.every((entry) => typeof entry === "string")) throw new Error(`${key} must be an array of strings`);
  return value.map((entry) => entry.trim());
}

function assetKind(input: Record<string, unknown>): "image" | "path" {
  const value = optionalString(input, "kind");
  if (value === "image" || value === "path") return value;
  throw new Error("kind must be image or path");
}

function restoreMode(input: Record<string, unknown>): "inspect" | "continue" {
  const value = optionalString(input, "mode");
  if (value === "inspect" || value === "continue") return value;
  throw new Error("mode must be inspect or continue");
}

function isInFlightStatus(status: string): boolean {
  return status === "running" || status === "pending";
}

function isTerminalStatus(status: string): boolean {
  return status === "success" || status === "error" || status === "stopped" || status === "cancelled";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

class StdioJsonRpcTransport {
  #buffer = Buffer.alloc(0);
  #onMessage: ((message: JsonRpcRequest) => void) | undefined;

  onMessage(handler: (message: JsonRpcRequest) => void): void {
    this.#onMessage = handler;
  }

  async start(): Promise<void> {
    process.stdin.on("data", (chunk: Buffer | string) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      this.#buffer = Buffer.concat([this.#buffer, data]);
      this.#drain();
    });
    await new Promise<void>((resolveStart) => process.stdin.on("end", () => resolveStart()));
  }

  respond(message: unknown): void {
    const body = JSON.stringify(message);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  #drain(): void {
    for (;;) {
      const headerEnd = findHeaderEnd(this.#buffer);
      if (headerEnd < 0) return;
      const header = this.#buffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/content-length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.#buffer = Buffer.alloc(0);
        return;
      }
      const bodyStart = headerEnd + headerSeparatorLength(this.#buffer, headerEnd);
      const length = Number.parseInt(lengthMatch[1], 10);
      if (this.#buffer.length < bodyStart + length) return;
      const rawBody = this.#buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(bodyStart + length);
      const parsed = JSON.parse(rawBody) as JsonRpcRequest;
      this.#onMessage?.(parsed);
    }
  }
}

function findHeaderEnd(buffer: Buffer): number {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf >= 0) return crlf;
  return buffer.indexOf("\n\n");
}

function headerSeparatorLength(buffer: Buffer, headerEnd: number): number {
  return buffer.subarray(headerEnd, headerEnd + 4).toString("utf8") === "\r\n\r\n" ? 4 : 2;
}
