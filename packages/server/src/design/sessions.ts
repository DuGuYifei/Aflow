import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentProxySessionPool,
  AgentServerStore,
  type AgentCommandRequest,
  type AgentCommandResult,
  type AgentLifecycleEvent,
  type AgentSessionUpdateEvent,
  type AgentTerminalEvent,
} from "@specflow/agent-proxy";
import { type AcpTimelineEvent } from "@specflow/shared";
import { uuidv7 } from "@specflow/shared";
import { AcpTimelinePipeline } from "../acp-timeline-pipeline";
import { SkillStore, resolveSlashCommands } from "../skills";
import { designConversationsDir } from "../workspace-paths";
import { buildDesignExecutionPrompt, loadDesignProjectArtifact } from "./artifacts";
import { appendDesignSessionLogEntry, listDesignSessionLogEntries } from "./log-store";
import { loadDesignProject } from "./projects";
import { designReferencePath, sanitizeReferenceName } from "./references";
import type {
  DesignChatMessage,
  DesignMessageAttachment,
  DesignInitializeSessionRequest,
  DesignProjectSummary,
  DesignReferenceContext,
  DesignSendMessageRequest,
  DesignSession,
  DesignSessionSummary,
} from "./types";

export type DesignAgentRunner = (request: AgentCommandRequest) => Promise<AgentCommandResult>;

interface SendDesignMessageOptions {
  runner?: DesignAgentRunner;
  signal?: AbortSignal;
  onLog?: (entry: AcpTimelineEvent) => void;
}

const designAgentPools = new Map<string, AgentProxySessionPool>();

export async function initializeDesignSession(
  root: string,
  request: DesignInitializeSessionRequest,
  options: SendDesignMessageOptions = {},
): Promise<DesignSession> {
  const agentServerId = request.agentServerId?.trim();
  if (!agentServerId) throw httpError(400, "agentServerId is required.");

  const runner = options.runner ?? pooledDesignAgentRunner(root);
  const project = await loadDesignProject(root, request.projectName);
  const session = createDesignSession(project);
  const reference = await resolveReferenceContext(root, request);
  if (reference) session.reference = reference;
  session.agentServerId = agentServerId;
  session.logs ??= [];
  const timeline = createDesignTimelinePipeline(root, session, options);

  await injectDesignerMemory(root, session, request, agentServerId, runner, timeline, options.signal);
  session.latestArtifact = await loadDesignProjectArtifact(project.name, project.path);
  timeline.snapshot({ status: "success", metadata: { operation: "initialize" } });
  await timeline.flush();
  session.logs = timeline.events;
  await saveDesignSession(root, session);
  return session;
}

