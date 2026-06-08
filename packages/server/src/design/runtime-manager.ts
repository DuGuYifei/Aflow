import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { assertSupportedReactNodeVersion, type NodeVersionReader } from "./node-version";
import { defaultReactDevCommand, loadDesignProjectConfig, patchDesignProjectConfig } from "./project-config";
import { loadDesignProject } from "./projects";
import type { DesignProjectDevCommand, DesignProjectSummary, DesignRuntimeState } from "./types";

const PREVIEW_PORT_START = 6200;
const PREVIEW_PORT_LIMIT = 200;
const RUNTIME_READY_TIMEOUT_MS = 10_000;
const RUNTIME_READY_INTERVAL_MS = 250;
const OUTPUT_TAIL_LIMIT = 8000;

interface RuntimeRecord {
  projectName: string;
  process?: Bun.Subprocess;
  stopping: boolean;
  output: string;
  state: DesignRuntimeState;
}

interface DesignRuntimeManagerOptions {
  readNodeVersion?: NodeVersionReader;
}

const runtimeManagers = new Map<string, DesignRuntimeManager>();

export function designRuntimeManagerForRoot(root: string): DesignRuntimeManager {
  let manager = runtimeManagers.get(root);
  if (!manager) {
    manager = new DesignRuntimeManager(root);
    runtimeManagers.set(root, manager);
  }
  return manager;
}

export async function stopDesignRuntimeManagers(root?: string): Promise<void> {
  const entries = root ? [[root, runtimeManagers.get(root)] as const] : Array.from(runtimeManagers.entries());
  await Promise.all(entries.map(async ([key, manager]) => {
    if (!manager) return;
    await manager.stopAll();
    runtimeManagers.delete(key);
  }));
}

export class DesignRuntimeManager {
  readonly #root: string;
  readonly #records = new Map<string, RuntimeRecord>();
  readonly #readNodeVersion?: NodeVersionReader;

  constructor(root: string, options: DesignRuntimeManagerOptions = {}) {
    this.#root = root;
    this.#readNodeVersion = options.readNodeVersion;
  }

  runtimeState(project: DesignProjectSummary): DesignRuntimeState | undefined {
    if (project.kind !== "react") return undefined;
    const record = this.#records.get(project.name);
    if (!record) return {
      kind: "react",
      status: "stopped",
    };
    this.#syncExited(record);
    return record.state;
  }

