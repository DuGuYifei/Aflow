import { AgentServerStore } from "@specflow/agent-proxy";
import { createSpecflowBridge } from "@specflow/bridge";
import { APP_NAME, DEFAULT_HOST, SERVER_PORT, uuidv7 } from "@specflow/shared";
import { serveStaticUi } from "./static-ui";
import { SkillStore, resolveSlashCommands } from "./skills";
import { createApiHandler } from "./api";
import { createDesignApiHandler } from "./design/api";
import { stopDesignRuntimeManagers } from "./design/runtime-manager";

export interface SpecflowServerOptions {
  host?: string;
  port?: number;
}

export interface RunningSpecflowServer {
  url: string;
  stop(): void;
}

export async function startSpecflowServer(
  options: SpecflowServerOptions = {},
): Promise<RunningSpecflowServer> {
  const workingDirectory = process.cwd();

  const host = options.host ?? DEFAULT_HOST;
  const preferredPort = options.port ?? SERVER_PORT;
  const serverId = uuidv7();
  const skillStore = new SkillStore({ root: workingDirectory });
  const capabilityStore = new AgentServerStore({ root: workingDirectory });
  const bridge = createSpecflowBridge({
    promptTransformer: async (prompt, context) => {
      // Skip the work if there are no `/` candidates at all — keeps the hot
      // path zero-allocation when no slash commands are present.
      if (!prompt.includes("/")) return prompt;
      const [skills, capabilities] = await Promise.all([
        skillStore.list(),
        capabilityStore.getCapabilities(context.agentServerId),
      ]);
      const resolved = resolveSlashCommands({
        prompt,
        skills,
        availableCommands: capabilities?.availableCommands,
      });
      return resolved.prompt;
    },
  });
  const handleApi = createApiHandler(bridge, workingDirectory);
  const handleDesignApi = createDesignApiHandler(workingDirectory);

  const server = startHttpServer({
    bridge,
    host,
    preferredPort,
    handleApi,
    handleDesignApi,
    serverId,
    workspaceRoot: workingDirectory,
  });

  const url = `http://${host}:${server.port}/`;
  console.log(`${APP_NAME} UI: ${url}`);

  return {
    url,
    stop() {
      void stopDesignRuntimeManagers(workingDirectory);
      server.stop();
    },
  };
}

interface HttpServerOptions {
  bridge: ReturnType<typeof createSpecflowBridge>;
  host: string;
  preferredPort: number;
  handleApi: (request: Request) => Promise<Response | null>;
  handleDesignApi: (request: Request) => Promise<Response | null>;
  serverId: string;
  workspaceRoot: string;
}

function startHttpServer({
  bridge,
  host,
  preferredPort,
  handleApi,
  handleDesignApi,
  serverId,
  workspaceRoot,
}: HttpServerOptions) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    try {
      return Bun.serve({
        hostname: host,
        port,
        reusePort: false,
        async fetch(request, server) {
          const url = new URL(request.url);

          if (url.pathname === "/api/health") {
            return Response.json({
              app: APP_NAME,
              ok: true,
              sessions: bridge.sessions.list().length,
              startedAt: bridge.runtime.startedAt.toISOString(),
              workspaceRoot,
              serverId,
              apiVersion: 1,
            });
          }

          const apiResponse = await handleApi(request);
          if (apiResponse) {
            if (apiResponse.headers.get("content-type")?.startsWith("text/event-stream")) {
              server.timeout(request, 0);
            }
            return apiResponse;
          }

          const designApiResponse = await handleDesignApi(request);
          if (designApiResponse) {
            if (designApiResponse.headers.get("content-type")?.startsWith("text/event-stream")) {
              server.timeout(request, 0);
            }
            return designApiResponse;
          }

          return serveStaticUi(request);
        },
      });
    } catch (error) {
      if (port === preferredPort + 19) {
        throw error;
      }
    }
  }

  throw new Error("Unable to start the Specflow server.");
}
