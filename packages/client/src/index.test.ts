import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpecflowClient } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SpecflowClient", () => {
  test("keeps asset relativePaths aligned with uploaded files", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-client-assets-"));
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    await writeFile(first, "first", "utf8");
    await writeFile(second, "second", "utf8");

    let capturedForm: FormData | undefined;
    globalThis.fetch = (async (_input, init) => {
      capturedForm = init?.body instanceof FormData ? init.body : undefined;
      return new Response(JSON.stringify({ paths: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await new SpecflowClient("http://specflow.test").importWorkflowAssets("wf", {
      kind: "path",
      files: [
        { path: first },
        { path: second, relativePath: "nested/second.txt" },
      ],
    });

    expect(capturedForm?.getAll("relativePaths")).toEqual(["first.txt", "nested/second.txt"]);
  });
});
