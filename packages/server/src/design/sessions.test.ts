import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { AgentCommandRequest, AgentCommandResult } from "@specflow/agent-proxy";
import { initializeDesignSession, listDesignSessions, sendDesignMessage, type DesignAgentRunner } from "./sessions";

describe("design sessions", () => {
  test("initializes designer memory before user chat starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    const projectRoot = join(root, ".aflow/.specflow/design/projects/empty-start");
    await mkdir(projectRoot, { recursive: true });
    const requests: AgentCommandRequest[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      requests.push(request);
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: requests.length === 1 ? "我准备好了" : "Designed the page.",
        sessionId: "acp-empty-start",
      };
    };

    const initialized = await initializeDesignSession(root, {
      projectName: "empty-start",
      agentServerId: "codex-acp",
      modeId: "design",
      configOptions: { reasoning: "high" },
    }, { runner });

    expect(initialized.memoryInjected).toBe(true);
    expect(initialized.messages).toEqual([]);
    expect(initialized.logs?.some((entry) => entry.kind === "user_message")).toBe(false);
    expect(initialized.logs?.some((entry) => entry.kind === "timeline_snapshot")).toBe(true);

    const continued = await sendDesignMessage(root, {
      sessionId: initialized.id,
      projectName: "empty-start",
      agentServerId: "codex-acp",
      message: "Now design the dashboard.",
    }, { runner });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.restoreFromAcpSessionId).toBe("acp-empty-start");
    expect(continued.messages.map((message) => message.role)).toEqual(["user"]);
    expect(continued.logs?.filter((entry) => entry.kind === "user_message")).toHaveLength(1);
  });

  test("uses React-specific memory prompt for React projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    const projectRoot = join(root, ".aflow/.specflow/design/projects/react-app");
    await mkdir(join(projectRoot, ".aflow-design"), { recursive: true });
    await writeFile(join(projectRoot, ".aflow-design/project.json"), JSON.stringify({ kind: "react" }), "utf8");
    const prompts: string[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      prompts.push(request.prompt);
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: "我准备好了",
        sessionId: "acp-react",
      };
    };

    await initializeDesignSession(root, {
      projectName: "react-app",
      agentServerId: "codex-acp",
    }, { runner });

    expect(prompts[0]).toContain("React/Vite");
    expect(prompts[0]).toContain("Designer project 工作目录中的 Node/npm 环境");
    expect(prompts[0]).toContain("node --version");
    expect(prompts[0]).toContain("npm --version");
    expect(prompts[0]).toContain("package.json");
    expect(prompts[0]).toContain("src/aflow-design-bridge.ts");
    expect(prompts[0]).toContain("initializeAflowDesignBridge()");
    expect(prompts[0]).toContain("\"route\":\"/<route>\"");
    expect(prompts[0]).toContain("route:/<route>::xpath");
    expect(prompts[0]).toContain("根据用户需求决定需要哪些 route");
    expect(prompts[0]).not.toContain("/desktop");
    expect(prompts[0]).not.toContain("/mobile");
    expect(prompts[0]).not.toContain("designPath 必须");
    expect(prompts[0]).not.toContain("所有 frame HTML 文件都直接放在项目根目录");
  });

  test("adds React-specific reference guidance only for React projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    const referenceRoot = join(root, ".aflow/.specflow/design/references/react-ref");
    const projectRoot = join(root, ".aflow/.specflow/design/projects/react-reference");
    await mkdir(referenceRoot, { recursive: true });
    await mkdir(join(projectRoot, ".aflow-design"), { recursive: true });
    await writeFile(join(projectRoot, ".aflow-design/project.json"), JSON.stringify({ kind: "react" }), "utf8");
    const prompts: string[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      prompts.push(request.prompt);
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: "我准备好了",
        sessionId: "acp-react-reference",
      };
    };

    await initializeDesignSession(root, {
      projectName: "react-reference",
      agentServerId: "codex-acp",
      referenceName: "react-ref",
    }, { runner });

    expect(prompts[0]).toContain("当前 Designer project 是 React/Vite");
    expect(prompts[0]).toContain("组件拆分、命名习惯、样式组织、设计 token");
    expect(prompts[0]).toContain("不要整段复制 reference 代码");
  });

  test("injects selected reference context before the first user message", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    const referenceRoot = join(root, ".aflow/.specflow/design/references/app-ref");
    const projectRoot = join(root, ".aflow/.specflow/design/projects/billing");
    await mkdir(referenceRoot, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    const prompts: string[] = [];
    const requests: AgentCommandRequest[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      requests.push(request);
      prompts.push(request.prompt);
      if (prompts.length > 1) await writeProjectArtifact(projectRoot);
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: prompts.length === 1 ? "我准备好了" : "Updated desktop.html, desktop.md, and manifest.json.",
        sessionId: "acp-design",
      };
    };

    const session = await sendDesignMessage(root, {
      projectName: "billing",
      agentServerId: "codex-acp",
      message: "Design the settings page.",
      referenceName: "app-ref",
      referenceInterfaceDescription: "Billing settings page",
      modeId: "design",
      configOptions: { model: "gpt-5.5", reasoning: "high" },
    }, { runner });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("本次设计可使用以下 reference 仓库");
    expect(prompts[0]).toContain(referenceRoot);
    expect(prompts[0]).toContain("该仓库的界面描述：");
    expect(prompts[0]).toContain("Billing settings page");
    expect(prompts[0]).not.toContain("当前 Designer project 是 React/Vite。若 reference 仓库来自前端框架项目");
    expect(prompts[0]).toContain(projectRoot);
    expect(prompts[0]).toContain("只有当你判断用户是在要求生成、修改或更新设计画面时");
    expect(prompts[0]).toContain("manifest.json");
    expect(prompts[0]).toContain("desktop.html");
    expect(prompts[0]).not.toContain("component-tree.json");
    expect(prompts[0]).toContain("带 ?view=wireframe 时显示同一结构的线框图视图");
    expect(prompts[0]).toContain("descriptionPath");
    expect(prompts[0]).toContain("desktop.md");
    expect(prompts[0]).toContain("每次创建或修改某个 frame");
    expect(prompts[0]).toContain("优先把可调整视觉样式写入 styles.css");
    expect(prompts[0]).toContain("width/height 是该 frame 在画布中的预览 viewport 尺寸");
    expect(prompts[0]).toContain("标准 viewport meta");
    expect(prompts[0]).toContain("最高层页面容器必须使用 width:100%");
    expect(prompts[0]).toContain("不要把 manifest width 写成根容器的 CSS width");
    expect(prompts[0]).toContain("不要用 overflow-x:hidden 掩盖布局问题");
    expect(prompts[0]).toContain("默认在原 frame 中实现动效和交互");
    expect(prompts[0]).toContain("<visual_changes>");
    expect(prompts[1]).toContain("Design the settings page.");
    expect(prompts[1]).toContain("<reference-context>");
    expect(prompts[1]).toContain(referenceRoot);
    expect(prompts[1]).toContain("Billing settings page");
    expect(prompts[1]).not.toContain(projectRoot);
    expect(prompts[1]).not.toContain("manifest.json");
    expect(requests[0]?.cwd).toBe(root);
    expect(requests[1]?.cwd).toBe(root);
    expect(requests[0]?.additionalDirectories).toBeUndefined();
    expect(requests[1]?.additionalDirectories).toBeUndefined();
    expect(requests[0]?.modeId).toBe("design");
    expect(requests[1]?.modeId).toBe("design");
    expect(requests[0]?.configOptions).toEqual({ model: "gpt-5.5", reasoning: "high" });
    expect(requests[1]?.configOptions).toEqual({ model: "gpt-5.5", reasoning: "high" });
    expect(session.memoryInjected).toBe(true);
    expect(session.reference).toMatchObject({
      name: "app-ref",
      path: referenceRoot,
      interfaceDescription: "Billing settings page",
    });
    expect(session.project).toMatchObject({ name: "billing", path: projectRoot });
    expect(session.messages.map((message) => message.role)).toEqual(["user"]);
    expect(session.logs?.[0]).toMatchObject({
      kind: "user_message",
      text: "Design the settings page.",
    });
    expect(session.logs?.some((entry) => entry.kind === "assistant_delta")).toBe(false);
    expect(session.latestArtifact?.projectName).toBe("billing");
    expect(session.latestArtifact?.frames?.[0]).toMatchObject({
      id: "desktop",
      title: "Desktop",
      designPath: "desktop.html",
      descriptionPath: "desktop.md",
    });
    expect(await readFile(join(projectRoot, "desktop.html"), "utf8")).toContain("data-component-id=\"root\"");
    expect(await readFile(join(projectRoot, "desktop.md"), "utf8")).toContain("Design notes: A settings page.");

    expect(await listDesignSessions(root)).toEqual([expect.objectContaining({
      id: session.id,
      agentServerId: "codex-acp",
      projectName: "billing",
      title: "Design the settings page.",
      messageCount: 1,
    })]);
    expect(await listDesignSessions(root, "billing")).toHaveLength(1);
  });

  test("allows attaching different references per message", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    const firstReference = join(root, ".aflow/.specflow/design/references/first");
    const secondReference = join(root, ".aflow/.specflow/design/references/second");
    await mkdir(firstReference, { recursive: true });
    await mkdir(secondReference, { recursive: true });
    await mkdir(join(root, ".aflow/.specflow/design/projects/settings"), { recursive: true });

    const prompts: string[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      prompts.push(request.prompt);
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: request.prompt.includes("只回复“我准备好了”") ? "我准备好了" : "<html>ok</html>",
        sessionId: "acp-design",
      };
    };

    const session = await sendDesignMessage(root, {
      projectName: "settings",
      agentServerId: "codex-acp",
      message: "Design the first page.",
      referenceName: "first",
    }, { runner });

    const updated = await sendDesignMessage(root, {
      sessionId: session.id,
      projectName: "settings",
      agentServerId: "codex-acp",
      message: "Now use another reference.",
      referenceName: "second",
    }, { runner });

    expect(updated.reference).toMatchObject({ name: "second", path: secondReference });
    expect(prompts.at(-1)).toContain("<reference-context>");
    expect(prompts.at(-1)).toContain(secondReference);
  });

  test("injects slash skills before building the design execution prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    const projectRoot = join(root, ".aflow/.specflow/design/projects/slash");
    await mkdir(join(root, ".agents/skills/brief"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(root, ".agents/skills/brief/SKILL.md"), [
      "---",
      "name: brief",
      "description: Brief helper",
      "---",
      "",
      "Use concise product design notes.",
    ].join("\n"), "utf8");

    const prompts: string[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      prompts.push(request.prompt);
      if (prompts.length > 1) await writeProjectArtifact(projectRoot);
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: prompts.length === 1 ? "我准备好了" : "Updated project files.",
        sessionId: "acp-design",
      };
    };

    await sendDesignMessage(root, {
      projectName: "slash",
      agentServerId: "codex-acp",
      message: "/brief settings page",
    }, { runner });

    expect(prompts[1]).toContain('<skill name="brief" source="projectLocal">');
    expect(prompts[1]).toContain("Use concise product design notes.");
    expect(prompts[1]).toContain("<args>settings page</args>");
  });

  test("streams logs, forwards abort signal, and restores saved ACP sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-session-"));
    await mkdir(join(root, ".aflow/.specflow/design/projects/logs"), { recursive: true });
    const controller = new AbortController();
    const streamedLogs: string[] = [];
    const requests: AgentCommandRequest[] = [];
    const runner: DesignAgentRunner = async (request: AgentCommandRequest): Promise<AgentCommandResult> => {
      requests.push(request);
      request.onTerminalEvent?.({ stream: "system", chunk: `terminal-${requests.length}` });
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: requests.length === 1 ? "我准备好了" : `response-${requests.length}`,
        sessionId: "acp-design-log-session",
      };
    };

    const first = await sendDesignMessage(root, {
      projectName: "logs",
      agentServerId: "codex-acp",
      message: "Create the first frame.",
    }, {
      runner,
      signal: controller.signal,
      onLog: (entry) => streamedLogs.push(`${entry.kind}:${entry.kind === "terminal" ? entry.text : ""}`),
    });

    await sendDesignMessage(root, {
      sessionId: first.id,
      projectName: "logs",
      agentServerId: "codex-acp",
      message: "Continue the frame.",
    }, { runner });

    expect(requests).toHaveLength(3);
    expect(requests[0]?.signal).toBe(controller.signal);
    expect(requests[1]?.signal).toBe(controller.signal);
    expect(requests[2]?.restoreFromAcpSessionId).toBe("acp-design-log-session");
    expect(first.logs?.some((entry) => entry.kind === "terminal" && entry.text === "terminal-2")).toBe(true);
    expect(streamedLogs[0]).toBe("user_message:");
    expect(streamedLogs.some((entry) => entry.startsWith("prompt:"))).toBe(false);
  });
});

async function writeProjectArtifact(projectRoot: string): Promise<void> {
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    join(projectRoot, "desktop.html"),
    "<!doctype html><html><body><main data-component-id=\"root\">ok</main></body></html>",
    "utf8",
  );
  await writeFile(join(projectRoot, "desktop.md"), "Design notes: A settings page.", "utf8");
  await writeFile(
    join(projectRoot, "manifest.json"),
    JSON.stringify({
      frames: [{
        id: "desktop",
        title: "Desktop",
        kind: "desktop",
        width: 1440,
        height: 1024,
        x: 0,
        y: 0,
        designPath: "desktop.html",
        descriptionPath: "desktop.md",
      }],
    }),
    "utf8",
  );
}