export async function sendDesignMessage(
  root: string,
  request: DesignSendMessageRequest,
  options: SendDesignMessageOptions = {},
): Promise<DesignSession> {
  const agentServerId = request.agentServerId?.trim();
  const message = request.message?.trim();
  if (!agentServerId) throw httpError(400, "agentServerId is required.");
  if (!message) throw httpError(400, "message is required.");

  const runner = options.runner ?? pooledDesignAgentRunner(root);
  const project = await loadDesignProject(root, request.projectName);
  const session = request.sessionId
    ? await loadDesignSession(root, request.sessionId)
    : createDesignSession(project);
  if (session.project.name !== project.name) {
    throw httpError(400, "Design session project cannot be changed.");
  }
  const reference = await resolveReferenceContext(root, request);
  if (reference) session.reference = reference;
  session.agentServerId = agentServerId;
  session.logs ??= [];
  const timeline = createDesignTimelinePipeline(root, session, options);

  const attachments = await resolveMessageAttachments(root, project.path, request.attachments);
  const turnId = uuidv7();
  session.messages.push(messageRecord("user", message, new Date().toISOString(), attachments));
  timeline.record({
    kind: "user_message",
    turnId,
    phase: "message",
    text: attachments.length ? `${message}\n\n${attachmentLogText(attachments)}` : message,
    localContext: false,
  });

  if (!session.memoryInjected) {
    await injectDesignerMemory(root, session, request, agentServerId, runner, timeline, options.signal);
  }

  const resolvedMessage = withAttachmentPromptContext(withReferencePromptContext(
    await resolveDesignSlashCommands(root, agentServerId, message),
    reference,
  ), attachments);
  const executionPrompt = buildDesignExecutionPrompt(project, resolvedMessage);
  const promptBlocks = await designPromptBlocks(root, project.path, executionPrompt, attachments);
  let result: AgentCommandResult;
  try {
    result = await runner({
      agentServerId,
      cwd: root,
      workflowSessionId: workflowSessionId(session.id),
      ...(session.acpSessionId ? { restoreFromAcpSessionId: session.acpSessionId } : {}),
      prompt: executionPrompt,
      ...(promptBlocks.length > 1 ? { promptBlocks } : {}),
      signal: options.signal,
      ...designLogHandlers(timeline, turnId, "message"),
      ...(request.modeId ? { modeId: request.modeId } : {}),
      ...(request.configOptions && Object.keys(request.configOptions).length > 0 ? { configOptions: request.configOptions } : {}),
    });
  } catch (error) {
    timeline.record({
      kind: "error",
      turnId,
      phase: "message",
      text: error instanceof Error ? error.message : String(error),
      data: error,
    });
    timeline.snapshot({ status: options.signal?.aborted ? "cancelled" : "failed", turnId });
    await timeline.flush();
    session.logs = timeline.events;
    await saveDesignSession(root, session);
    throw error;
  }
  if (result.exitCode !== 0) {
    timeline.record({
      kind: "error",
      turnId,
      phase: "message",
      text: result.output,
    });
    timeline.snapshot({ status: "failed", turnId });
    await timeline.flush();
    session.logs = timeline.events;
    await saveDesignSession(root, session);
    throw httpError(502, `Designer message failed: ${result.output}`);
  }
  session.acpSessionId = result.sessionId ?? session.acpSessionId;
  session.latestArtifact = await loadDesignProjectArtifact(project.name, project.path);
  timeline.snapshot({ status: "success", turnId });
  await timeline.flush();
  session.logs = timeline.events;
  await saveDesignSession(root, session);
  return session;
}

function pooledDesignAgentRunner(root: string): DesignAgentRunner {
  let pool = designAgentPools.get(root);
  if (!pool) {
    pool = new AgentProxySessionPool({ root });
    designAgentPools.set(root, pool);
  }
  return (request) => pool.run(request);
}

function createDesignTimelinePipeline(
  root: string,
  session: DesignSession,
  options: SendDesignMessageOptions,
): AcpTimelinePipeline {
  return new AcpTimelinePipeline({
    source: "design",
    scopeId: session.id,
    initialEvents: session.logs ?? [],
    append: (event) => appendDesignSessionLogEntry(root, session.id, event),
    emit: options.onLog,
    base: {
      designSessionId: session.id,
      agentServerId: session.agentServerId,
    },
  });
}

async function injectDesignerMemory(
  root: string,
  session: DesignSession,
  request: Pick<DesignInitializeSessionRequest, "modeId" | "configOptions">,
  agentServerId: string,
  runner: DesignAgentRunner,
  timeline: AcpTimelinePipeline,
  signal?: AbortSignal,
): Promise<void> {
  const memoryPrompt = buildDesignerMemoryPrompt(session.project, session.reference);
  const turnId = `memory-${session.id}`;
  const memoryResult = await runner({
    agentServerId,
    cwd: root,
    workflowSessionId: workflowSessionId(session.id),
    prompt: memoryPrompt,
    signal,
    ...designLogHandlers(timeline, turnId, "memory"),
    ...(request.modeId ? { modeId: request.modeId } : {}),
    ...(request.configOptions && Object.keys(request.configOptions).length > 0 ? { configOptions: request.configOptions } : {}),
  });
  if (memoryResult.exitCode !== 0) {
    timeline.record({
      kind: "error",
      turnId,
      phase: "memory",
      text: memoryResult.output,
      localContext: true,
    });
    timeline.snapshot({ status: "failed", turnId, metadata: { operation: "memory" } });
    await timeline.flush();
    session.logs = timeline.events;
    await saveDesignSession(root, session);
    throw httpError(502, `Designer initialization failed: ${memoryResult.output}`);
  }
  session.acpSessionId = memoryResult.sessionId ?? session.acpSessionId;
  session.memoryInjected = true;
}

