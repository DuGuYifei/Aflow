import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { createDesignApiHandler } from "./api";
import { createDesignProject, designProjectPath } from "./projects";
import { DesignRuntimeManager } from "./runtime-manager";

describe("design API", () => {
  test("imports a copied reference and lists it", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const source = await mkdtemp(join(tmpdir(), "specflow-design-ref-"));
    await mkdir(join(source, "src"), { recursive: true });
    await writeFile(join(source, "src", "page.tsx"), "export function Page() { return null; }", "utf8");
    const handle = createDesignApiHandler(root);

    const imported = await handle(new Request("http://specflow.test/api/design/references/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "copy", name: "app ref", sourcePath: source }),
    }));

    expect(imported?.status).toBe(200);
    const importedBody = await imported!.json() as { name: string; path: string };
    expect(importedBody).toMatchObject({
      name: "app-ref",
      path: join(root, ".aflow/.specflow/design/references/app-ref"),
    });
    expect(await readFile(join(root, ".aflow/.specflow/design/references/app-ref/src/page.tsx"), "utf8")).toContain("Page");

    const listed = await handle(new Request("http://specflow.test/api/design/references"));
    expect(listed?.status).toBe(200);
    expect(await listed!.json()).toEqual([{
      name: "app-ref",
      path: join(root, ".aflow/.specflow/design/references/app-ref"),
    }]);

    const removedRoute = await handle(new Request("http://specflow.test/api/design/references/app-ref/parse", { method: "POST" }));
    expect(removedRoute?.status).toBe(404);
  });

  test("copy import skips generated and dependency directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const source = await mkdtemp(join(tmpdir(), "specflow-design-ref-"));
    await mkdir(join(source, "src"), { recursive: true });
    await mkdir(join(source, "node_modules/lib"), { recursive: true });
    await mkdir(join(source, "dist"), { recursive: true });
    await mkdir(join(source, ".git"), { recursive: true });
    await writeFile(join(source, "src", "page.tsx"), "export function Page() { return null; }", "utf8");
    await writeFile(join(source, "node_modules/lib", "index.js"), "module.exports = {}", "utf8");
    await writeFile(join(source, "dist", "bundle.js"), "compiled", "utf8");
    await writeFile(join(source, ".git", "config"), "[core]", "utf8");
    const handle = createDesignApiHandler(root);

    const imported = await handle(new Request("http://specflow.test/api/design/references/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "copy", name: "clean ref", sourcePath: source }),
    }));

    expect(imported?.status).toBe(200);
    const target = join(root, ".aflow/.specflow/design/references/clean-ref");
    expect(await readFile(join(target, "src/page.tsx"), "utf8")).toContain("Page");
    expect(await exists(join(target, "node_modules/lib/index.js"))).toBe(false);
    expect(await exists(join(target, "dist/bundle.js"))).toBe(false);
    expect(await exists(join(target, ".git/config"))).toBe(false);
  });

  test("creates projects and serves project html files", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const handle = createDesignApiHandler(root);

    const created = await handle(new Request("http://specflow.test/api/design/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Billing App" }),
    }));
    expect(created?.status).toBe(200);
    const createdBody = await created!.json() as { name: string; path: string };
    expect(createdBody).toMatchObject({
      name: "Billing-App",
      path: join(root, ".aflow/.specflow/design/projects/Billing-App"),
    });

    await writeFile(join(createdBody.path, "desktop.html"), "<!doctype html><html><head></head><body><main data-component-id=\"root\">ok</main></body></html>", "utf8");
    await writeFile(join(createdBody.path, "manifest.json"), JSON.stringify({
      frames: [{
        id: "desktop",
        title: "Desktop",
        width: 1440,
        height: 1024,
        x: 0,
        y: 0,
        designPath: "desktop.html",
      }],
    }), "utf8");

    const listed = await handle(new Request("http://specflow.test/api/design/projects"));
    expect(listed?.status).toBe(200);
    expect(await listed!.json()).toEqual([expect.objectContaining({ name: "Billing-App" })]);

    const detail = await handle(new Request("http://specflow.test/api/design/projects/Billing-App"));
    expect(detail?.status).toBe(200);
    expect(await detail!.json()).toMatchObject({
      name: "Billing-App",
      artifact: { projectName: "Billing-App", frames: [expect.objectContaining({ designPath: "desktop.html" })] },
    });

    const response = await handle(new Request("http://specflow.test/api/design/projects/Billing-App/files/desktop.html?selected=root"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    const html = await response!.text();
    expect(html).toContain("__aflow_design_selected");
    expect(html).toContain("design-component-hover");
    expect(html).toContain("__aflowAncestors");
    expect(html).toContain("__aflowLayerColors");
    expect(html).toContain("__aflowComponentDepth");
    expect(html).toContain("__aflowSourcePath");
    expect(html).toContain("__aflowXPath");
    expect(html).toContain("selectionLevel");
    expect(html).toContain("anchorKind");
    expect(html).toContain("__aflowRestoreDrafts");
    expect(html).toContain("data-aflow-dom-id");
    expect(html).toContain("__aflowDescribe");
  });

  test("creates React projects with an empty scaffold and bridge", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const handle = createDesignApiHandler(root);

    const created = await handle(new Request("http://specflow.test/api/design/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "React App", kind: "react" }),
    }));
    expect(created?.status).toBe(200);
    const createdBody = await created!.json() as { name: string; path: string; kind: string };
    expect(createdBody).toMatchObject({
      name: "React-App",
      kind: "react",
      path: join(root, ".aflow/.specflow/design/projects/React-App"),
    });
    expect(await readFile(join(createdBody.path, ".aflow-design/project.json"), "utf8")).toContain("\"kind\": \"react\"");
    expect(await readFile(join(createdBody.path, ".aflow-design/project.json"), "utf8")).toContain("\"command\": \"npm\"");
    expect(await readFile(join(createdBody.path, "src/aflow-design-bridge.ts"), "utf8")).toContain("initializeAflowDesignBridge");
    const packageJson = JSON.parse(await readFile(join(createdBody.path, "package.json"), "utf8")) as { engines?: { node?: string }; dependencies?: Record<string, string> };
    expect(packageJson.engines?.node).toBe("^20.19.0 || >=22.12.0");
    expect(packageJson.dependencies?.vite).toBe("^7.2.2");
    expect(await readFile(join(createdBody.path, "manifest.json"), "utf8")).toContain("\"frames\": []");
    expect(await exists(join(createdBody.path, "desktop.md"))).toBe(false);
    expect(await exists(join(createdBody.path, "mobile.md"))).toBe(false);

    const detail = await handle(new Request("http://specflow.test/api/design/projects/React-App"));
    expect(detail?.status).toBe(200);
    const detailBody = await detail!.json() as { artifact?: { frames?: unknown[] } };
    expect(detailBody).toMatchObject({
      name: "React-App",
      kind: "react",
      runtime: { kind: "react", status: "stopped" },
      artifact: {
        kind: "react",
        runtime: { kind: "react", status: "stopped" },
      },
    });
    expect(detailBody.artifact?.frames).toBeUndefined();

    const runtime = await handle(new Request("http://specflow.test/api/design/projects/React-App/runtime"));
    expect(runtime?.status).toBe(200);
    expect(await runtime!.json()).toMatchObject({ kind: "react", status: "stopped" });
  });

  test("rejects React project creation when Node is missing or unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));

    await expect(createDesignProject(root, "Missing Node", "react", {
      readNodeVersion: async () => {
        throw new Error("node not found");
      },
    })).rejects.toThrow("当前电脑未检测到 Node.js");
    expect(await exists(designProjectPath(root, "Missing-Node"))).toBe(false);

    await expect(createDesignProject(root, "Old Node", "react", {
      readNodeVersion: async () => "v20.18.1",
    })).rejects.toThrow("当前 Node.js 版本过低");
    expect(await exists(designProjectPath(root, "Old-Node"))).toBe(false);
  });

  test("rejects React runtime start when Node becomes unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const projectPath = designProjectPath(root, "React-App");
    await mkdir(join(projectPath, ".aflow-design"), { recursive: true });
    await writeFile(join(projectPath, ".aflow-design/project.json"), JSON.stringify({ kind: "react" }), "utf8");
    const manager = new DesignRuntimeManager(root, {
      readNodeVersion: async () => "v21.0.0",
    });

    await expect(manager.start("React-App")).rejects.toThrow("当前 Node.js 版本过低");
    expect(await manager.status("React-App")).toMatchObject({ kind: "react", status: "stopped" });
  });

  test("uploads design chat images into cwd tmp", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const handle = createDesignApiHandler(root);

    const created = await handle(new Request("http://specflow.test/api/design/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Screenshot Ref" }),
    }));
    const project = await created!.json() as { name: string; path: string };

    const form = new FormData();
    form.append("files", new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }));
    const uploaded = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/tmp/images`, {
      method: "POST",
      body: form,
    }));

    expect(uploaded?.status).toBe(200);
    const body = await uploaded!.json() as Array<{ kind: string; path: string; name: string; mimeType: string }>;
    expect(body[0]).toMatchObject({ kind: "image", name: "shot.png", mimeType: "image/png" });
    expect(body[0]!.path.startsWith("tmp/")).toBe(true);
    expect(await exists(join(root, body[0]!.path))).toBe(true);
    const served = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/files/${encodeURIComponent(body[0]!.path)}`));
    expect(served?.status).toBe(200);
    expect(served?.headers.get("content-type")).toBe("image/png");
  });

  test("records project versions and branches from an older version", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-design-"));
    const handle = createDesignApiHandler(root);

    const created = await handle(new Request("http://specflow.test/api/design/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Versioned App" }),
    }));
    const project = await created!.json() as { name: string; path: string };
    await writeFile(join(project.path, "desktop.html"), "<!doctype html><main>v1</main>", "utf8");

    const before = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/version`));
    expect(before?.status).toBe(200);
    const beforeBody = await before!.json() as { gitAvailable: boolean; initialized: boolean };
    if (!beforeBody.gitAvailable) return;
    expect(beforeBody.initialized).toBe(false);

    const first = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/version/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authorName: "Designer", authorEmail: "designer@example.com", note: "baseline" }),
    }));
    expect(first?.status).toBe(200);
    const firstBody = await first!.json() as {
      initialized: boolean;
      dirty: boolean;
      currentBranch: string;
      currentHead: string;
      commits: Array<{ hash: string; message: string; note?: string; branches: string[] }>;
      settings: { versionControl?: { authorName?: string; authorEmail?: string } };
    };
    expect(firstBody.initialized).toBe(true);
    expect(firstBody.dirty).toBe(false);
    expect(firstBody.currentBranch.startsWith("design-")).toBe(true);
    expect(firstBody.commits[0]!.message).toContain("[baseline]");
    expect(firstBody.commits[0]!.note).toBe("baseline");
    expect(firstBody.settings.versionControl).toMatchObject({ authorName: "Designer", authorEmail: "designer@example.com" });
    const firstHash = firstBody.currentHead;
    const originalBranch = firstBody.currentBranch;

    await writeFile(join(project.path, "desktop.html"), "<!doctype html><main>v2</main>", "utf8");
    const dirty = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/version`));
    expect(dirty?.status).toBe(200);
    expect((await dirty!.json() as { dirty: boolean }).dirty).toBe(true);

    const second = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/version/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authorName: "Designer", authorEmail: "designer@example.com" }),
    }));
    expect(second?.status).toBe(200);
    const secondBody = await second!.json() as { currentHead: string; commits: Array<{ message: string }> };
    expect(secondBody.currentHead).not.toBe(firstHash);
    expect(secondBody.commits[0]!.message).not.toContain("[]");

    const branch = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/version/branch-from`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitHash: firstHash }),
    }));
    expect(branch?.status).toBe(200);
    const branchBody = await branch!.json() as { currentBranch: string; currentHead: string; dirty: boolean };
    expect(branchBody.currentBranch.startsWith("from-")).toBe(true);
    expect(branchBody.currentHead).toBe(firstHash);
    expect(branchBody.dirty).toBe(false);
    expect(await readFile(join(project.path, "desktop.html"), "utf8")).toContain("v1");

    execFileSync("git", ["checkout", originalBranch], { cwd: project.path, stdio: "ignore" });
    const checkoutExisting = await handle(new Request(`http://specflow.test/api/design/projects/${encodeURIComponent(project.name)}/version/branch-from`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitHash: firstHash }),
    }));
    expect(checkoutExisting?.status).toBe(200);
    const checkoutBody = await checkoutExisting!.json() as { currentBranch: string; currentHead: string };
    expect(checkoutBody.currentBranch).toBe(branchBody.currentBranch);
    expect(checkoutBody.currentHead).toBe(firstHash);
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
