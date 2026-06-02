import type { AgentServerEntry } from "@specflow/agent-proxy";

export type NativeResumeStatus = "resume" | "continue" | "selector" | "acp-only" | "custom-unverified" | "unknown" | "unsupported";

export interface NativeAgentAdapter {
  id: string;
  displayName: string;
  aliases: string[];
  status: NativeResumeStatus;
  command?: string;
  args?: string[];
  argsWithoutSession?: string[];
  requiresSessionId?: boolean;
  caveat?: string;
}

export interface NativeResumeRecommendation {
  adapter: NativeAgentAdapter;
  status: NativeResumeStatus;
  command: string;
  args: string[];
  displayCommand: string;
  caveat?: string;
}

export interface NativeResumeInput {
  agentServer?: AgentServerEntry;
  agentServerId?: string;
  registryId?: string;
  acpSessionId?: string;
  nativeSessionId?: string;
}

export const NATIVE_AGENT_ADAPTERS: NativeAgentAdapter[] = [
  resumeAdapter("amp", "Amp", ["amp", "amp-acp"], "amp", ["threads", "continue", "{sessionId}"], {
    requiresSessionId: true,
    caveat: "Amp uses thread ids; ACP session ids may not be native thread ids.",
  }),
  resumeAdapter("auggie", "Auggie", ["auggie"], "auggie", ["--resume", "{sessionId}"], {
    argsWithoutSession: ["session", "resume"],
  }),
  resumeAdapter("autohand", "Autohand", ["autohand"], "autohand", ["resume", "{sessionId}"], {
    requiresSessionId: true,
  }),
  resumeAdapter("claude", "Claude", ["claude", "claude-acp"], "claude", ["--resume", "{sessionId}"], {
    argsWithoutSession: ["--resume"],
    caveat: "Claude can open an interactive resume selector when no session id is supplied.",
  }),
  resumeAdapter("cline", "Cline", ["cline"], "cline", ["--id", "{sessionId}"], {
    requiresSessionId: true,
  }),
  resumeAdapter("codebuddy", "Codebuddy", ["codebuddy"], "codebuddy", ["--resume", "{sessionId}"]),
  resumeAdapter("codex", "Codex", ["codex", "codex-acp"], "codex", ["resume", "{sessionId}"], {
    argsWithoutSession: ["resume"],
  }),
  resumeAdapter("cortex", "Cortex", ["cortex"], "cortex", ["--resume", "{sessionId}"]),
  resumeAdapter("cursor", "Cursor Agent", ["cursor", "cursor-agent"], "cursor-agent", ["--resume", "{sessionId}"], {
    argsWithoutSession: ["resume"],
    caveat: "Cursor thread ids may differ from ACP session ids.",
  }),
  resumeAdapter("deepagents", "DeepAgents", ["deepagents", "dcode"], "dcode", ["--resume", "{sessionId}"]),
  resumeAdapter("dimcode", "DimCode", ["dimcode", "dim"], "dim", ["exec", "resume", "{sessionId}"], {
    argsWithoutSession: ["exec", "resume", "--last"],
  }),
  resumeAdapter("factory-droid", "Factory Droid", ["factory-droid", "droid"], "droid", ["--resume", "{sessionId}"]),
  resumeAdapter("fast-agent", "fast-agent", ["fast-agent"], "fast-agent", ["go", "--resume", "{sessionId}"], {
    argsWithoutSession: ["go", "--resume", "latest"],
  }),
  resumeAdapter("gemini", "Gemini CLI", ["gemini"], "gemini", ["--resume", "{sessionId}"], {
    argsWithoutSession: ["--resume"],
  }),
  resumeAdapter("github-copilot", "GitHub Copilot", ["github-copilot", "copilot"], "copilot", ["--resume={sessionId}"], {
    argsWithoutSession: ["--resume"],
  }),
  statusAdapter("glm", "GLM", ["glm"], "acp-only", "Registry research only found ACP continuation, not a native CLI resume command."),
  resumeAdapter("goose", "Goose", ["goose"], "goose", ["session", "--resume", "{sessionId}"], {
    requiresSessionId: true,
  }),
  resumeAdapter("grok", "Grok", ["grok"], "grok", ["--resume", "{sessionId}"]),
  resumeAdapter("junie", "Junie", ["junie"], "junie", ["--session-id", "{sessionId}"], {
    requiresSessionId: true,
    caveat: "Junie also exposes /history inside its native TUI.",
  }),
  resumeAdapter("kilo", "Kilo", ["kilo"], "kilo", ["--continue", "{sessionId}"]),
  resumeAdapter("kimi", "Kimi", ["kimi"], "kimi", ["--resume", "{sessionId}"]),
  resumeAdapter("minion", "Minion", ["minion", "minion-code"], "minion-code", ["main", "--resume", "{sessionId}"]),
  resumeAdapter("mistral-vibe", "Mistral Vibe", ["mistral-vibe", "vibe"], "vibe", ["--resume", "{sessionId}"]),
  resumeAdapter("nova", "Nova", ["nova"], "nova", ["start", "--continue", "{sessionId}"]),
  resumeAdapter("opencode", "OpenCode", ["opencode"], "opencode", ["--session", "{sessionId}"], {
    argsWithoutSession: ["--continue"],
    caveat: "OpenCode supports both --continue and --session; prefer a known native session id when available.",
  }),
  statusAdapter("pi", "Pi", ["pi", "pi-coding-agent"], "acp-only", "Pi exposes resume inside Pi itself; Aflow already runs on Pi SDK."),
  resumeAdapter("poolside", "Poolside", ["poolside", "pool"], "pool", ["--resume", "{sessionId}"]),
  resumeAdapter("qoder", "Qoder", ["qoder", "qodercli"], "qodercli", ["--resume", "{sessionId}"]),
  resumeAdapter("qwen", "Qwen Code", ["qwen", "qwen-code"], "qwen", ["--resume", "{sessionId}"]),
  resumeAdapter("stakpak", "Stakpak", ["stakpak"], "stakpak", ["-c", "{sessionId}"], {
    requiresSessionId: true,
    caveat: "Stakpak resumes checkpoints; the id must be a checkpoint id.",
  }),
  resumeAdapter("vtcode", "VT Code", ["vtcode", "vt-code"], "vtcode", ["--resume", "{sessionId}"]),
  statusAdapter("agoragentic", "Agoragentic", ["agoragentic"], "unknown"),
  statusAdapter("dirac", "Dirac", ["dirac"], "selector", "Registry research found history selection, not a direct resume command."),
  statusAdapter("sigit", "siGit", ["sigit"], "unknown"),
];

