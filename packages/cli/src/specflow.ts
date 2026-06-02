#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  executeAgentFlowDoc,
  assertCliRunnableAgentFlow,
  assertServerRunnableAgentFlow,
  inspectAgentServerAuthentication,
  listAgentServers,
  loadAgentFlowFile,
  prepareCanvasRun,
  startSpecflowServer,
  type AgentFlowDoc,
  type RunInputVariable,
} from "@specflow/server";
import { StdinLineReader } from "./stdin-lines";
import { formatSpecflowVersion, isVersionCommand } from "./version";

type AgentAuthenticationStatus = Awaited<ReturnType<typeof inspectAgentServerAuthentication>>;

interface RunCliOptions {
  file: string;
  yes: boolean;
  values: Record<string, string>;
}

let stdinLineReader: StdinLineReader | undefined;

export async function main(args = Bun.argv.slice(2)): Promise<void> {
  if (isVersionCommand(args)) {
    console.log(await formatSpecflowVersion());
  } else if (args[0] === "run") {
    await runWorkflowCommand(args.slice(1));
  } else if (args[0] === "validate") {
    await validateWorkflowCommand(args.slice(1));
  } else {
    await serveCommand();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function serveCommand(): Promise<void> {
  const server = await startSpecflowServer();
  let stopping = false;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nStopping Specflow (${signal})...`);
    server.stop();
    process.exit(0);
  };

  process.once("SIGINT",  () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP",  () => stop("SIGHUP"));
  process.once("exit",    () => {
    if (!stopping) server.stop();
  });

  await new Promise<void>(() => {
    // Keep the CLI process alive until a signal arrives.
  });
}

async function runWorkflowCommand(args: string[]): Promise<void> {
  const options = parseRunArgs(args);
  const filePath = resolve(process.cwd(), options.file);
  const canvasDocument = await loadAgentFlowFile(filePath);
  assertCliRunnableAgentFlow(canvasDocument);
  const normalizedValues = normalizeVariableValues(canvasDocument, options.values);
  const prepared = prepareCanvasRun(canvasDocument, {
    variableValues: normalizedValues,
  });

  printRunPlan(filePath, canvasDocument, prepared.variables);

  if (prepared.missingVariables.length > 0) {
    console.log("\nMissing required variables:");
    for (const variable of prepared.missingVariables) {
      console.log(`  - ${displayInputName(variable.name)}${variable.description ? ` (${variable.description})` : ""}`);
    }
    console.log("\nPass them with -Dname=value, for example: -Dvalue=1");
    process.exitCode = 2;
    return;
  }

  const authStatuses = await inspectWorkflowAuthentication(prepared.doc);
  const requiredAuth = authStatuses.filter((status) => status.needsAuth);
  if (requiredAuth.length > 0) {
    printAuthRequired(requiredAuth);
    process.exitCode = 2;
    return;
  }

  if (!options.yes) {
    const confirmed = await confirm("Run this workflow?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  console.log("\nStarting run...");
  const nodeTitles = new Map(
    prepared.doc.nodes
      .filter((node) => node.kind === "step" || node.kind === "gate")
      .map((node) => [node.id, `${node.alias} ${node.title}`]),
  );

  const run = await executeAgentFlowDoc({
    doc: prepared.doc,
    initialInput: "",
    cwd: process.cwd(),
    onRunStatus(event) {
      if (event.status === "failed" && event.error) {
        console.log(`Run failed: ${event.error}`);
      }
    },
    onNodeStatus(event) {
      const label = nodeTitles.get(event.nodeId) ?? event.nodeId;
      if (event.status === "running") {
        console.log(`-> ${label}`);
      } else if (event.status === "done") {
        console.log(`OK ${label}`);
        if (event.output) console.log(indentBlock("output", event.output));
      } else if (event.status === "failed") {
        console.log(`FAIL ${label}`);
      }
    },
  });

  console.log(`\nRun ${run.status}: ${run.id}`);
  const failed = run.nodeRuns.filter((nodeRun) => nodeRun.status === "failed");
  for (const nodeRun of failed) {
    console.log(`\n[failed] ${nodeTitles.get(nodeRun.nodeId) ?? nodeRun.nodeId}`);
    if (nodeRun.error) console.log(indentBlock("error", nodeRun.error));
  }

  if (run.status !== "done") process.exitCode = 1;
}

async function validateWorkflowCommand(args: string[]): Promise<void> {
  const file = parseValidateArgs(args);
  const filePath = resolve(process.cwd(), file);
  const canvasDocument = await loadAgentFlowFile(filePath);
  assertServerRunnableAgentFlow(canvasDocument, new Map((await listAgentServers(process.cwd())).map((entry) => [entry.id, entry])));
  console.log(`OK ${filePath}`);
}

export function parseRunArgs(args: string[]): RunCliOptions {
  let file = "";
  let assumeYes = false;
  const values: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-y" || argument === "--yes") {
      assumeYes = true;
      continue;
    }
    if (argument === "-D") {
      assignDefine(values, args[++index] ?? "");
      continue;
    }
    if (argument.startsWith("-D")) {
      assignDefine(values, argument.slice(2));
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    if (!file) {
      file = argument;
      continue;
    }
    throw new Error(`Unexpected argument: ${argument}`);
  }

  if (!file) {
    printRunUsage();
    process.exit(2);
  }

  return { file, yes: assumeYes, values };
}

export function parseValidateArgs(args: string[]): string {
  let file = "";
  for (const argument of args) {
    if (argument.startsWith("-")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    if (!file) {
      file = argument;
      continue;
    }
    throw new Error(`Unexpected argument: ${argument}`);
  }
  if (!file) {
    printValidateUsage();
    process.exit(2);
  }
  return file;
}

function assignDefine(target: Record<string, string>, rawValue: string): void {
  const equalsIndex = rawValue.indexOf("=");
  if (equalsIndex <= 0) throw new Error(`Invalid -D value "${rawValue}". Expected -Dname=value.`);
  target[rawValue.slice(0, equalsIndex)] = rawValue.slice(equalsIndex + 1);
}

export function normalizeVariableValues(canvasDocument: AgentFlowDoc, values: Record<string, string>): Record<string, string> {
  const names = new Set(canvasDocument.nodes.filter((node) => node.kind === "input").map((node) => node.variableName));
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const fullKey = key.startsWith("specflow_") ? key : `specflow_${key}`;
    if (!names.has(fullKey)) {
      const available = [...names].map((name) => `  - ${displayInputName(name)}`).join("\n");
      throw new Error([
        `Unknown input: ${displayInputName(key)}`,
        available ? `Available inputs:\n${available}` : "Available inputs: none",
      ].join("\n"));
    }
    normalized[fullKey] = value;
  }
  return normalized;
}

function displayInputName(name: string): string {
  return name.startsWith("specflow_") ? name.slice("specflow_".length) : name;
}

function printRunPlan(filePath: string, canvasDocument: AgentFlowDoc, variables: RunInputVariable[]): void {
  const runtimeNodes = canvasDocument.nodes.filter((node) => node.kind === "step" || node.kind === "gate");
  console.log(`Workflow: ${canvasDocument.name} (${canvasDocument.id})`);
  console.log(`File: ${filePath}`);
  console.log(`Sessions: ${canvasDocument.sessions.length}`);
  for (const session of canvasDocument.sessions) {
    console.log(`  - ${session.name} [${session.agentServerId ?? session.agent ?? "unconfigured"}]`);
  }
  console.log(`Nodes: ${runtimeNodes.length}`);
  for (const node of runtimeNodes) {
    console.log(`  - ${node.alias} ${node.title} (${node.kind})`);
  }

  if (variables.length > 0) {
    console.log("Variables:");
    for (const variable of variables) {
      const shown = variable.value === "" ? "<empty>" : variable.value;
      console.log(`  - ${displayInputName(variable.name)} = ${shown} (${variable.source})`);
    }
  } else {
    console.log("Variables: none");
  }
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`\n${question} [y/N] `);
  const line = await readStdinLine();
  return line.trim().toLowerCase() === "y" || line.trim().toLowerCase() === "yes";
}

async function readStdinLine(): Promise<string> {
  stdinLineReader ??= new StdinLineReader(Bun.stdin.stream());
  return stdinLineReader.readLine();
}

function indentBlock(label: string, value: string): string {
  return `  ${label}:\n${value.split("\n").map((line) => `    ${line}`).join("\n")}`;
}

function printRunUsage(): void {
  console.error("Usage: specflow run <agentflow.yaml> [-Dname=value ...] [--yes]");
}

function printValidateUsage(): void {
  console.error("Usage: specflow validate <agentflow.yaml>");
}

async function inspectWorkflowAuthentication(canvasDocument: AgentFlowDoc): Promise<AgentAuthenticationStatus[]> {
  const servers = new Map((await listAgentServers(process.cwd())).map((entry) => [entry.id, entry]));
  const agentServerIds = [...new Set(canvasDocument.sessions
    .map((session) => session.agentServerId ?? session.agent)
    .filter((id): id is string => Boolean(id) && id !== "unconfigured"))];
  return Promise.all(agentServerIds
    .filter((id) => servers.get(id)?.settings.type !== "headless")
    .map((id) => inspectAgentServerAuthentication(process.cwd(), id)));
}

function printAuthRequired(statuses: AgentAuthenticationStatus[]): void {
  console.log("\nAgent authentication required:");
  for (const status of statuses) {
    console.log(`  - ${status.agentServerId}`);
    if (status.methods.length === 0) {
      console.log("    No ACP auth methods advertised.");
      continue;
    }
    for (const method of status.methods) {
      console.log(`    * ${method.name} [${method.type}]`);
      if (method.type === "env_var" && method.missingVars.length > 0) {
        console.log(`      Missing env: ${method.missingVars.join(", ")}`);
      }
    }
  }
  console.log("\nEdit .aflow/.specflow/agent-servers.local.json for env vars, or start Specflow and authenticate from the UI.");
}
