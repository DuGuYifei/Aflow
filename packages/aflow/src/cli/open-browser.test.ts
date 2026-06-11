import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import {
  openUrlInDefaultBrowser,
  resolveBrowserCommand,
  type BrowserChildProcess,
  type BrowserSpawn,
} from "./open-browser";

describe("open browser helper", () => {
  test("resolves platform-specific browser commands", () => {
    expect(resolveBrowserCommand("http://localhost:5173/", "darwin")).toEqual({
      command: "open",
      args: ["http://localhost:5173/"],
    });
    expect(resolveBrowserCommand("http://localhost:5173/", "win32")).toEqual({
      command: "cmd.exe",
      args: ["/c", "start", "", "http://localhost:5173/"],
    });
    expect(resolveBrowserCommand("http://localhost:5173/design", "linux", { WSL_DISTRO_NAME: "Ubuntu" })).toEqual({
      command: "cmd.exe",
      args: ["/c", "start", "", "http://localhost:5173/design"],
    });
    expect(resolveBrowserCommand("http://localhost:5173/", "linux", {})).toEqual({
      command: "xdg-open",
      args: ["http://localhost:5173/"],
    });
  });

  test("reports success after the browser process spawns", async () => {
    const child = fakeChildProcess();
    let unrefCalled = false;
    child.unref = () => { unrefCalled = true; };
    const spawn: BrowserSpawn = (command, args, options) => {
      expect(command).toBe("xdg-open");
      expect(args).toEqual(["http://localhost:5173/"]);
      expect(options).toEqual({ detached: true, stdio: "ignore" });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    };

    await expect(openUrlInDefaultBrowser("http://localhost:5173/", {
      platform: "linux",
      env: {},
      spawn,
    })).resolves.toEqual({ ok: true, command: "xdg-open" });
    expect(unrefCalled).toBe(true);
  });

  test("reports spawn errors without throwing", async () => {
    const child = fakeChildProcess();
    const spawn: BrowserSpawn = () => {
      queueMicrotask(() => child.emit("error", new Error("missing opener")));
      return child;
    };

    await expect(openUrlInDefaultBrowser("http://localhost:5173/", {
      platform: "linux",
      env: {},
      spawn,
    })).resolves.toEqual({ ok: false, command: "xdg-open", error: "missing opener" });
  });
});

function fakeChildProcess(): BrowserChildProcess & EventEmitter {
  return new EventEmitter() as BrowserChildProcess & EventEmitter;
}
