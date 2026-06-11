const REACT_NODE_MIN_MAJOR = 20;
const REACT_NODE_MIN_MINOR = 19;
const REACT_NODE_ALT_MAJOR = 22;
const REACT_NODE_ALT_MINOR = 12;

export const REACT_NODE_VERSION_RANGE = "^20.19.0 || >=22.12.0";

export type NodeVersionReader = (cwd: string) => Promise<string>;

interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export async function assertSupportedReactNodeVersion(
  cwd: string,
  action: "create" | "run",
  readNodeVersion: NodeVersionReader = readNodeVersionFromCommand,
): Promise<string> {
  let output = "";
  try {
    output = await readNodeVersion(cwd);
  } catch {
    throw httpError(400, action === "create"
      ? "当前电脑未检测到 Node.js，无法创建 React Designer project。"
      : "当前电脑未检测到 Node.js，无法启动 React Designer project runtime。");
  }

  const version = parseNodeVersion(output);
  if (!version || !isSupportedReactNodeVersion(version)) {
    const current = version?.raw || output.trim() || "unknown";
    throw httpError(400, `当前 Node.js 版本过低，React Designer project 需要 Node ${REACT_NODE_VERSION_RANGE}，当前版本为 ${current}。`);
  }
  return version.raw;
}

export function parseNodeVersion(output: string): NodeVersion | undefined {
  const match = output.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0].startsWith("v") ? match[0] : `v${match[0]}`,
  };
}

export function isSupportedReactNodeVersion(version: NodeVersion): boolean {
  if (version.major === REACT_NODE_MIN_MAJOR) {
    return version.minor >= REACT_NODE_MIN_MINOR;
  }
  if (version.major === REACT_NODE_ALT_MAJOR) {
    return version.minor >= REACT_NODE_ALT_MINOR;
  }
  return version.major > REACT_NODE_ALT_MAJOR;
}

async function readNodeVersionFromCommand(cwd: string): Promise<string> {
  const process = Bun.spawn(["node", "--version"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    streamText(process.stdout),
    streamText(process.stderr),
  ]);
  if (exitCode !== 0) throw new Error(stderr || stdout || `node --version exited with code ${exitCode}`);
  return stdout || stderr;
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}
