import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";

declare function describe(name: string, callback: () => void): void;
declare function beforeEach(callback: () => void): void;
declare function afterEach(callback: () => void): void;
declare function test(name: string, callback: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toBe(expected: unknown): void;
  toContain(expected: unknown): void;
  not: { toContain(expected: unknown): void };
};

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

let runAuthRequired = false;
let runStartErrorMessage = "";
let holdRunStart = false;
let releaseRunStart: (() => void) | undefined;
let agentSessionHistory: unknown[] = [];
let recordedRunLogs: unknown[] = [];
let restoredPrompts: string[] = [];
let pausedPrompts: string[] = [];
let createdCanvasBody: unknown;
let savedCanvases: unknown[] = [];
let savedLayouts: unknown[] = [];
let deletedCanvases: string[] = [];
let pausedContinues = 0;
let interactionResponses = 0;

function renderApp(root: Root): void {
  root.render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe("App run integration", () => {
  let root: Root | undefined;
  let container: HTMLElement;

  beforeEach(() => {
    const window = new Window({ url: "http://specflow.test" });
    window.SyntaxError = SyntaxError;
    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      SVGElement: window.SVGElement,
      MouseEvent: window.MouseEvent,
      MessageEvent: window.MessageEvent,
      localStorage: window.localStorage,
      EventSource: MockEventSource,
      fetch: mockFetch,
    });
    MockEventSource.instances = [];
    runAuthRequired = false;
    runStartErrorMessage = "";
    holdRunStart = false;
    releaseRunStart = undefined;
    agentSessionHistory = [];
    recordedRunLogs = [];
    restoredPrompts = [];
    pausedPrompts = [];
    createdCanvasBody = undefined;
    savedCanvases = [];
    savedLayouts = [];
    deletedCanvases = [];
    pausedContinues = 0;
    interactionResponses = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    document.body.innerHTML = "";
    root = undefined;
  });

  test("starts a run and renders live terminal output in the log panel", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("terminal", { stream: "stdout", chunk: "live-log-line\n", nodeId: "node-1" });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-terminal-1",
      at: "2026-05-19T10:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "terminal",
      stream: "stdout",
      text: "live-log-line\n",
      nodeId: "node-1",
    });
    source.emit("run-status", { status: "success" });

    await waitForText("live-log-line");
    expect(document.body.textContent).toContain("Back to design");
  });

  test("renders live agent prompts and fork lifecycle events in the log panel", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("agent-prompt", {
      type: "agent_prompt",
      runId: "run1",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      agentId: "agent-server-echo-headless",
      agentServerId: "echo-headless",
      specflowSessionId: "main",
      prompt: "live user prompt",
      at: "2026-05-19T10:00:00.000Z",
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "live user prompt" } },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-user-1",
      at: "2026-05-19T10:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "user_message",
      turnId: "invocation-1",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      text: "live user prompt",
    });
    await waitForText("live user prompt");
    source.emit("agent-lifecycle", {
      type: "agent_lifecycle",
      runId: "run1",
      nodeId: "gate",
      purpose: "gate",
      specflowSessionId: "main-fork-01",
      parentSpecflowSessionId: "main",
      agentInvocationId: "invocation-2",
      agentId: "agent-server-echo-headless",
      agentServerId: "echo-headless",
      lifecycle: { type: "session_forked", sessionId: "acp-fork", parentSessionId: "acp-main", at: "2026-05-19T10:00:01.000Z" },
    });

    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-lifecycle-1",
      at: "2026-05-19T10:00:01.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "lifecycle",
      turnId: "invocation-2",
      nodeId: "gate",
      agentInvocationId: "invocation-2",
      eventType: "session_forked",
      data: { purpose: "gate" },
    });
    await waitForText("[acp:session_forked]");
  });

  test("opens historical run logs without replaying them through SSE", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url.startsWith("/api/runs?")) {
        return json([sampleRun("success")]);
      }
      if (method === "GET" && url === "/api/runs/run1/logs?tail=500") {
        return json({
          events: [{
            type: "session_update",
            runId: "run1",
            nodeId: "node-1",
            agentInvocationId: "invocation-1",
            sessionId: "session-1",
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "historic answer" } },
            at: "2026-05-19T10:00:00.000Z",
          }],
          total: 1,
          startIndex: 0,
        });
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Run #1");
    const runCard = document.querySelector(".run-card");
    if (!(runCard instanceof window.HTMLElement)) throw new Error("Run card not found");
    runCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events?replay=false"));
  });

  test("shows run node status as a badge and historical variable values as read-only text", async () => {
    const defaultFetch = globalThis.fetch;
    const historicalRun = sampleRunWithInput("success", "42");
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json(sampleInputCanvas());
      }
      if (method === "GET" && url.startsWith("/api/runs?")) {
        return json([historicalRun]);
      }
      if (method === "GET" && url === "/api/runs/run1") {
        return json(historicalRun);
      }
      if (method === "GET" && url === "/api/runs/run1/logs?tail=500") {
        return json({ events: [], total: 0, startIndex: 0 });
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Run #1");
    const runCard = document.querySelector(".run-card");
    if (!(runCard instanceof window.HTMLElement)) throw new Error("Run card not found");
    runCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    selectFirstCanvasNode();
    await waitFor(() => document.querySelector(".run-status-badge.success") instanceof window.HTMLElement);

    if (document.querySelectorAll(".bar-tab").length === 0) {
      const expand = document.querySelector(".sessions-head .bar-handle");
      if (!(expand instanceof window.HTMLButtonElement)) throw new Error("Sessions expand button not found");
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await waitFor(() => document.querySelectorAll(".bar-tab").length >= 3);
    }
    const variableTab = [...document.querySelectorAll(".bar-tab")].at(2);
    if (!(variableTab instanceof window.HTMLButtonElement)) throw new Error("Variables tab not found");
    variableTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForText("Run value");
    await waitForText("42");
    if (document.querySelector(".assn-row.vars.readonly .input")) {
      throw new Error("Historical variables should render as read-only text, not inputs");
    }
  });

  test("renders streamed ACP message chunks as one growing timeline message", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "streamed " } },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-stream-1",
      at: "2026-05-19T10:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "assistant_delta",
      turnId: "invocation-1",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      text: "streamed ",
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-stream-2",
      at: "2026-05-19T10:00:00.100Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "assistant_delta",
      turnId: "invocation-1",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      text: "answer",
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Read file", status: "pending" },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-tool-1",
      at: "2026-05-19T10:00:00.200Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "tool_call",
      turnId: "invocation-1",
      toolCallId: "tool-1",
      title: "Read file",
      status: "pending",
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-tool-2",
      at: "2026-05-19T10:00:00.300Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "tool_call_update",
      turnId: "invocation-1",
      toolCallId: "tool-1",
      status: "completed",
    });

    await waitForText("streamed answer");
    await waitForText("Read file");
    await waitForText("completed");
    const messages = document.querySelectorAll(".term-stream .timeline-message.agent");
    if (messages.length !== 1) throw new Error(`Expected one merged ACP message, got ${messages.length}`);
    const tools = document.querySelectorAll(".term-stream .timeline-tool");
    if (tools.length !== 1) throw new Error(`Expected one updated tool entry, got ${tools.length}`);
  });

  test("renders gate decisions with exhausted branch traversal budgets", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("node-status", {
      nodeId: "node-1",
      status: "success",
      at: "2026-05-25T00:00:01.000Z",
      gateDecision: { branchId: "revise", reason: "Blueprint still needs complete localized copy." },
      gateBranches: [
        { branchId: "approve", label: "approve", traversalsUsed: 0, maxTraversals: Number.MAX_SAFE_INTEGER, available: true },
        { branchId: "revise", label: "revise", traversalsUsed: 2, maxTraversals: 2, available: false },
      ],
    });
    source.emit("node-status", {
      nodeId: "node-1",
      status: "success",
      at: "2026-05-25T00:00:02.000Z",
      gateDecision: { branchId: "revise", reason: "Blueprint still needs complete localized copy." },
      gateBranches: [
        { branchId: "approve", label: "approve", traversalsUsed: 0, maxTraversals: Number.MAX_SAFE_INTEGER, available: true },
        { branchId: "revise", label: "revise", traversalsUsed: 3, maxTraversals: 3, available: false },
      ],
    });

    await waitForText("Blueprint still needs complete localized copy.");
    await waitForText("approve 0/∞");
    await waitForText("revise 2/2 exhausted");
    await waitForText("revise 3/3 exhausted");
    const gates = document.querySelectorAll(".term-stream .timeline-gate");
    if (gates.length !== 2) throw new Error(`Expected two gate decision entries, got ${gates.length}`);
  });

  test("loads the first existing workflow when the renamed example is absent", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases") {
        return json([{ id: "legacy-flow", name: "Existing workflow" }]);
      }
      if (method === "GET" && url === "/api/canvases/legacy-flow") {
        return json({ ...sampleCanvas(), id: "legacy-flow", name: "Existing workflow" });
      }
      if (method === "GET" && url === "/api/agent-sessions?workflowId=legacy-flow") {
        return json([]);
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Existing workflow");
    await waitForText("Start run");
  });

  test("shows workflow diagnostics in the workflow list tooltip", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases") {
        return json([{
          id: "example-code-frontend-flow",
          name: "Workflow",
          diagnostics: [{ code: "V2_LOOP_INVALID", severity: "error", message: "Loop must be controlled by a gate." }],
        }]);
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    await waitFor(() => {
      const badge = document.querySelector(".wf-diagnostics");
      return badge instanceof window.HTMLElement;
    });
    await showTooltip(document.querySelector(".wf-diagnostics"), "Error: Loop structure is invalid.");
  });

  test("hides workflow-list diagnostics that are not user-facing warnings", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases") {
        return json([{
          id: "example-code-frontend-flow",
          name: "Workflow",
          diagnostics: [{
            code: "REQUIRED_VARIABLE_NEEDS_RUNTIME_VALUE",
            severity: "warning",
            message: "Required variable needs a runtime value.",
            variableName: "specflow_task",
          }],
        }]);
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    expect(document.querySelector(".wf-diagnostics")).toBe(null);
  });

  test("falls back to server diagnostic messages for unknown workflow diagnostic codes", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases") {
        return json([{
          id: "example-code-frontend-flow",
          name: "Workflow",
          diagnostics: [{ code: "FUTURE_CODE", severity: "warning", message: "Future warning." }],
        }]);
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    await showTooltip(document.querySelector(".wf-diagnostics"), "Warning: Future warning.");
  });

  test("localizes workflow diagnostics in the workflow list tooltip", async () => {
    localStorage.setItem("sf-lang", "zh-CN");
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases") {
        return json([{
          id: "example-code-frontend-flow",
          name: "Workflow",
          diagnostics: [{
            code: "NON_GATE_FANOUT",
            severity: "warning",
            message: "Step has multiple outgoing edges.",
            nodeId: "split",
          }],
        }]);
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("开始运行");
    await showTooltip(document.querySelector(".wf-diagnostics"), "警告：步骤“split”有多条出边。");
  });

  test("shows portal tooltips for run card actions", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url.startsWith("/api/runs?")) {
        return json([sampleRun("success")]);
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Run #1");
    await showTooltip(document.querySelector('button[aria-label="Run this snapshot again"]'), "Run this snapshot again");
  });

  test("shows portal tooltips for canvas toolbar buttons", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    await showTooltip(document.querySelector('button[aria-label="Zoom out"]'), "Zoom out");
  });

  test("adds a session and renders it immediately", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Logs");
    clickButtonContaining("Sessions", "last");
    await waitForText("New agent session");

    const input = document.querySelector(".add-session-row input");
    if (!(input instanceof window.HTMLInputElement)) throw new Error("Session name input not found");
    setInputValue(input, "reviewer");
    clickButton("Add");

    await waitForText("reviewer");
    expect(document.body.textContent).toContain("2 sessions");
  });

  test("assigns a step session from the right panel dropdown and keeps Add available", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json({
          ...sampleCanvas(),
          sessions: [
            { id: "main", name: "main", agentServerId: "echo-headless" },
            { id: "reviewer", name: "reviewer", agentServerId: "codex-acp" },
          ],
        });
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    const step = document.querySelector(".node");
    if (!(step instanceof window.HTMLElement)) throw new Error("Step node not found");
    step.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForText("Definition");

    const select = document.querySelector(".node-session-select");
    if (!(select instanceof window.HTMLSelectElement)) throw new Error("Right panel session selector not found");
    if (select.value !== "main") throw new Error(`Expected main session, got ${select.value}`);
    if (!document.querySelector(".node-session-control button")) throw new Error("Right panel Add button not found");

    setSelectValue(select, "reviewer");
    await waitFor(() => select.value === "reviewer");
  });

  test("renames a node key and uses the key as an empty title fallback", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json(sampleTwoNodeCanvas());
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    await waitFor(() => document.querySelector(".node") instanceof window.HTMLElement);
    selectFirstCanvasNode();
    await waitForText("Node key");
    const inputs = [...document.querySelectorAll(".right .input")];
    const keyInput = inputs.find((input): input is HTMLInputElement => input instanceof window.HTMLInputElement && input.value === "node-1");
    const titleInput = inputs.find((input): input is HTMLInputElement => input instanceof window.HTMLInputElement && input.value === "Echo");
    if (!(keyInput instanceof window.HTMLInputElement) || !(titleInput instanceof window.HTMLInputElement)) {
      throw new Error("Node key/title inputs not found");
    }
    setInputValue(keyInput, "renamed-node");
    keyInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    keyInput.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    await waitFor(() => savedCanvases.some((canvas) => {
      const saved = canvas as { nodes?: Array<{ id: string }>; edges?: Array<{ id: string; from: string; to: string }> };
      return saved.nodes?.some((node) => node.id === "renamed-node")
        && saved.edges?.some((edge) => edge.id === "edge:renamed-node:->node-2" && edge.from === "renamed-node" && edge.to === "node-2");
    }));
    await waitFor(() => [...document.querySelectorAll(".right .input")]
      .some((input) => input instanceof window.HTMLInputElement && input.value === "renamed-node"));

    const renamedTitleInput = [...document.querySelectorAll(".right .input")]
      .find((input): input is HTMLInputElement => input instanceof window.HTMLInputElement && input.value === "Echo");
    if (!(renamedTitleInput instanceof window.HTMLInputElement)) throw new Error("Renamed node title input not found");
    setInputValue(renamedTitleInput, "");
    renamedTitleInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    renamedTitleInput.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    await waitFor(() => savedCanvases.some((canvas) => {
      const saved = canvas as { nodes?: Array<{ id: string; title: string }> };
      return saved.nodes?.some((node) => node.id === "renamed-node" && node.title === "");
    }));
    await waitForText("renamed node");
  });

  test("copies and pastes the selected node with keyboard shortcuts", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    await waitFor(() => document.querySelector(".node") instanceof window.HTMLElement);
    selectFirstCanvasNode();
    await waitForText("Definition");

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true }));

    await waitFor(() => savedCanvases.some((canvas) => {
      const nodes = (canvas as { nodes?: unknown[] }).nodes ?? [];
      return nodes.length === 2 && (nodes[1] as { id?: string }).id === "node-1-copy";
    }));
    const saved = savedCanvases.at(-1) as { nodes: Array<{ id: string; alias: string; sessionId?: string }> };
    expect(saved.nodes.length).toBe(2);
    expect(saved.nodes[1].id).toBe("node-1-copy");
    expect(saved.nodes[1].alias).toBe("02");
    expect(saved.nodes[1].sessionId).toBe("main");
  });

  test("toggles node position lock from the settings panel", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    await waitFor(() => document.querySelector(".node") instanceof window.HTMLElement);
    selectFirstCanvasNode();
    await waitForText("Lock node position");

    const lock = checkboxForLabel("Lock node position");
    setCheckboxValue(lock, true);
    await waitFor(() => savedCanvases.some((canvas) => {
      const node = (canvas as { nodes?: Array<{ locked?: boolean }> }).nodes?.[0];
      return node?.locked === true;
    }));

    const saveCount = savedCanvases.length;
    setCheckboxValue(lock, false);
    await waitFor(() => savedCanvases.length > saveCount && savedCanvases.some((canvas) => {
      const node = (canvas as { nodes?: Array<{ locked?: boolean }> }).nodes?.[0];
      return node && node.locked !== true;
    }));
  });

  test("does not intercept copy and paste shortcuts while editing a textarea", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    selectFirstCanvasNode();
    await waitForText("Definition");
    const textarea = document.querySelector(".panel-body textarea");
    if (!(textarea instanceof window.HTMLTextAreaElement)) throw new Error("Node prompt textarea not found");
    textarea.focus();

    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));
    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(savedCanvases.length).toBe(0);
  });

  test("deletes the selected node from the toolbar", async () => {
    window.confirm = () => true;
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    selectFirstCanvasNode();
    const deleteButton = document.querySelector('button[aria-label="Delete selection"]');
    if (!(deleteButton instanceof window.HTMLButtonElement)) throw new Error("Delete selection button not found");
    await waitFor(() => !deleteButton.disabled);
    deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => savedCanvases.some((canvas) => {
      const saved = canvas as { nodes?: unknown[]; edges?: unknown[] };
      return (saved.nodes?.length ?? -1) === 0 && (saved.edges?.length ?? -1) === 0;
    }));
  });

  test("marquee-selects multiple nodes and copies their internal edges", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json(sampleTwoNodeCanvas());
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    const canvas = document.querySelector(".canvas-wrap");
    if (!(canvas instanceof window.HTMLElement)) throw new Error("Canvas not found");
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 80, clientY: 80 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 760, clientY: 320 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 760, clientY: 320 }));

    await waitFor(() => {
      const copy = document.querySelector('button[aria-label="Copy node"]');
      return copy instanceof window.HTMLButtonElement && !copy.disabled;
    });
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true }));

    await waitFor(() => savedCanvases.some((canvas) => {
      const saved = canvas as { nodes?: unknown[]; edges?: unknown[] };
      return (saved.nodes?.length ?? 0) === 4 && (saved.edges?.length ?? 0) === 2;
    }));
    const saved = savedCanvases.at(-1) as { edges: Array<{ id: string; outputTag?: string }> };
    expect(saved.edges[1].id).toBe("edge:node-1-copy:->node-2-copy");
    expect(saved.edges[1].outputTag).toBe("handoff");
  });

  test("drags marquee-selected nodes together", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json(sampleTwoNodeCanvas());
      }
      return defaultFetch(input, initialValue);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    marqueeSelectAllNodes();
    await waitForCopyEnabled();

    const firstNode = document.querySelector(".node");
    if (!(firstNode instanceof window.HTMLElement)) throw new Error("Step node not found");
    firstNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 140, clientY: 140 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 200, clientY: 170 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200, clientY: 170 }));

    await waitFor(() => savedLayouts.some((canvas) => {
      const saved = canvas as { nodes?: Array<{ nodeId: string; x: number; y: number }> };
      const first = saved.nodes?.find((node) => node.nodeId === "node-1");
      const second = saved.nodes?.find((node) => node.nodeId === "node-2");
      return first?.x === 180 && first.y === 150 && second?.x === 480 && second.y === 150;
    }));
  });

  test("deletes marquee-selected nodes and their connected edges together", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, initialValue?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = initialValue?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json(sampleTwoNodeCanvas());
      }
      return defaultFetch(input, initialValue);
    };
    window.confirm = () => true;

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    marqueeSelectAllNodes();
    await waitForCopyEnabled();
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));

    await waitFor(() => savedCanvases.some((canvas) => {
      const saved = canvas as { nodes?: unknown[]; edges?: unknown[] };
      return (saved.nodes?.length ?? -1) === 0 && (saved.edges?.length ?? -1) === 0;
    }));
  });

  test("shows current run ACP session actions in the Logs toolbar", async () => {
    agentSessionHistory = [sampleAgentSession("echo-headless", "main", "historical")];
    root = createRoot(container);
    renderApp(root);

    await startRunAndComplete();
    expect(document.body.textContent).not.toContain("Agent Sessions");
    await waitForText("Inspect");
    await waitForText("Resume");
  });

  test("shows forked ACP sessions in the Logs session tree", async () => {
    const base = sampleAgentSession("echo-headless", "main", "main-runtime");
    base.acpSupportsForkSession = true;
    const fork = sampleAgentSession("echo-headless", "main-fork-01", "handoff-fork");
    fork.parentSpecflowSessionId = "main";
    fork.acpSupportsForkSession = true;
    fork.acpSessionForked = true;
    fork.invocations = [{
      runId: "run1",
      invocationId: "handoff-invocation",
      nodeId: undefined,
      edgeId: "edge-handoff",
      purpose: "handoff",
      sourceNodeId: "node-1",
      targetNodeId: "node-2",
      status: "done",
      startedAt: "2026-05-19T10:01:00.000Z",
    }];
    agentSessionHistory = [base, fork];
    root = createRoot(container);
    renderApp(root);

    await startRunAndComplete();
    await waitForText("node-1 -> node-2");
    expect(document.body.textContent).toContain("main-fork-01");
    expect(document.body.textContent).not.toContain("Agent Sessions");
  });

  test("opens the auth modal when run preflight requires agent authentication", async () => {
    runAuthRequired = true;
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitForText("Authenticate agents");
    expect(document.body.textContent).toContain("echo-headless");
    expect(document.body.textContent).toContain("Workspace login");
  });

  test("shows run validation errors without closing the run config panel", async () => {
    runStartErrorMessage = 'Node "node-1" references missing session "".';
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitForText("Run blocked");
    expect(document.body.textContent).toContain("references missing session");
    expect(document.body.textContent).toContain("No run inputs for this workflow.");
  });

  test("keeps a run launch status visible while agent checks are pending", async () => {
    holdRunStart = true;
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitForText("Checking agents...");
    releaseRunStart?.();
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
  });

  test("shows Inspect output in its own conversation window rather than the run Logs tab", async () => {
    agentSessionHistory = [sampleAgentSession("echo-headless", "main", "historical")];
    root = createRoot(container);
    renderApp(root);

    await startRunAndComplete();
    await waitForText("Inspect");
    clickButton("Inspect");
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/agent-session-restores/restore-1/events"));

    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/agent-session-restores/restore-1/events")!;
    source.emit("session-update", {
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "restored-" } },
    });
    source.emit("session-update", {
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "transcript" } },
    });
    await waitForText("restored-transcript");
    clickButton("Logs");

    const logs = document.querySelector(".term-stream")?.textContent ?? "";
    const conversation = document.querySelector(".conversation-transcript")?.textContent ?? "";
    expect(logs).not.toContain("restored-transcript");
    expect(conversation).toContain("restored-transcript");
    const messages = document.querySelectorAll(".conversation-transcript .timeline-message.agent");
    if (messages.length !== 1) throw new Error(`Expected one restored ACP message, got ${messages.length}`);
  });

  test("uses the Resume conversation window to send a follow-up ACP prompt", async () => {
    agentSessionHistory = [sampleAgentSession("echo-headless", "main", "historical")];
    root = createRoot(container);
    renderApp(root);

    await startRunAndComplete();
    await waitForText("Resume");
    clickButton("Resume");
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/agent-session-restores/restore-1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/agent-session-restores/restore-1/events")!;
    source.emit("session-update", {
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "loaded history" } },
    });
    source.emit("restore-status", { type: "restore-status", status: "success", selectedPrimitive: "load" });
    await waitForText("loaded history");
    await waitForText("Restored through ACP session/load.");

    const input = document.querySelector(".conversation-compose textarea");
    if (!(input instanceof window.HTMLTextAreaElement)) throw new Error("Resume prompt textarea not found");
    setTextAreaValue(input, "continue reviewing");
    await waitFor(() => {
      const send = document.querySelector(".conversation-compose button");
      return send instanceof window.HTMLButtonElement && !send.disabled;
    });
    clickButton("Send");
    await waitFor(() => restoredPrompts.includes("continue reviewing"));
    source.emit("interaction-requested", {
      type: "interaction-requested",
      interaction: {
        id: "interaction-1",
        runId: "run1",
        kind: "permission",
        status: "pending",
        createdAt: "2026-05-24T10:00:00.000Z",
        agentInvocationId: "restore:restore-1",
        agentId: "agent-server-echo-headless",
        agentServerId: "echo-headless",
        toolCall: { title: "Edit file" },
        options: [{ optionId: "allow", name: "Allow" }],
      },
    });
    await waitForText("Edit file");
    clickButton("Allow");
    await waitFor(() => interactionResponses === 1);
  });

  test("shows recorded context when Resume must use ACP resume without load support", async () => {
    const session = sampleAgentSession("echo-headless", "main", "resume-only") as ReturnType<typeof sampleAgentSession>;
    session.acpSupportsLoadSession = false;
    agentSessionHistory = [session];
    recordedRunLogs = [{
      type: "session_update",
      runId: "run1",
      nodeId: "node-1",
      agentInvocationId: "resume-only-invocation",
      sessionId: "resume-only",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "recorded context" } },
      at: "2026-05-19T10:00:00.000Z",
    }];
    root = createRoot(container);
    renderApp(root);

    await startRunAndComplete();
    await waitForText("Resume");
    clickButton("Resume");

    await waitForText("ACP resume cannot replay history; showing recorded Specflow context.");
    await waitForText("recorded context");
  });

  test("shows a paused node composer for its session and continues from the node card", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("node-status", { nodeId: "node-1", status: "paused" });

    await waitForText("Paused after Echo");
    const pausedInput = document.querySelector(".paused-compose-input textarea");
    if (!(pausedInput instanceof window.HTMLTextAreaElement)) throw new Error("Paused prompt textarea not found");
    setTextAreaValue(pausedInput, "extra context");
    await waitFor(() => {
      const send = document.querySelector(".paused-compose-input button");
      return send instanceof window.HTMLButtonElement && !send.disabled;
    });
    const send = document.querySelector(".paused-compose-input button");
    if (!(send instanceof window.HTMLButtonElement)) throw new Error("Paused send button not found");
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => pausedPrompts.includes("extra context"));
    source.emit("agent-prompt", {
      type: "agent_prompt",
      runId: "run1",
      nodeId: "node-1",
      agentInvocationId: "paused-prompt-1",
      agentId: "agent-server-echo-headless",
      agentServerId: "echo-headless",
      specflowSessionId: "main",
      prompt: "extra context",
      at: "2026-05-19T10:00:00.000Z",
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "paused-prompt-1",
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "extra context" } },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-paused-user",
      at: "2026-05-19T10:00:00.000Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "user_message",
      turnId: "paused-prompt-1",
      nodeId: "node-1",
      agentInvocationId: "paused-prompt-1",
      text: "extra context",
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "paused-prompt-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "paused answer" } },
    });
    source.emit("timeline", {
      type: "acp_timeline",
      id: "timeline-paused-agent",
      at: "2026-05-19T10:00:00.100Z",
      source: "agentflow",
      scopeId: "run1",
      runId: "run1",
      kind: "assistant_delta",
      turnId: "paused-prompt-1",
      nodeId: "node-1",
      agentInvocationId: "paused-prompt-1",
      text: "paused answer",
    });
    await waitForText("extra context");
    await waitForText("paused answer");
    const userMessages = [...document.querySelectorAll(".term-stream .timeline-message.user")]
      .filter((candidate) => candidate.textContent?.includes("extra context"));
    expect(userMessages.length).toBe(1);
    if (document.querySelector(".paused-transcript")) throw new Error("Paused transcript should not render outside the log stream");

    clickButton("Continue node");
    await waitFor(() => pausedContinues === 1);
    await waitFor(() => !(document.body.textContent?.includes("Paused after Echo") ?? false));
  });

  test("creates an empty workflow with a user-provided name", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    const button = document.querySelector('button[title="New workflow"]');
    if (!(button instanceof window.HTMLButtonElement)) throw new Error("New workflow button not found");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => Boolean(document.querySelector(".workflow-create input")));
    const input = document.querySelector(".workflow-create input");
    if (!(input instanceof window.HTMLInputElement)) throw new Error("Workflow create input not found");
    setInputValue(input, "Custom workflow");
    await new Promise((resolve) => setTimeout(resolve, 0));
    clickButton("Create");

    await waitForText("Custom workflow");
    await waitFor(() => Boolean(createdCanvasBody));
    const body = createdCanvasBody as { name?: string };
    if (body.name !== "Custom workflow") throw new Error(`Expected custom workflow name, got ${body.name}`);
  });

  test("opens the log panel for an empty workflow without crashing", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    const button = document.querySelector('button[title="New workflow"]');
    if (!(button instanceof window.HTMLButtonElement)) throw new Error("New workflow button not found");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => Boolean(document.querySelector(".workflow-create input")));
    clickButton("Create");

    await waitForText("Custom workflow");
    clickBottomBarHandle();
    await waitForText("No sessions yet.");
  });

  test("renames the active workflow", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    const button = document.querySelector('button[title="Rename workflow"]');
    if (!(button instanceof window.HTMLButtonElement)) throw new Error("Rename workflow button not found");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => Boolean(document.querySelector(".workflow-name-input")));
    const input = document.querySelector(".workflow-name-input");
    if (!(input instanceof window.HTMLInputElement)) throw new Error("Workflow rename input not found");
    setInputValue(input, "Renamed workflow");
    await new Promise((resolve) => setTimeout(resolve, 0));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await waitFor(() => savedCanvases.some((entry) => (entry as { name?: string }).name === "Renamed workflow"));
    await waitForText("Renamed workflow");
  });

  test("deletes a workflow after confirmation", async () => {
    root = createRoot(container);
    renderApp(root);
    window.confirm = () => true;

    await waitForText("Start run");
    const button = document.querySelector('button[title="Delete workflow"]');
    if (!(button instanceof window.HTMLButtonElement)) throw new Error("Delete workflow button not found");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => deletedCanvases.includes("example-code-frontend-flow"));
  });
});

