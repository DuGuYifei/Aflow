import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../i18n";
import { RuntimeControlBar } from "./runtime-control-bar";

declare function describe(name: string, callback: () => void): void;
declare function beforeEach(callback: () => void): void;
declare function afterEach(callback: () => void): void;
declare function test(name: string, callback: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toBe(expected: unknown): void;
};

describe("RuntimeControlBar", () => {
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
      localStorage: window.localStorage,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    document.body.innerHTML = "";
    root = undefined;
  });

  test("shows a top-layer tooltip for player controls", async () => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <RuntimeControlBar
          status="running"
          onPause={() => undefined}
          onInterrupt={() => undefined}
          onPlay={() => undefined}
          onStop={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => document.querySelector('button[aria-label="Pause after current node"]') instanceof window.HTMLElement);
    await showTooltip(document.querySelector('button[aria-label="Pause after current node"]'), "Pause after current node");
  });
});

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
      && tooltip.style.position === "fixed";
  });
  trigger.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