function designLogHandlers(
  timeline: AcpTimelinePipeline,
  turnId: string,
  phase: "memory" | "message",
): Pick<AgentCommandRequest, "onTerminalEvent" | "onLifecycleEvent" | "onSessionUpdate"> {
  return {
    onTerminalEvent: (event) => appendTerminalTimeline(timeline, turnId, phase, event),
    onLifecycleEvent: (event) => appendLifecycleTimeline(timeline, turnId, phase, event),
    onSessionUpdate: (event) => appendSessionUpdateTimeline(timeline, turnId, phase, event),
  };
}

function appendTerminalTimeline(
  timeline: AcpTimelinePipeline,
  turnId: string,
  phase: "memory" | "message",
  event: AgentTerminalEvent,
): void {
  timeline.record({
    kind: "terminal",
    turnId,
    phase,
    stream: event.stream,
    text: event.chunk,
    localContext: phase === "memory",
  });
}

function appendLifecycleTimeline(
  timeline: AcpTimelinePipeline,
  turnId: string,
  phase: "memory" | "message",
  event: AgentLifecycleEvent,
): void {
  timeline.record({
    kind: "lifecycle",
    turnId,
    phase,
    eventType: event.type,
    data: event,
    sessionId: "sessionId" in event ? event.sessionId : undefined,
    localContext: phase === "memory",
  });
}

function appendSessionUpdateTimeline(
  timeline: AcpTimelinePipeline,
  turnId: string,
  phase: "memory" | "message",
  event: AgentSessionUpdateEvent,
): void {
  const update = event.update as Record<string, unknown>;
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  const base = {
    turnId,
    phase,
    sessionId: event.sessionId,
    localContext: phase === "memory",
  };
  if (kind === "agent_message_chunk" || kind === "user_message_chunk" || kind === "agent_thought_chunk") {
    const text = contentText(update.content);
    if (!text) return;
    timeline.record(kind === "user_message_chunk"
      ? { ...base, kind: "user_message", text }
      : { ...base, kind: "assistant_delta", text, role: kind === "agent_thought_chunk" ? "thought" : "assistant" });
    return;
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    if (!toolCallId) return;
    timeline.record({
      ...base,
      kind,
      toolCallId,
      title: typeof update.title === "string" ? update.title : undefined,
      status: typeof update.status === "string" ? update.status : undefined,
      toolKind: typeof update.kind === "string" ? update.kind : undefined,
      content: update.content,
      locations: update.locations,
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
    });
    return;
  }
  timeline.record({
    ...base,
    kind: "lifecycle",
    eventType: kind || "session_update",
    data: event,
  });
}

function contentText(content: unknown): string {
  const block = content && typeof content === "object" ? content as { type?: unknown; text?: unknown } : {};
  if (block.type === "text" && typeof block.text === "string") return block.text;
  return typeof block.type === "string" ? `[${block.type}]` : "";
}

export async function listDesignSessions(root: string, projectName?: string): Promise<DesignSessionSummary[]> {
  await mkdir(designConversationsDir(root), { recursive: true });
  const entries = await readdir(designConversationsDir(root), { withFileTypes: true }).catch(() => []);
  const sessions: DesignSessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const session = JSON.parse(await readFile(join(designConversationsDir(root), entry.name), "utf8")) as DesignSession;
      if (projectName && session.project?.name !== projectName) continue;
      sessions.push({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        projectName: session.project?.name ?? "",
        agentServerId: session.agentServerId,
        acpSessionId: session.acpSessionId,
        title: sessionTitle(session),
        messageCount: session.messages.filter((message) => message.role !== "system").length,
      });
    } catch {
      // Ignore malformed local files so one corrupt conversation does not hide the whole history.
    }
  }
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadDesignSession(root: string, id: string): Promise<DesignSession> {
  const path = designSessionPath(root, id);
  try {
    const session = JSON.parse(await readFile(path, "utf8")) as DesignSession;
    session.logs = await listDesignSessionLogEntries(root, id);
    return session;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw httpError(404, `Design session not found: ${id}`);
    }
    throw error;
  }
}