function mockFetch(input: RequestInfo | URL, initialValue?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const method = initialValue?.method ?? "GET";

  if (method === "GET" && url === "/api/canvases") {
    return json([{ id: "example-code-frontend-flow", name: "Workflow" }]);
  }
  if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
    return json(sampleCanvas());
  }
  if (method === "GET" && url === "/api/canvases/custom-workflow") {
    return json({ id: "custom-workflow", name: "Custom workflow", sessions: [], nodes: [], edges: [] });
  }
  if (method === "POST" && url === "/api/canvases") {
    createdCanvasBody = JSON.parse(String(initialValue?.body ?? "{}"));
    return json({ id: "custom-workflow", name: "Custom workflow", sessions: [], nodes: [], edges: [] });
  }
  if (method === "PUT" && /^\/api\/canvases\/[^/]+$/.test(url)) {
    const body = JSON.parse(String(initialValue?.body ?? "{}"));
    savedCanvases.push(body);
    return json(body);
  }
  if (method === "PUT" && /^\/api\/canvases\/[^/]+\/agentflow$/.test(url)) {
    const body = JSON.parse(String(initialValue?.body ?? "{}"));
    savedCanvases.push(body);
    return json({ ok: true, diagnostics: [], derived: body.derived ?? { loopClosingEdgeIds: [] } });
  }
  if (method === "PUT" && /^\/api\/canvases\/[^/]+\/layout$/.test(url)) {
    const body = JSON.parse(String(initialValue?.body ?? "{}"));
    savedLayouts.push(body);
    return json({ ok: true });
  }
  if (method === "DELETE" && /^\/api\/canvases\/[^/]+$/.test(url)) {
    deletedCanvases.push(url.split("/").at(-1) ?? "");
    return json({ ok: true });
  }
  if (method === "GET" && url.startsWith("/api/runs?")) {
    return json([]);
  }
  if (method === "GET" && url.startsWith("/api/agent-sessions?workflowId=")) {
    return json(agentSessionHistory);
  }
  if (method === "GET" && url === "/api/agent-servers") {
    return json([{ id: "echo-headless", settings: { type: "headless", command: "node", argsTemplate: [] } }]);
  }
  if (method === "POST" && url === "/api/canvases/example-code-frontend-flow/run") {
    if (holdRunStart) {
      return new Promise((resolve) => {
        releaseRunStart = () => resolve(Response.json({ runId: "run1" }));
      });
    }
    if (runStartErrorMessage) {
      return json({ error: runStartErrorMessage }, { status: 409 });
    }
    if (runAuthRequired) {
      return json({
        error: "Agent authentication required",
        authStatuses: [{
          agentServerId: "echo-headless",
          needsAuth: true,
          methods: [{ type: "agent", id: "workspace-login", name: "Workspace login" }],
        }],
      }, { status: 409 });
    }
    return json({ runId: "run1" });
  }
  if (method === "GET" && url === "/api/runs/run1") {
    return json(sampleRun("running"));
  }
  if (method === "GET" && url === "/api/runs/run1/logs?timeline=compact") {
    return json(recordedRunLogs);
  }
  if (method === "GET" && url === "/api/runs/run1/paused-nodes") {
    return json([]);
  }
  if (method === "POST" && url === "/api/runs/run1/paused-nodes/node-1/prompt") {
    const body = JSON.parse(String(initialValue?.body ?? "{}")) as { prompt?: string };
    if (body.prompt) pausedPrompts.push(body.prompt);
    return json({ output: "paused answer" });
  }
  if (method === "POST" && /^\/api\/agent-sessions\/[^/]+\/restore$/.test(url)) {
    return json({ restoreId: "restore-1", status: "running" });
  }
  if (method === "POST" && url === "/api/agent-session-restores/restore-1/prompt") {
    const body = JSON.parse(String(initialValue?.body ?? "{}")) as { prompt?: string };
    if (body.prompt) restoredPrompts.push(body.prompt);
    return json({ output: "continued" });
  }
  if (method === "POST" && url === "/api/runs/run1/paused-nodes/node-1/continue") {
    pausedContinues += 1;
    return json({ ok: true });
  }
  if (method === "POST" && url === "/api/runs/run1/interactions/interaction-1/respond") {
    interactionResponses += 1;
    return json({ ok: true });
  }
  return json({ ok: true });
}

