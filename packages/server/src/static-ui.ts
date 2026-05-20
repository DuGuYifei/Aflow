import { extname } from "node:path";

const indexPath = "/index.html";
let staticUiAssetsPromise: Promise<Record<string, string>> | undefined;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

export async function serveStaticUi(request: Request): Promise<Response> {
  const staticUiAssets = await loadStaticUiAssets().catch(() => undefined);
  if (!staticUiAssets) {
    return missingAssetsResponse();
  }

  const url = new URL(request.url);
  const suffix = decodeURIComponent(url.pathname);
  const normalized = suffix === "/" ? indexPath : suffix;

  const assetPath = staticUiAssets[normalized];
  if (assetPath) {
    const contentType = contentTypes.get(extname(normalized));
    return new Response(Bun.file(assetPath), {
      headers: contentType ? { "content-type": contentType } : undefined,
    });
  }

  // SPA fallback: unknown routes serve index.html
  if (!staticUiAssets[indexPath]) {
    return missingAssetsResponse();
  }

  return new Response(Bun.file(staticUiAssets[indexPath]), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function loadStaticUiAssets(): Promise<Record<string, string>> {
  staticUiAssetsPromise ??= import("./static-ui-assets.generated")
    .then((module) => module.staticUiAssets);
  return staticUiAssetsPromise;
}

function missingAssetsResponse(): Response {
  return new Response("Specflow UI assets are missing. Run `bun run build` before serving production mode.", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 500,
  });
}