const ADAPTERS_BY_ALIAS = new Map<string, NativeAgentAdapter>(
  NATIVE_AGENT_ADAPTERS.flatMap((adapter) => [
    [adapter.id, adapter],
    ...adapter.aliases.map((alias) => [alias, adapter] as const),
  ]),
);

export function getNativeAgentAdapter(value: string | undefined): NativeAgentAdapter | undefined {
  if (!value) return undefined;
  return ADAPTERS_BY_ALIAS.get(normalizeAlias(value));
}

export function buildNativeResumeRecommendation(input: NativeResumeInput): NativeResumeRecommendation | undefined {
  if (input.agentServer?.settings.type === "custom") {
    return {
      adapter: {
        id: input.agentServer.id,
        displayName: input.agentServer.id,
        aliases: [input.agentServer.id],
        status: "custom-unverified",
        caveat: "This is a custom agent server. Aflow cannot verify its native resume semantics from the command name alone.",
      },
      status: "custom-unverified",
      command: "",
      args: [],
      displayCommand: "",
      caveat: "This is a custom agent server. Use ACP Resume/Inspect, or run your own native command with the recorded session ids.",
    };
  }

  const registryId = input.registryId ?? registryIdForAgentServer(input.agentServer);
  const adapter =
    getNativeAgentAdapter(registryId) ??
    getNativeAgentAdapter(input.agentServerId) ??
    getNativeAgentAdapter(input.agentServer?.id);

  if (!adapter) return undefined;
  if (!adapter.command || adapter.status === "acp-only" || adapter.status === "unknown" || adapter.status === "unsupported") {
    return {
      adapter,
      status: adapter.status,
      command: "",
      args: [],
      displayCommand: "",
      caveat: adapter.caveat,
    };
  }

  const sessionId = input.nativeSessionId ?? input.acpSessionId;
  if (!sessionId && adapter.requiresSessionId) {
    return {
      adapter,
      status: "unknown",
      command: adapter.command,
      args: [],
      displayCommand: "",
      caveat: `A native session id is required for ${adapter.displayName}.`,
    };
  }

  const args = renderArgs(sessionId ? adapter.args ?? [] : adapter.argsWithoutSession ?? adapter.args ?? [], sessionId);
  return {
    adapter,
    status: adapter.status,
    command: adapter.command,
    args,
    displayCommand: [adapter.command, ...args].map(shellDisplay).join(" "),
    caveat: adapter.caveat,
  };
}

function resumeAdapter(
  id: string,
  displayName: string,
  aliases: string[],
  command: string,
  args: string[],
  options: Partial<NativeAgentAdapter> = {},
): NativeAgentAdapter {
  return { id, displayName, aliases, status: "resume", command, args, ...options };
}

function statusAdapter(
  id: string,
  displayName: string,
  aliases: string[],
  status: NativeResumeStatus,
  caveat?: string,
): NativeAgentAdapter {
  return { id, displayName, aliases, status, caveat };
}

function renderArgs(args: string[], sessionId: string | undefined): string[] {
  return args.map((arg) => arg.replaceAll("{sessionId}", sessionId ?? ""));
}

function registryIdForAgentServer(agentServer: AgentServerEntry | undefined): string | undefined {
  if (!agentServer || agentServer.settings.type !== "registry") return undefined;
  return agentServer.settings.registryId;
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/_acp$/, "-acp").replace(/_/g, "-");
}

function shellDisplay(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