async function resolveDesignSlashCommands(root: string, agentServerId: string, message: string): Promise<string> {
  if (!message.includes("/")) return message;
  const [skills, capabilities] = await Promise.all([
    new SkillStore({ root }).list(),
    new AgentServerStore({ root }).getCapabilities(agentServerId),
  ]);
  return resolveSlashCommands({
    prompt: message,
    skills,
    availableCommands: capabilities?.availableCommands,
  }).prompt;
}

async function saveDesignSession(root: string, session: DesignSession): Promise<void> {
  session.updatedAt = new Date().toISOString();
  await mkdir(designConversationsDir(root), { recursive: true });
  const { logs: _logs, ...persisted } = session;
  await writeFile(designSessionPath(root, session.id), `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
}

function createDesignSession(project: DesignProjectSummary): DesignSession {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    createdAt: now,
    updatedAt: now,
    project,
    memoryInjected: false,
    messages: [],
  };
}

async function resolveReferenceContext(
  root: string,
  request: Pick<DesignSendMessageRequest, "referenceName" | "referenceInterfaceDescription">,
): Promise<DesignReferenceContext | undefined> {
  if (!request.referenceName?.trim()) return undefined;
  const name = sanitizeReferenceName(request.referenceName);
  const path = designReferencePath(root, name);
  const referenceStat = await stat(path).catch(() => undefined);
  if (!referenceStat?.isDirectory()) {
    throw httpError(404, `Design reference not found: ${name}`);
  }
  const description = request.referenceInterfaceDescription?.trim();
  return {
    name,
    path,
    ...(description ? { interfaceDescription: description } : {}),
  };
}

function buildDesignerMemoryPrompt(
  project: DesignProjectSummary,
  reference: DesignReferenceContext | undefined,
): string {
  const lines = [
    "请把以下设定放进 memory：",
    "现在你是一个前端 UI 设计师。我们将以 HTML 的形式做产品界面设计。",
    "当前对话只服务于一个 Designer project。你需要直接读写当前工作目录中的 HTML/CSS/JS/JSON 文件来完成设计工作。",
    "重要前提：用户可能先讨论、澄清、探索方案。只有当你判断用户是在要求生成、修改或更新设计画面时，才按下面的产物规则读写文件；如果用户只是在讨论，请自然回复并继续澄清，不要贸然创建或修改文件。",
    "",
    "当前 Designer project：",
    `- name: ${project.name}`,
    `- working directory: ${project.path}`,
    "",
    "工作规则：",
    "- agent 进程的 cwd 可能是 workspace root；上面的 working directory 才是项目根目录。",
    "- 所有设计产物必须写入这个 working directory，不要写到其他位置。",
    "- 请直接编辑 Designer project 工作目录中的文件，不要用 markdown fenced blocks 作为主要产物。",
    "- 所有 frame HTML 文件都直接放在项目根目录，命名为 xxx.html，不要创建 frames/<id>/ 分目录。",
    "- 你可以创建和修改 styles.css、interactions.js、manifest.json 等共享文件。",
    "- 优先把可调整视觉样式写入 styles.css，并给组件稳定 class 或 data-component-id selector。",
    "- 必须维护 manifest.json，让画布知道有哪些 frame、尺寸和位置。",
    "- 不要创建单独 wireframe HTML；每个 frame 用同一个 xxx.html，在 ?view=wireframe 时切换为线框图。",
    "- 每个 frame 的设计说明写入同名 Markdown，例如 desktop.html 对应 desktop.md，并在 manifest.json 中用 descriptionPath 指向它。",
    "- 每次创建或修改某个 frame 的 HTML/CSS/JS 后，都检查该 frame 的同名 Markdown 说明是否需要更新；如果设计目标、页面结构、组件关系、关键交互、状态或设计取舍变化了，必须同步更新；如果没有变化，不要为了更新而改动。",
    "- data-component-id 是可选的稳定语义锚点，可用于标记主要区域或大组件；不要为了它维护额外 JSON。",
    "- 一个 project 的所有 frame 都在同一个目录，多个 HTML 可以共享 styles.css 和 interactions.js，也可以互相链接跳转。",
    "- designPath 必须是当前目录下的 .html 文件名，不能包含 /、\\ 或 ..。",
    "- descriptionPath 必须是当前目录下的 .md 文件名，通常与对应 HTML 同名。",
    "- manifest.json 中每个 frame 的 width/height 是该 frame 在画布中的预览 viewport 尺寸，x/y 是该 frame 在画布上的摆放位置；不要把 manifest 当作响应式断点自动推断结果。",
    "- 每个 HTML 必须是可以直接放入 iframe 预览的完整 HTML 文档；正常访问显示高保真设计稿，带 ?view=wireframe 时显示同一结构的线框图视图。",
    "- 每个 HTML 应使用标准 viewport meta：<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">；不要把 viewport meta 写死为某个 frame 宽度。",
    "- 每个 HTML 应去掉浏览器默认 body margin，并让 html/body 与 frame viewport 对齐，避免非设计意图造成尺寸偏移或假滚动条。",
    "- 所有 frame 的最高层页面容器必须使用 width:100%、max-width:none、box-sizing:border-box；不要把 manifest width 写成根容器的 CSS width，也不要用固定 px 或 100vw 作为根容器宽度。",
    "- 静态画板可以用 height 或 min-height 对齐 manifest height，并按设计需要裁剪溢出；长页面可以用 min-height 对齐 manifest height 并允许内容自然向下延展。",
    "- 不要用 overflow-x:hidden 掩盖布局问题。页面级横向滚动只有在用户明确要求整页横向画布时才出现；carousel、表格等横向滚动应限制在局部容器内。",
    "- 避免在根容器使用 100vw/100vh 与 padding、border、fixed 元素组合制造非设计意图的横向或纵向溢出。",
    "- 线框图必须由同一个 HTML 根据 location.search 中的 view=wireframe 切换 CSS/状态实现，确保组件和布局与高保真设计稿完全对应。",
    "- Markdown 说明应包含设计目标、页面结构、组件关系、关键交互、状态说明和设计取舍。",
    "- 线框图模式下可以根据父页面传入的 selected query 对 data-component-id 做高亮/灰化；高保真 HTML 模式不要做选中灰化效果。",
    "- 用户消息里可能包含 <html_element>、<element-comments>、<visual_changes>；这些会用 file::xpath / selector 指向具体 HTML 元素，必须落实到对应 HTML/CSS/JS 文件。",
    "- 默认在原 frame 中实现动效和交互；只有当用户明确要求单独展示动效，或动效 demo 会干扰主页面默认状态时，才创建单独 HTML frame，例如 animation-demo.html，并在 manifest.json 中列出。",
    "",
    "manifest.json 示例：",
    "{",
    "  \"frames\": [",
    "    {\"id\":\"desktop\",\"title\":\"Desktop\",\"kind\":\"desktop\",\"width\":1440,\"height\":1024,\"x\":0,\"y\":0,\"designPath\":\"desktop.html\",\"descriptionPath\":\"desktop.md\"},",
    "    {\"id\":\"mobile\",\"title\":\"Mobile\",\"kind\":\"mobile\",\"width\":390,\"height\":844,\"x\":1520,\"y\":0,\"designPath\":\"mobile.html\",\"descriptionPath\":\"mobile.md\"}",
    "  ]",
    "}",
    "不要把 reference 仓库代码原样复制到结果里；只读取和吸收其中的信息架构、布局、组件组织、交互和视觉规律。",
  ];
  if (reference) {
    lines.push(
      "",
      "本次设计可使用以下 reference 仓库：",
      `- name: ${reference.name}`,
      `- path: ${reference.path}`,
    );
    if (reference.interfaceDescription) {
      lines.push("- 该仓库的界面描述：", reference.interfaceDescription);
    }
    lines.push("当用户请求设计时，如果当前 agent 权限允许，请按需读取这个 reference 仓库里的相关文件来理解对应界面。");
  }
  lines.push("", "如果你已经把这些设定放入 memory 并理解了，只回复“知道了”。");
  return lines.join("\n");
}

function designSessionPath(root: string, id: string): string {
  return join(designConversationsDir(root), `${sanitizeSessionId(id)}.json`);
}

function withReferencePromptContext(message: string, reference: DesignReferenceContext | undefined): string {
  if (!reference) return message;
  const lines = [
    "<reference-context>",
    `name: ${reference.name}`,
    `path: ${reference.path}`,
  ];
  if (reference.interfaceDescription) {
    lines.push("interfaceDescription:", reference.interfaceDescription);
  }
  lines.push(
    "instruction: For this user message, you may inspect this reference repository when it helps. Use it as design/context reference; do not copy its code verbatim.",
    "</reference-context>",
    "",
    message,
  );
  return lines.join("\n");
}

function withAttachmentPromptContext(message: string, attachments: DesignMessageAttachment[]): string {
  if (attachments.length === 0) return message;
  return [
    "<image-attachments>",
    ...attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`),
    "instruction: The same images are attached as ACP image blocks when supported. Use them as visual references for this user message.",
    "</image-attachments>",
    "",
    message,
  ].join("\n");
}