  async status(projectName: string): Promise<DesignRuntimeState> {
    const project = await loadDesignProject(this.#root, projectName);
    return this.#stateForProject(project);
  }

  async start(projectName: string): Promise<DesignRuntimeState> {
    const project = await loadDesignProject(this.#root, projectName);
    this.#assertReactProject(project);
    await assertSupportedReactNodeVersion(project.path, "run", this.#readNodeVersion);
    await this.stop(project.name);
    const configuredCommand = (await loadDesignProjectConfig(project.path)).devCommand ?? defaultReactDevCommand();
    await installReactDependenciesIfNeeded(project.path, configuredCommand);
    const port = await findAvailablePort();
    const startedAt = new Date().toISOString();
    const command = expandedCommand(configuredCommand, port);
    const record: RuntimeRecord = {
      projectName: project.name,
      stopping: false,
      output: "",
      state: {
        kind: "react",
        status: "starting",
        port,
        url: previewUrl(port),
        startedAt,
        command,
      },
    };
    this.#records.set(project.name, record);
    await patchDesignProjectConfig(project.path, (config) => ({
      ...config,
      lastRuntime: { port, startedAt },
    }));

    try {
      const child = Bun.spawn([command.command, ...command.args], {
        cwd: project.path,
        env: { ...process.env, BROWSER: "none" },
        stdout: "pipe",
        stderr: "pipe",
      });
      record.process = child;
      this.#collectOutput(record, child.stdout);
      this.#collectOutput(record, child.stderr);
      void child.exited.then((exitCode) => {
        if (record.stopping) return;
        record.state = {
          ...record.state,
          status: exitCode === 0 ? "stopped" : "failed",
          stoppedAt: new Date().toISOString(),
          ...(exitCode === 0 ? {} : { error: `React preview exited with code ${exitCode}.`, outputTail: outputTail(record.output) }),
        };
      }).catch((error) => {
        if (record.stopping) return;
        record.state = {
          ...record.state,
          status: "failed",
          stoppedAt: new Date().toISOString(),
          error: errorMessage(error),
          outputTail: outputTail(record.output),
        };
      });
    } catch (error) {
      record.state = {
        ...record.state,
        status: "failed",
        stoppedAt: new Date().toISOString(),
        error: errorMessage(error),
        outputTail: outputTail(record.output),
      };
      return record.state;
    }

    if (await waitForRuntime(record.state.url ?? "")) {
      record.state = { ...record.state, status: "running" };
    } else if (record.process.exitCode !== null) {
      record.state = {
        ...record.state,
        status: "failed",
        stoppedAt: new Date().toISOString(),
        error: `React preview failed to start on port ${port}.`,
        outputTail: outputTail(record.output),
      };
    }
    return record.state;
  }

  async restart(projectName: string): Promise<DesignRuntimeState> {
    await this.stop(projectName);
    return this.start(projectName);
  }

  async stop(projectName: string): Promise<DesignRuntimeState> {
    const project = await loadDesignProject(this.#root, projectName);
    const record = this.#records.get(project.name);
    if (!record) return this.#stateForProject(project);
    const stoppedAt = new Date().toISOString();
    record.stopping = true;
    if (record.process?.exitCode === null) record.process.kill();
    record.state = {
      ...record.state,
      status: "stopped",
      stoppedAt,
      outputTail: outputTail(record.output),
    };
    await patchDesignProjectConfig(project.path, (config) => ({
      ...config,
      lastRuntime: {
        ...(config.lastRuntime ?? {}),
        stoppedAt,
      },
    }));
    this.#records.delete(project.name);
    return {
      kind: project.kind,
      status: "stopped",
      stoppedAt,
    };
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.#records.keys()).map((projectName) => this.stop(projectName).catch(() => undefined)));
  }

  #stateForProject(project: DesignProjectSummary): DesignRuntimeState {
    if (project.kind !== "react") return { kind: project.kind, status: "stopped" };
    return this.runtimeState(project) ?? { kind: "react", status: "stopped" };
  }

  #assertReactProject(project: DesignProjectSummary): void {
    if (project.kind !== "react") throw httpError(400, `Design project is not a React project: ${project.name}`);
  }

  #syncExited(record: RuntimeRecord): void {
    if (!record.process || record.process.exitCode === null || record.state.status === "failed" || record.state.status === "stopped") return;
    record.state = {
      ...record.state,
      status: record.process.exitCode === 0 ? "stopped" : "failed",
      stoppedAt: new Date().toISOString(),
      ...(record.process.exitCode === 0 ? {} : { error: `React preview exited with code ${record.process.exitCode}.`, outputTail: outputTail(record.output) }),
    };
  }

  async #collectOutput(record: RuntimeRecord, stream: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!stream) return;
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        record.output = outputTail(record.output + decoder.decode(value, { stream: true }));
      }
    } catch {
      return;
    }
  }
}

async function installReactDependenciesIfNeeded(projectPath: string, devCommand: DesignProjectDevCommand): Promise<void> {
  if (!await pathExists(join(projectPath, "package.json"))) return;
  if (await pathExists(join(projectPath, "node_modules"))) return;
  const installCommand = installCommandForDevCommand(devCommand);
  const command = Bun.spawn([installCommand.command, ...installCommand.args], {
    cwd: projectPath,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    command.exited,
    streamText(command.stdout),
    streamText(command.stderr),
  ]);
  if (exitCode !== 0) {
    throw httpError(502, `Failed to install React preview dependencies.\n${outputTail(`${stdout}\n${stderr}`)}`);
  }
}

function installCommandForDevCommand(devCommand: DesignProjectDevCommand): DesignProjectDevCommand {
  if (devCommand.command === "bun") return { command: "bun", args: ["install"] };
  if (devCommand.command === "pnpm") return { command: "pnpm", args: ["install"] };
  if (devCommand.command === "yarn") return { command: "yarn", args: ["install"] };
  return { command: "npm", args: ["install"] };
}

async function findAvailablePort(): Promise<number> {
  for (let port = PREVIEW_PORT_START; port < PREVIEW_PORT_START + PREVIEW_PORT_LIMIT; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw httpError(409, `No available React preview port found starting at ${PREVIEW_PORT_START}.`);
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function waitForRuntime(url: string): Promise<boolean> {
  if (!url) return false;
  const deadline = Date.now() + RUNTIME_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await runtimeResponds(url)) return true;
    await Bun.sleep(RUNTIME_READY_INTERVAL_MS);
  }
  return false;
}

async function runtimeResponds(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function expandedCommand(command: DesignProjectDevCommand, port: number): DesignProjectDevCommand {
  return {
    command: command.command,
    args: command.args.map((arg) => arg.replace(/\{port\}/g, String(port))),
  };
}

function previewUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function outputTail(value: string): string {
  return value.length > OUTPUT_TAIL_LIMIT ? value.slice(value.length - OUTPUT_TAIL_LIMIT) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}
