import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AcpClientHandlers } from "./client-handlers";

describe("AcpClientHandlers", () => {
  it("defaults permission and elicitation requests to cancelled when no UI hook is installed", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-handlers-"));
    const handler = new AcpClientHandlers({
      cwd,
      appendOutput() {},
    });

    const permission = await handler.requestPermission({
      sessionId: "s1",
      toolCall: {
        toolCallId: "tool-1",
        title: "Edit",
        status: "pending",
      },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    expect(permission.outcome.outcome).toBe("cancelled");

    const elicitation = await handler.unstable_createElicitation({
      sessionId: "s1",
      mode: "form",
      message: "Need input",
      requestedSchema: { type: "object" },
    });
    expect(elicitation.action).toBe("cancel");
  });

  it("guards file access to the configured workspace roots", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-handlers-"));
    await writeFile(join(cwd, "input.txt"), "a\nb\nc\n", "utf8");
    const handler = new AcpClientHandlers({
      cwd,
      appendOutput() {},
    });

    const read = await handler.readTextFile({
      sessionId: "s1",
      path: join(cwd, "input.txt"),
      line: 2,
      limit: 1,
    });
    expect(read.content).toBe("b");

    await handler.writeTextFile({
      sessionId: "s1",
      path: join(cwd, "nested/out.txt"),
      content: "ok",
    });
    expect(await readFile(join(cwd, "nested/out.txt"), "utf8")).toBe("ok");

    await expect(handler.readTextFile({
      sessionId: "s1",
      path: join(tmpdir(), "outside.txt"),
    })).rejects.toThrow("Path escapes allowed workspace roots");
  });

  it("supports extension request and notification hooks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-handlers-"));
    const notifications: string[] = [];
    const handler = new AcpClientHandlers({
      cwd,
      appendOutput() {},
      onExtMethod: async (method, params) => ({ method, value: params.value }),
      onExtNotification: (method) => {
        notifications.push(method);
      },
    });

    await expect(handler.extMethod("example/request", { value: 1 })).resolves.toEqual({
      method: "example/request",
      value: 1,
    });
    await handler.extNotification("example/notify", {});
    expect(notifications).toEqual(["example/notify"]);
  });
});