function json(value: unknown, initialValue?: ResponseInit): Promise<Response> {
  return Promise.resolve(Response.json(value, initialValue));
}

function sampleCanvas() {
  return {
    id: "example-code-frontend-flow",
    name: "Workflow",
    sessions: [{ id: "main", name: "main", agentServerId: "echo-headless" }],
    nodes: [{
      kind: "step",
      id: "node-1",
      alias: "1",
      x: 120,
      y: 120,
      w: 240,
      title: "Echo",
      prompt: "echo prompt",
        sessionId: "main",
    }],
    edges: [],
  };
}

function sampleTwoNodeCanvas() {
  const canvas = sampleCanvas();
  return {
    ...canvas,
    nodes: [
      canvas.nodes[0],
      {
        ...canvas.nodes[0],
        id: "node-2",
        alias: "2",
        x: 420,
        title: "Second",
      },
    ],
    edges: [{ id: "edge:node-1:->node-2", from: "node-1", to: "node-2", transmit: true, outputTag: "handoff" }],
  };
}

function sampleInputCanvas() {
  const canvas = sampleCanvas();
  return {
    ...canvas,
    variables: [
      {
        name: "specflow_value",
        title: "Run value",
        required: false,
        defaultValue: "1",
        description: "Value used by the arithmetic steps.",
      },
    ],
  };
}