async function resolveMessageAttachments(root: string, projectPath: string, attachments: DesignMessageAttachment[] | undefined): Promise<DesignMessageAttachment[]> {
  if (!attachments?.length) return [];
  const resolved: DesignMessageAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue;
    const safePath = safeAttachmentPath(attachment.path);
    const absolutePath = attachmentAbsolutePath(root, projectPath, safePath);
    const fileStat = await stat(absolutePath).catch(() => undefined);
    if (!fileStat?.isFile()) throw httpError(400, `Design attachment not found: ${safePath}`);
    resolved.push({
      id: attachment.id,
      kind: "image",
      path: safePath,
      name: attachment.name,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    });
  }
  return resolved;
}

async function designPromptBlocks(root: string, projectPath: string, text: string, attachments: DesignMessageAttachment[]): Promise<NonNullable<AgentCommandRequest["promptBlocks"]>> {
  const blocks: NonNullable<AgentCommandRequest["promptBlocks"]> = [{ type: "text", text }];
  for (const attachment of attachments) {
    const absolutePath = attachmentAbsolutePath(root, projectPath, safeAttachmentPath(attachment.path));
    blocks.push({
      type: "image",
      data: Buffer.from(await readFile(absolutePath)).toString("base64"),
      mimeType: attachment.mimeType ?? "image/png",
      uri: pathToFileURL(absolutePath).toString(),
      _meta: {
        specflowName: attachment.name,
        specflowPath: attachment.path,
      },
    });
  }
  return blocks;
}

