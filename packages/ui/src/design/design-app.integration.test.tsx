import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../i18n";
import { DesignApp } from "./design-app";

declare function describe(name: string, callback: () => void): void;
declare function beforeEach(callback: () => void): void;
declare function afterEach(callback: () => void): void;
declare function test(name: string, callback: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toContain(expected: unknown): void;
};

let root: Root | undefined;
let container: HTMLElement;

function renderDesignApp(): void {
  root = createRoot(container);
  root.render(
    <I18nProvider>
      <DesignApp />
    </I18nProvider>,
  );
}

describe("DesignApp integration", () => {
  beforeEach(() => {
    const window = new Window({ url: "http://specflow.test/design" });
    window.SyntaxError = SyntaxError;
    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLButtonElement: window.HTMLButtonElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      SVGElement: window.SVGElement,
      MouseEvent: window.MouseEvent,
      MessageEvent: window.MessageEvent,
      localStorage: window.localStorage,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
      fetch: mockDesignFetch,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    document.body.innerHTML = "";
    root = undefined;
  });

  test("opens project artifacts, panel targets, and component selection actions", async () => {
    renderDesignApp();

    await waitForText("Design projects");
    await waitForText("Checkout Redesign");
    clickText("Checkout Redesign");
    await waitForText("Desktop");

    clickText("Description");
    await waitForText("Design goals");

    clickText("Start design");
    await waitForText("Start a design session");
    clickTextIn(".design-start-modal", "Start design");
    await waitForText("Design session started");
    await waitForText("Using Read file tool");

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "design-component-selected",
        frameId: "desktop",
        id: "hero",
        component: {
          id: "hero",
          name: "Hero Section",
          type: "component:section",
          selector: "[data-component-id=\"hero\"]",
          filePath: "desktop.html",
          xpath: "//*[@data-component-id=\"hero\"]",
          tagName: "section",
          textContent: "Hero Section",
          selectionLevel: "component",
          anchorKind: "data-component-id",
        },
        ancestors: ["hero", "page"],
        x: 16,
        y: 18,
      },
    }));

    await waitForText("Selected element");
    await waitForText("Background");
    await waitForText("Hero Section");

    const addButton = [...document.querySelectorAll(".design-component-actions button")]
      .find((button): button is HTMLButtonElement => button instanceof window.HTMLButtonElement && button.textContent?.includes("Add to input"));
    if (!addButton) throw new Error("Properties panel Add to input button not found");
    addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const textarea = document.querySelector(".design-compose textarea");
    if (!(textarea instanceof window.HTMLTextAreaElement)) throw new Error("Design compose textarea not found");
    await waitFor(() => textarea.value.includes("<specflow_html_element"));
    expect(textarea.value).toContain('id="hero"');
    expect(textarea.value).toContain('file="desktop.html"');

    const commentButton = [...document.querySelectorAll(".design-component-actions button")]
      .find((button): button is HTMLButtonElement => button instanceof window.HTMLButtonElement && button.textContent?.includes("Comment"));
    if (!commentButton) throw new Error("Properties panel Comment button not found");
    commentButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => document.querySelector(".design-component-comment-box textarea") instanceof window.HTMLTextAreaElement);

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "design-component-selected",
        frameId: "desktop",
        id: "dom:desktop:0",
        component: {
          id: "dom:desktop:0",
          name: "Start free trial",
          type: "dom:button",
          selector: "main > button:nth-of-type(1)",
          filePath: "desktop.html",
          xpath: "//*[@id=\"main\"]/button",
          tagName: "button",
          textContent: "Start free trial",
          selectionLevel: "dom-element",
          anchorKind: "id",
          description: "Auto-detected DOM element inside the design frame",
        },
        ancestors: ["dom:desktop:0", "hero", "page"],
        x: 20,
        y: 24,
      },
    }));

    await waitForText("Start free trial");
    await waitForText("dom-element");

    const backgroundInput = inputForLabel("Background");
    backgroundInput.value = "#111827";
    backgroundInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await waitForText("1 visual");

    const draftRemove = document.querySelector(".design-visual-draft-chip button");
    if (!(draftRemove instanceof window.HTMLButtonElement)) throw new Error("Visual draft remove button not found");
    draftRemove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitFor(() => !(document.body.textContent?.includes("1 visual") ?? false));
  });
});

function mockDesignFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url;
  const method = init?.method ?? "GET";
  if (method === "GET" && url === "/api/agent-servers") {
    return json([{ id: "codex", settings: { type: "registry", registryId: "codex-acp" } }]);
  }
  if (method === "GET" && url === "/api/skills") {
    return json([]);
  }
  if (method === "GET" && url === "/api/agent-servers/codex/capabilities") {
    return json({
      modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
      configOptions: [],
      availableCommands: [],
    });
  }
  if (method === "GET" && url === "/api/design/references") {
    return json([]);
  }
  if (method === "GET" && url === "/api/design/projects") {
    return json([{ name: "Checkout Redesign", path: "/repo/.aflow/.specflow/design/projects/Checkout-Redesign" }]);
  }
  if (method === "GET" && url === "/api/design/sessions?projectName=Checkout%20Redesign") {
    return json([]);
  }
  if (method === "GET" && url === "/api/design/projects/Checkout%20Redesign") {
    return json({
      name: "Checkout Redesign",
      path: "/repo/.aflow/.specflow/design/projects/Checkout-Redesign",
      artifact: sampleArtifact(),
    });
  }
  if (method === "GET" && url === "/api/design/projects/Checkout%20Redesign/files/desktop.md") {
    return Promise.resolve(new Response("Design goals\n\n- Improve checkout clarity.", {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    }));
  }
  if (method === "POST" && url === "/api/design/sessions/initialize?stream=1") {
    return Promise.resolve(new Response(sse([
      ["ready", { at: "2026-06-05T00:00:00.000Z" }],
      ["session", {
        id: "session-1",
        createdAt: "2026-06-05T00:00:00.000Z",
        updatedAt: "2026-06-05T00:00:01.000Z",
        project: { name: "Checkout Redesign", path: "/repo/.aflow/.specflow/design/projects/Checkout-Redesign" },
        agentServerId: "codex",
        acpSessionId: "acp-session-1",
        memoryInjected: true,
        messages: [],
        logs: [{
          type: "acp_timeline",
          id: "log-tool-0",
          at: "2026-06-05T00:00:00.400Z",
          source: "design",
          scopeId: "session-1",
          designSessionId: "session-1",
          kind: "tool_call",
          phase: "message",
          toolCallId: "tool-1",
          title: "Read file",
          status: "pending",
        }, {
          type: "acp_timeline",
          id: "log-tool-1",
          at: "2026-06-05T00:00:00.500Z",
          source: "design",
          scopeId: "session-1",
          designSessionId: "session-1",
          kind: "tool_call_update",
          phase: "message",
          toolCallId: "tool-1",
          status: "in_progress",
        }],
        latestArtifact: sampleArtifact(),
      }],
    ]), {
      headers: { "content-type": "text/event-stream" },
    }));
  }
  return json({ ok: true });
}

function sampleArtifact() {
  return {
    id: "Checkout Redesign",
    projectName: "Checkout Redesign",
    projectPath: "/repo/.aflow/.specflow/design/projects/Checkout-Redesign",
    createdAt: "2026-06-05T00:00:00.000Z",
    frames: [{
      id: "desktop",
      title: "Desktop",
      kind: "desktop",
      width: 960,
      height: 640,
      x: 0,
      y: 0,
      designPath: "desktop.html",
      descriptionPath: "desktop.md",
    }],
  };
}

function json(value: unknown, init?: ResponseInit): Promise<Response> {
  return Promise.resolve(Response.json(value, init));
}

function sse(events: Array<[string, unknown]>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const [event, data] of events) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  });
}

function clickText(text: string): void {
  const target = [...document.querySelectorAll("button, .design-project-item")]
    .find((element) => element.textContent?.includes(text));
  if (!(target instanceof window.HTMLElement)) throw new Error(`Clickable text not found: ${text}`);
  target.click();
}

function clickTextIn(selector: string, text: string): void {
  const scope = document.querySelector(selector);
  if (!(scope instanceof window.HTMLElement)) throw new Error(`Scope not found: ${selector}`);
  const target = [...scope.querySelectorAll("button")]
    .find((element) => element.textContent?.includes(text));
  if (!(target instanceof window.HTMLElement)) throw new Error(`Clickable text not found: ${text}`);
  target.click();
}

function inputForLabel(text: string): HTMLInputElement {
  const label = [...document.querySelectorAll("label.design-property-field")]
    .find((element) => element.textContent?.includes(text));
  const input = label?.querySelector("input");
  if (!(input instanceof window.HTMLInputElement)) throw new Error(`Input label not found: ${text}`);
  return input;
}

async function waitForText(text: string): Promise<void> {
  await waitFor(() => document.body.textContent?.includes(text) ?? false);
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2500) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for assertion. Body: ${document.body.textContent?.slice(0, 500) ?? ""}`);
}
