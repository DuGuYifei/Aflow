import { Window } from "happy-dom";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../i18n";
import type { AgentSessionRecord } from "../api";
import { AgentConversationWindow } from "./agent-conversation-window";
import { RichPromptInput } from "./rich-prompt-input";
import { RunConfigPanel } from "./run-config-panel";
import { PausedNodeComposer } from "./sessions-bar";

declare function describe(name: string, callback: () => void): void;
declare function beforeEach(callback: () => void): void;
declare function afterEach(callback: () => void): void;
declare function test(name: string, callback: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
};

describe("keyboard submit behavior", () => {
  let root: Root | undefined;
  let container: HTMLElement;

  beforeEach(() => {
    const window = new Window({ url: "http://specflow.test" });
    window.SyntaxError = SyntaxError;
    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLButtonElement: window.HTMLButtonElement,
      SVGElement: window.SVGElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      KeyboardEvent: window.KeyboardEvent,
      MouseEvent: window.MouseEvent,
      localStorage: window.localStorage,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    document.body.innerHTML = "";
    root = undefined;
  });

  test("RichPromptInput submits on Enter and keeps Shift+Enter for newline", async () => {
    let submitCount = 0;
    render(
      <RichPromptInput
        value="Design this"
        rows={2}
        onChange={() => {}}
        onSubmit={() => { submitCount += 1; }}
      />,
    );
    const editor = await waitForElement(".rich-prompt-input");

    keyDown(editor, "Enter", { shiftKey: true });
    expect(submitCount).toBe(0);
    keyDown(editor, "Enter");
    expect(submitCount).toBe(1);
  });

  test("resume conversation prompt submits on Enter and not Shift+Enter", async () => {
    const prompts: string[] = [];
    render(
      <I18nProvider>
        <AgentConversationWindow
          session={{
            id: "agent-session-1",
            agentServerId: "codex",
            acpSessionId: "acp-session-1",
          } as AgentSessionRecord}
          mode="continue"
          status="success"
          events={[]}
          canPrompt
          busy={false}
          capabilities={undefined}
          capabilityRefreshing={false}
          modeId=""
          configOptions={{}}
          onRefreshCapabilities={() => Promise.resolve()}
          onChangeMode={() => {}}
          onChangeConfigOption={() => {}}
          onPrompt={(prompt) => prompts.push(prompt)}
          onCancelPrompt={() => {}}
          onClose={() => {}}
        />
      </I18nProvider>,
    );
    const textarea = await waitForTextArea(".conversation-compose textarea");

    setTextAreaValue(textarea, "follow up");
    await tick();
    keyDown(textarea, "Enter", { shiftKey: true });
    expect(prompts).toEqual([]);
    keyDown(textarea, "Enter");
    expect(prompts).toEqual(["follow up"]);
  });

  test("paused node prompt submits on Enter and not Shift+Enter", async () => {
    const prompts: string[] = [];
    render(
      <PausedNodeComposer
        busy={false}
        onPrompt={(prompt) => prompts.push(prompt)}
        onContinue={() => {}}
        t={(key, params) => key === "sessions.pausedAfter"
          ? `Paused after ${params?.node ?? "node"}`
          : key}
      />,
    );
    const textarea = await waitForTextArea(".paused-compose-input textarea");

    setTextAreaValue(textarea, "extra context");
    await tick();
    keyDown(textarea, "Enter", { shiftKey: true });
    expect(prompts).toEqual([]);
    keyDown(textarea, "Enter");
    expect(prompts).toEqual(["extra context"]);
  });

  test("run config starts on Enter and not Shift+Enter", async () => {
    let starts = 0;
    render(
      <I18nProvider>
        <RunConfigPanel
          workflowName="Workflow"
          variables={[]}
          values={{}}
          setValue={() => {}}
          onCancel={() => {}}
          onStart={() => { starts += 1; }}
        />
      </I18nProvider>,
    );
    const modal = await waitForElement(".run-modal");

    keyDown(modal, "Enter", { shiftKey: true });
    expect(starts).toBe(0);
    keyDown(modal, "Enter");
    expect(starts).toBe(1);
  });

  function render(element: ReactNode): void {
    root!.render(element);
  }
});

function setTextAreaValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  setter?.call(element, value);
  const InputEventCtor = window.InputEvent ?? window.Event;
  element.dispatchEvent(new InputEventCtor("input", { bubbles: true }));
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function keyDown(element: Element, key: string, init: KeyboardEventInit = {}): boolean {
  if (element instanceof window.HTMLElement) element.focus();
  return element.dispatchEvent(new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  }));
}

async function waitForElement(selector: string): Promise<HTMLElement> {
  const element = await waitFor(() => document.querySelector(selector));
  if (!(element instanceof window.HTMLElement)) throw new Error(`Element not found: ${selector}`);
  return element;
}

async function waitForTextArea(selector: string): Promise<HTMLTextAreaElement> {
  const element = await waitFor(() => document.querySelector(selector));
  if (!(element instanceof window.HTMLTextAreaElement)) throw new Error(`Textarea not found: ${selector}`);
  return element;
}

async function waitFor<T>(read: () => T | null | undefined): Promise<T> {
  for (let index = 0; index < 50; index += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for element");
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