function sampleRun(status: string) {
  return {
    id: "run1",
    workflowId: "example-code-frontend-flow",
    label: "Run #1",
    ticket: "",
    status,
    startedAt: "2026-05-19T10:00:00.000Z",
    duration: "-",
    agent: "echo-headless",
    nodeStates: { "node-1": "running" },
    nodeOutputs: {},
    agentflowSnapshot: sampleCanvas(),
    canvasSnapshot: { workflowId: "example-code-frontend-flow", version: 1, nodes: [{ nodeId: "node-1", x: 120, y: 120, w: 240 }] },
    initialInput: "",
    variableValues: {},
  };
}

function sampleRunWithInput(status: string, value: string) {
  const canvas = sampleInputCanvas();
  return {
    ...sampleRun(status),
    nodeStates: { "node-1": status },
    agentflowSnapshot: canvas,
    canvasSnapshot: {
      workflowId: "example-code-frontend-flow",
      version: 1,
      nodes: [
        { nodeId: "node-1", x: 120, y: 120, w: 240 },
      ],
    },
    variableValues: { specflow_value: value },
  };
}

function sampleAgentSession(agentServerId: string, specflowSessionId: string, acpSessionId: string) {
  return {
    id: `${agentServerId}-${acpSessionId}`,
    workflowId: "example-code-frontend-flow",
    specflowSessionId,
    parentSpecflowSessionId: undefined as string | undefined,
    agentId: `agent-server-${agentServerId}`,
    agentServerId,
    acpSessionId,
    acpSupportsLoadSession: true,
    acpSupportsResumeSession: true,
    acpSupportsForkSession: false,
    acpSessionForked: false,
    firstSeenAt: "2026-05-19T10:00:00.000Z",
    lastSeenAt: "2026-05-19T10:05:00.000Z",
    latestRunId: "run1",
    latestInvocationId: `${acpSessionId}-invocation`,
    latestStatus: "done",
    runIds: ["run1"],
    invocationIds: [`${acpSessionId}-invocation`],
    invocations: [{
      runId: "run1",
      invocationId: `${acpSessionId}-invocation`,
      nodeId: "node-1" as string | undefined,
      edgeId: undefined as string | undefined,
      purpose: undefined as "node" | "gate" | "handoff" | undefined,
      sourceNodeId: undefined as string | undefined,
      targetNodeId: undefined as string | undefined,
      status: "done",
      startedAt: "2026-05-19T10:00:00.000Z",
    }],
  };
}

