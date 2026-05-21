import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";

declare function describe(name: string, fn: () => void): void;
declare function beforeEach(fn: () => void): void;
declare function afterEach(fn: () => void): void;
declare function test(name: string, fn: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toContain(expected: unknown): void;
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
    root.render(<App />);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("terminal", { stream: "stdout", chunk: "live-log-line\n", nodeId: "node-1" });
    source.emit("run-status", { status: "success" });

    await waitForText("live-log-line");
    expect(document.body.textContent).toContain("Back to design");
  });

  test("adds a session and renders it immediately", async () => {
    root = createRoot(container);
    root.render(<App />);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Logs");
    clickButtonContaining("Sessions");
    await waitForText("New agent session");

    const input = document.querySelector(".add-session-row input");
    if (!(input instanceof window.HTMLInputElement)) throw new Error("Session name input not found");
    setInputValue(input, "reviewer");
    clickButton("Add");

    await waitForText("reviewer");
    expect(document.body.textContent).toContain("2 sessions");
  });
});

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const method = init?.method ?? "GET";

  if (method === "GET" && url === "/api/canvases") {
    return json([{ id: "wf1", name: "Workflow" }]);
  }
  if (method === "GET" && url === "/api/canvases/wf1") {
    return json(sampleCanvas());
  }
  if (method === "GET" && url.startsWith("/api/runs?")) {
    return json([]);
  }
  if (method === "GET" && url === "/api/agent-sessions?workflowId=wf1") {
    return json([]);
  }
  if (method === "GET" && url === "/api/agent-servers") {
    return json([{ id: "echo-headless", settings: { type: "headless", command: "node", argsTemplate: [] } }]);
  }
  if (method === "POST" && url === "/api/canvases/wf1/run") {
    return json({ runId: "run1" });
  }
  if (method === "GET" && url === "/api/runs/run1") {
    return json(sampleRun("running"));
  }
  if (method === "GET" && url === "/api/runs/run1/logs") {
    return json([]);
  }
  return json({ ok: true });
}

function json(value: unknown): Promise<Response> {
  return Promise.resolve(Response.json(value));
}

function sampleCanvas() {
  return {
    id: "wf1",
    name: "Workflow",
    sessions: [{ id: "s1", name: "main", color: "oklch(0.7 0.13 250)", agentServerId: "echo-headless" }],
    nodes: [{
      kind: "step",
      id: "node-1",
      num: "1",
      x: 120,
      y: 120,
      w: 240,
      title: "Echo",
      desc: "echo prompt",
      sessionId: "s1",
      updateDoc: false,
    }],
    edges: [],
  };
}

function sampleRun(status: string) {
  return {
    id: "run1",
    workflowId: "wf1",
    label: "Run #1",
    ticket: "",
    status,
    startedAt: "2026-05-19T10:00:00.000Z",
    duration: "-",
    agent: "echo-headless",
    nodeStates: { "node-1": "running" },
    nodeOutputs: {},
    agentflowSnapshot: sampleCanvas(),
    canvasSnapshot: { workflowId: "wf1", version: 1, nodes: [{ nodeId: "node-1", x: 120, y: 120, w: 240 }] },
    initialInput: "",
    variableValues: {},
  };
}

function clickButton(text: string, pick: "first" | "last" = "first"): void {
  const matches = [...document.getElementsByTagName("button")].filter((candidate) =>
    candidate.textContent?.trim() === text,
  );
  const button = pick === "last" ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickButtonContaining(text: string): void {
  const button = [...document.getElementsByTagName("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button containing text not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickBottomBarHandle(): void {
  const bottomBar = document.getElementsByClassName("bottom-bar-cell")[0];
  const button = bottomBar?.getElementsByTagName("button")[0];
  if (!button) throw new Error("Bottom bar handle not found");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string): void {
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
  for (let i = 0; i < 50; i += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