function attachmentAbsolutePath(root: string, projectPath: string, safePath: string): string {
  return safePath === "tmp" || safePath.startsWith("tmp/")
    ? join(root, safePath)
    : join(projectPath, safePath);
}

function attachmentLogText(attachments: DesignMessageAttachment[]): string {
  return attachments.map((attachment) => `[image] ${attachment.name} (${attachment.path})`).join("\n");
}

function safeAttachmentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  if (parts[0] !== "tmp" || parts.length !== 2) throw httpError(400, `Invalid design attachment path: ${path}`);
  return parts.map((part) => part.replace(/[^A-Za-z0-9._-]/g, "_")).join("/");
}

function sessionTitle(session: DesignSession): string {
  const firstUserMessage = session.messages.find((message) => message.role === "user")?.text.trim();
  if (!firstUserMessage) return "New design session";
  return firstUserMessage.length > 72 ? `${firstUserMessage.slice(0, 69)}...` : firstUserMessage;
}

function workflowSessionId(sessionId: string): string {
  return `design-${sessionId}`;
}

function sanitizeSessionId(id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw httpError(400, "Invalid design session id.");
  return id;
}

function messageRecord(role: DesignChatMessage["role"], text: string, at: string, attachments?: DesignMessageAttachment[]): DesignChatMessage {
  return { id: uuidv7(), role, text, at, ...(attachments?.length ? { attachments } : {}) };
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}
