import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

class FakeAgent implements acp.Agent {
  readonly #connection: acp.AgentSideConnection;
  readonly #sessions = new Map<string, { promptCount: number }>();

  constructor(connection: acp.AgentSideConnection) {
    this.#connection = connection;
  }

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        sessionCapabilities: {
          close: {},
        },
      },
    };
  }

  async authenticate(): Promise<acp.AuthenticateResponse> {
    return {};
  }

  async newSession(): Promise<acp.NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    this.#sessions.set(sessionId, { promptCount: 0 });
    return {
      sessionId,
      modes: {
        currentModeId: "auto",
        availableModes: [{ id: "auto", name: "Auto" }],
      },
      models: {
        currentModelId: "test-model",
        availableModels: [{ modelId: "test-model", name: "Test Model" }],
      },
      configOptions: [
        {
          id: "reasoning",
          name: "Reasoning",
          type: "select",
          currentValue: "medium",
          options: [{ value: "high", name: "High" }],
        },
      ],
    };
  }

  async setSessionMode(): Promise<acp.SetSessionModeResponse> {
    return {};
  }

  async unstable_setSessionModel(): Promise<acp.SetSessionModelResponse> {
    return {};
  }

  async setSessionConfigOption(): Promise<acp.SetSessionConfigOptionResponse> {
    return { configOptions: [] };
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const sessionId = params.sessionId;
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    session.promptCount += 1;
    const text = params.prompt.find((block) => block.type === "text")?.text ?? "";

    await this.#sendText(sessionId, `turn:${session.promptCount}\n`);
    await this.#sendText(sessionId, `prompt:${text}\n`);

    const file = await this.#connection.readTextFile({
      sessionId,
      path: `${process.cwd()}/input.txt`,
    });
    await this.#sendText(sessionId, `file:${file.content}\n`);

    await this.#connection.writeTextFile({
      sessionId,
      path: `${process.cwd()}/out.txt`,
      content: "written-by-agent",
    });

    const terminal = await this.#connection.createTerminal({
      sessionId,
      command: process.execPath,
      args: ["-e", "process.stdout.write('terminal-output')"],
    });
    await terminal.waitForExit();
    const terminalOutput = await terminal.currentOutput();
    await terminal.release();
    await this.#sendText(sessionId, `terminal:${terminalOutput.output}\n`);

    const permission = await this.#connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: "permission-1",
        title: "Edit file",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });
    await this.#sendText(
      sessionId,
      `permission:${permission.outcome.outcome === "selected" ? permission.outcome.optionId : "cancelled"}\n`,
    );

    return { stopReason: "end_turn" };
  }

  async cancel(): Promise<void> {}

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    this.#sessions.delete(params.sessionId);
    return {};
  }

  async #sendText(sessionId: string, text: string): Promise<void> {
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
);

new acp.AgentSideConnection((connection) => new FakeAgent(connection), stream);