async function startRunAndComplete(): Promise<MockEventSource> {
  await waitForText("Start run");
  clickButton("Start run");
  await waitForText("No run inputs for this workflow.");
  clickButton("Start run", "last");
  await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
  const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
  source.emit("run-status", { status: "success" });
  return source;
}

function clickButton(text: string, pick: "first" | "last" = "first"): void {
  const matches = [...document.getElementsByTagName("button")].filter((candidate) =>
    candidate.textContent?.trim() === text,
  );
  const button = pick === "last" ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickButtonContaining(text: string, pick: "first" | "last" = "first"): void {
  const matches = [...document.getElementsByTagName("button")].filter((candidate) =>
    candidate.textContent?.includes(text),
  );
  const button = pick === "last" ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Button containing text not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function selectFirstCanvasNode(): void {
  const step = document.querySelector(".node");
  if (!(step instanceof window.HTMLElement)) throw new Error("Step node not found");
  step.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  step.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  step.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
}

function marqueeSelectAllNodes(): void {
  const canvas = document.querySelector(".canvas-wrap");
  if (!(canvas instanceof window.HTMLElement)) throw new Error("Canvas not found");
  canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 80, clientY: 80 }));
  window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 760, clientY: 320 }));
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 760, clientY: 320 }));
}

async function waitForCopyEnabled(): Promise<void> {
  await waitFor(() => {
    const copy = document.querySelector('button[aria-label="Copy node"]');
    return copy instanceof window.HTMLButtonElement && !copy.disabled;
  });
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function clickBottomBarHandle(): void {
  const bottomBar = document.getElementsByClassName("bottom-bar-cell")[0];
  const button = bottomBar?.getElementsByTagName("button")[0];
  if (!button) throw new Error("Bottom bar handle not found");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function showTooltip(target: Element | null, expectedText: string): Promise<void> {
  if (!(target instanceof window.HTMLElement)) throw new Error(`Tooltip target not found: ${expectedText}`);
  const trigger = target.closest(".floating-tooltip-trigger");
  if (!(trigger instanceof window.HTMLElement)) throw new Error(`Tooltip trigger not found: ${expectedText}`);
  await waitFor(() => trigger.dataset.floatingTooltipReady === "true");
  trigger.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  await waitFor(() => {
    const tooltip = document.querySelector(".floating-tooltip");
    return tooltip instanceof window.HTMLElement
      && tooltip.textContent?.includes(expectedText) === true
      && window.getComputedStyle(tooltip).position === "fixed";
  });
  trigger.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  const InputEventCtor = window.InputEvent ?? window.Event;
  input.dispatchEvent(new InputEventCtor("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function setCheckboxValue(input: HTMLInputElement, checked: boolean): void {
  if (input.checked !== checked) {
    input.click();
  }
  if (input.checked === checked) return;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "checked")?.set;
  setter?.call(input, checked);
  input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function checkboxForLabel(text: string): HTMLInputElement {
  const label = [...document.getElementsByTagName("label")].find((candidate) => candidate.textContent?.includes(text));
  const input = label?.querySelector('input[type="checkbox"]');
  if (!(input instanceof window.HTMLInputElement)) throw new Error(`Checkbox not found: ${text}`);
  return input;
}

function setTextAreaValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  const InputEventCtor = window.InputEvent ?? window.Event;
  input.dispatchEvent(new InputEventCtor("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

async function waitForText(text: string): Promise<void> {
  await waitFor(() => document.body.textContent?.includes(text) ?? false);
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
