import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { uuidv7 } from "@specflow/shared";
import {
  defaultReferenceNameFromSource,
  importDesignReference,
  listDesignReferences,
} from "./references";
import { initializeDesignSession, listDesignSessions, loadDesignSession, sendDesignMessage } from "./sessions";
import { loadDesignProjectArtifact, safeProjectRelativePath } from "./artifacts";
import { createDesignProject, designProjectPath, listDesignProjects, loadDesignProject, sanitizeDesignProjectName } from "./projects";
import {
  branchDesignVersionFromCommit,
  loadDesignVersionState,
  recordDesignVersion,
} from "./version-control";
import type {
  DesignBranchFromVersionRequest,
  DesignInitializeSessionRequest,
  DesignMessageAttachment,
  DesignRecordVersionRequest,
  DesignReferenceImportRequest,
  DesignSendMessageRequest,
} from "./types";

export function createDesignApiHandler(root: string): (request: Request) => Promise<Response | null> {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (!pathname.startsWith("/api/design")) return null;

    try {
      if (request.method === "GET" && pathname === "/api/design/health") {
        return Response.json({ ok: true, product: "design", apiVersion: 1 });
      }

      if (request.method === "GET" && pathname === "/api/design/references") {
        return Response.json(await listDesignReferences(root));
      }

      if (request.method === "GET" && pathname === "/api/design/projects") {
        return Response.json(await listDesignProjects(root));
      }

      if (request.method === "POST" && pathname === "/api/design/projects") {
        const body = await request.json() as { name?: unknown };
        return Response.json(await createDesignProject(root, typeof body.name === "string" ? body.name : ""));
      }

      if (request.method === "POST" && pathname === "/api/design/references/import") {
        const body = await request.json() as Partial<DesignReferenceImportRequest>;
        const requestWithName = withDefaultReferenceName(body);
        return Response.json(await importDesignReference(root, requestWithName));
      }

      if (request.method === "POST" && pathname === "/api/design/sessions/messages") {
        const body = await request.json() as Partial<DesignSendMessageRequest>;
        const messageRequest = {
          sessionId: body.sessionId,
          projectName: body.projectName ?? "",
          agentServerId: body.agentServerId ?? "",
          message: body.message ?? "",
          attachments: parseDesignAttachments(body.attachments),
          referenceName: body.referenceName,
          referenceInterfaceDescription: body.referenceInterfaceDescription,
          modeId: body.modeId,
          configOptions: body.configOptions,
        };
        if (url.searchParams.get("stream") === "1" || request.headers.get("accept")?.includes("text/event-stream")) {
          return streamDesignMessage(root, messageRequest, request.signal);
        }
        return Response.json(await sendDesignMessage(root, messageRequest, { signal: request.signal }));
      }

      if (request.method === "POST" && pathname === "/api/design/sessions/initialize") {
        const body = await request.json() as Partial<DesignInitializeSessionRequest>;
        const initRequest = {
          projectName: body.projectName ?? "",
          agentServerId: body.agentServerId ?? "",
          referenceName: body.referenceName,
          referenceInterfaceDescription: body.referenceInterfaceDescription,
          modeId: body.modeId,
          configOptions: body.configOptions,
        };
        if (url.searchParams.get("stream") === "1" || request.headers.get("accept")?.includes("text/event-stream")) {
          return streamDesignOperation(
            request.signal,
            (signal, onLog) => initializeDesignSession(root, initRequest, { signal, onLog }),
          );
        }
        return Response.json(await initializeDesignSession(root, initRequest, { signal: request.signal }));
      }

      const imageUploadMatch = pathname.match(/^\/api\/design\/projects\/([^/]+)\/tmp\/images$/);
      if (imageUploadMatch && request.method === "POST") {
        return Response.json(await uploadDesignProjectImages(root, decodeURIComponent(imageUploadMatch[1]!), request));
      }

      const projectVersionMatch = pathname.match(/^\/api\/design\/projects\/([^/]+)\/version(?:\/([^/]+))?$/);
      if (projectVersionMatch) {
        const projectName = decodeURIComponent(projectVersionMatch[1]!);
        const action = projectVersionMatch[2];
        if (request.method === "GET" && !action) {
          return Response.json(await loadDesignVersionState(root, projectName));
        }
        if (request.method === "POST" && action === "commit") {
          const body = await request.json() as Partial<DesignRecordVersionRequest>;
          return Response.json(await recordDesignVersion(root, projectName, {
            authorName: body.authorName ?? "",
            authorEmail: body.authorEmail ?? "",
            ...(typeof body.note === "string" ? { note: body.note } : {}),
          }));
        }
        if (request.method === "POST" && action === "branch-from") {
          const body = await request.json() as Partial<DesignBranchFromVersionRequest>;
          return Response.json(await branchDesignVersionFromCommit(root, projectName, {
            commitHash: body.commitHash ?? "",
            ...(typeof body.branchName === "string" ? { branchName: body.branchName } : {}),
          }));
        }
      }

      if (request.method === "GET" && pathname === "/api/design/sessions") {
        return Response.json(await listDesignSessions(root, url.searchParams.get("projectName") ?? undefined));
      }

      const projectFileMatch = pathname.match(/^\/api\/design\/projects\/([^/]+)\/files\/(.+)$/);
      if (projectFileMatch && request.method === "GET") {
        return serveDesignProjectFile(
          root,
          decodeURIComponent(projectFileMatch[1]!),
          decodeURIComponent(projectFileMatch[2]!),
          url.searchParams.get("selected") ?? "",
          url.searchParams.get("view") ?? "",
          url.searchParams.get("frameId") ?? "",
        );
      }

      const projectMatch = pathname.match(/^\/api\/design\/projects\/([^/]+)$/);
      if (projectMatch && request.method === "GET") {
        const name = sanitizeDesignProjectName(decodeURIComponent(projectMatch[1]!));
        const path = designProjectPath(root, name);
        const projectStat = await stat(path).catch(() => undefined);
        if (!projectStat?.isDirectory()) throw httpError(404, `Design project not found: ${name}`);
        return Response.json({
          name,
          path,
          updatedAt: projectStat.mtime.toISOString(),
          artifact: await loadDesignProjectArtifact(name, path),
        });
      }

      const sessionMatch = pathname.match(/^\/api\/design\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === "GET") {
        return Response.json(await loadDesignSession(root, decodeURIComponent(sessionMatch[1]!)));
      }

      return Response.json({ error: "Design API route not found" }, { status: 404 });
    } catch (error) {
      return designErrorResponse(error);
    }
  };
}

async function uploadDesignProjectImages(root: string, projectName: string, request: Request): Promise<DesignMessageAttachment[]> {
  await loadDesignProject(root, projectName);
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) throw httpError(400, "No images supplied.");
  const outputDir = join(root, "tmp");
  await mkdir(outputDir, { recursive: true });
  const attachments: DesignMessageAttachment[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) throw httpError(400, "Images only.");
    const extension = extname(file.name) || mimeExtension(file.type);
    const filename = `${uuidv7()}${extension}`;
    await writeFile(join(outputDir, filename), new Uint8Array(await file.arrayBuffer()));
    attachments.push({
      id: uuidv7(),
      kind: "image",
      path: `tmp/${filename}`,
      name: basename(file.name) || filename,
      ...(file.type ? { mimeType: file.type } : {}),
    });
  }
  return attachments;
}

function parseDesignAttachments(value: unknown): DesignMessageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item): DesignMessageAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<DesignMessageAttachment>;
    if (input.kind !== "image" || typeof input.path !== "string" || typeof input.name !== "string") return [];
    return [{
      id: typeof input.id === "string" ? input.id : uuidv7(),
      kind: "image",
      path: safeProjectRelativePath(input.path),
      name: input.name,
      ...(typeof input.mimeType === "string" ? { mimeType: input.mimeType } : {}),
    }];
  });
  return attachments.length ? attachments : undefined;
}

function streamDesignMessage(root: string, body: DesignSendMessageRequest, signal: AbortSignal): Response {
  return streamDesignOperation(signal, (runSignal, onLog) => sendDesignMessage(root, body, {
    signal: runSignal,
    onLog,
  }));
}

function streamDesignOperation(
  signal: AbortSignal,
  run: (signal: AbortSignal, onLog: NonNullable<Parameters<typeof sendDesignMessage>[2]>["onLog"]) => Promise<unknown>,
): Response {
  const encoder = new TextEncoder();
  const runAbort = new AbortController();
  const abortRun = () => runAbort.abort();
  signal.addEventListener("abort", abortRun, { once: true });
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may already have gone away.
        }
      };
      enqueue("ready", { at: new Date().toISOString() });
      void run(runAbort.signal, (entry) => enqueue("log", entry))
        .then((session) => enqueue("session", session))
        .catch((error) => enqueue("error", designErrorPayload(error)))
        .finally(() => {
          signal.removeEventListener("abort", abortRun);
          close();
        });
    },
    cancel() {
      closed = true;
      runAbort.abort();
      signal.removeEventListener("abort", abortRun);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

async function serveDesignProjectFile(
  root: string,
  projectName: string,
  assetPath: string,
  selectedComponentId: string,
  view: string,
  frameId: string,
): Promise<Response> {
  const name = sanitizeDesignProjectName(projectName);
  const normalizedAssetPath = safeProjectRelativePath(normalize(assetPath));
  const projectRoot = designProjectPath(root, name);
  const filePath = normalizedAssetPath === "tmp" || normalizedAssetPath.startsWith("tmp/")
    ? join(root, normalizedAssetPath)
    : join(projectRoot, normalizedAssetPath);
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) throw httpError(404, "Design project file not found.");
  const contentType = contentTypeFor(filePath);
  const rawContent = await readFile(filePath);
  const body = contentType.startsWith("text/html")
    ? injectDesignFrameBridge(rawContent.toString("utf8"), selectedComponentId, view, frameId)
    : rawContent;
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-cache",
    },
  });
}

function injectDesignFrameBridge(source: string, selectedComponentId: string, view: string, frameId: string): string {
  const bridge = [
    "<style>",
    "[data-component-id],[data-aflow-dom-id]{cursor:pointer;transition:opacity 120ms,filter 120ms,outline-color 120ms,box-shadow 120ms;}",
    ".__aflow_design_selected{outline:2px solid var(--aflow-design-outline-color,#2563eb)!important;outline-offset:3px!important;box-shadow:0 0 0 1px color-mix(in srgb,var(--aflow-design-outline-color,#2563eb),transparent 30%)!important;opacity:1!important;filter:none!important;}",
    ".__aflow_design_hover{outline:2px solid var(--aflow-design-outline-color,#0ea5e9)!important;outline-offset:2px!important;box-shadow:0 0 0 1px color-mix(in srgb,var(--aflow-design-outline-color,#0ea5e9),transparent 42%)!important;}",
    "</style>",
    "<script>",
    `const __aflowSelectedComponent=${JSON.stringify(selectedComponentId)};`,
    `const __aflowDesignView=${JSON.stringify(view)};`,
    `const __aflowFrameId=${JSON.stringify(frameId)};`,
    "const __aflowLayerColors=['#0ea5e9','#8b5cf6','#f97316','#22c55e','#e11d48','#14b8a6','#f59e0b'];",
    "const __aflowComponentSelector='[data-component-id]';",
    "const __aflowDomSelector='[data-component-id],[data-aflow-dom-id]';",
    "function __aflowSelector(){return __aflowDesignView==='wireframe'?__aflowComponentSelector:__aflowDomSelector;}",
    "const __aflowIgnoredTags=new Set(['HTML','HEAD','BODY','SCRIPT','STYLE','META','LINK','TITLE','NOSCRIPT','TEMPLATE']);",
    "let __aflowHoverId='';",
    "let __aflowDomCounter=0;",
    "let __aflowStyleDrafts={};",
    "function __aflowNodeId(node){return node?(node.getAttribute('data-component-id')||node.getAttribute('data-aflow-dom-id')||''):'';}",
    "function __aflowEscapeAttr(value){return String(value).replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"');}",
    "function __aflowQueryById(id){return document.querySelector('[data-component-id=\"'+CSS.escape(id)+'\"],[data-aflow-dom-id=\"'+CSS.escape(id)+'\"]');}",
    "function __aflowIsSelectable(node){if(!node||node.nodeType!==1||__aflowIgnoredTags.has(node.tagName))return false;if(node.closest('[data-aflow-ignore=\"true\"],[hidden]'))return false;const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.pointerEvents==='none')return false;const rects=Array.from(node.getClientRects());return rects.some((rect)=>rect.width>=3&&rect.height>=3);}",
    "function __aflowEnsureSelectableIds(){if(__aflowDesignView==='wireframe')return;document.querySelectorAll('body *').forEach((node)=>{if(node.hasAttribute('data-component-id')||node.hasAttribute('data-aflow-dom-id'))return;if(!__aflowIsSelectable(node))return;node.setAttribute('data-aflow-dom-id','dom:'+(__aflowFrameId||'frame')+':'+String(__aflowDomCounter++));});}",
    "function __aflowCssPath(node){const parts=[];let current=node;while(current&&current.nodeType===1&&current.tagName!=='BODY'&&current.tagName!=='HTML'){let part=current.tagName.toLowerCase();if(current.id){part+='#'+current.id;parts.unshift(part);break;}let nth=1;let sibling=current.previousElementSibling;while(sibling){if(sibling.tagName===current.tagName)nth+=1;sibling=sibling.previousElementSibling;}part+=':nth-of-type('+nth+')';parts.unshift(part);current=current.parentElement;}return parts.join(' > ');}",
    "function __aflowRound(value){return Math.round(Number(value)*10)/10;}",
    "function __aflowComputedStyle(node){if(!node)return {};const style=getComputedStyle(node);return {display:style.display,position:style.position,left:style.left,top:style.top,right:style.right,bottom:style.bottom,width:style.width,height:style.height,transform:style.transform,color:style.color,backgroundColor:style.backgroundColor,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,textAlign:style.textAlign,letterSpacing:style.letterSpacing,border:style.border,borderRadius:style.borderRadius,padding:style.padding,margin:style.margin,opacity:style.opacity,flexDirection:style.flexDirection,alignItems:style.alignItems,justifyContent:style.justifyContent,gap:style.gap,boxShadow:style.boxShadow};}",
    "function __aflowBounds(node){if(!node)return undefined;const rect=node.getBoundingClientRect();return {x:__aflowRound(rect.x),y:__aflowRound(rect.y),width:__aflowRound(rect.width),height:__aflowRound(rect.height)};}",
    "function __aflowDirectChildren(node){if(!node)return [];const selector=__aflowSelector();return Array.from(node.children||[]).filter((child)=>child.matches&&child.matches(selector)).slice(0,120).map((child)=>__aflowDescribe(child,false));}",
    "function __aflowDescribe(node,includeChildren=false){const id=__aflowNodeId(node);const explicit=Boolean(node&&node.hasAttribute('data-component-id'));const tag=node?node.tagName.toLowerCase():'element';const text=((node&&node.getAttribute('aria-label'))||(node&&node.getAttribute('alt'))||(node&&node.getAttribute('title'))||(node&&node.getAttribute('data-component-name'))||(node&&node.textContent)||'').replace(/\\s+/g,' ').trim();const name=(text?text.slice(0,56):tag)+(text.length>56?'...':'');const selector=explicit?'[data-component-id=\"'+__aflowEscapeAttr(id)+'\"]':__aflowCssPath(node);const children=includeChildren?__aflowDirectChildren(node):[];return {id,name,type:explicit?'component:'+tag:'dom:'+tag,selector,bounds:__aflowBounds(node),computedStyle:__aflowComputedStyle(node),description:explicit?'Declared design component':'Auto-detected DOM element inside the design frame',children};}",
    "function __aflowComponentDepth(node){let depth=0;let parent=node?node.parentElement:null;const selector=__aflowSelector();while(parent){if(parent.matches&&parent.matches(selector))depth+=1;parent=parent.parentElement;}return depth;}",
    "function __aflowLayerColor(node){return __aflowLayerColors[__aflowComponentDepth(node)%__aflowLayerColors.length];}",
    "function __aflowApplySelection(){",
    "__aflowEnsureSelectableIds();",
    "document.documentElement.dataset.aflowDesignView=__aflowDesignView||'html';",
    "const nodes=document.querySelectorAll(__aflowSelector());",
    "nodes.forEach((node)=>{",
    "const id=__aflowNodeId(node);",
    "const active=Boolean(__aflowSelectedComponent)&&id===__aflowSelectedComponent;",
    "const highlighted=active||(Boolean(__aflowHoverId)&&id===__aflowHoverId&&!active);",
    "if(highlighted)node.style.setProperty('--aflow-design-outline-color',__aflowLayerColor(node));else node.style.removeProperty('--aflow-design-outline-color');",
    "node.classList.toggle('__aflow_design_selected',active);",
    "node.classList.toggle('__aflow_design_hover',Boolean(__aflowHoverId)&&id===__aflowHoverId&&!active);",
    "});",
    "}",
    "function __aflowApplyDrafts(){",
    "Object.entries(__aflowStyleDrafts||{}).forEach(([id,style])=>{",
    "const node=__aflowQueryById(id);",
    "if(!node||!style||typeof style!=='object')return;",
    "if(node.dataset.aflowBaseX===undefined||node.dataset.aflowBaseY===undefined){const rect=node.getBoundingClientRect();node.dataset.aflowBaseX=String(rect.x);node.dataset.aflowBaseY=String(rect.y);node.dataset.aflowBaseTransform=node.style.transform||'';}",
    "const baseX=Number(node.dataset.aflowBaseX||0);",
    "const baseY=Number(node.dataset.aflowBaseY||0);",
    "const targetX=Number.parseFloat(String(style.__aflowX));",
    "const targetY=Number.parseFloat(String(style.__aflowY));",
    "const hasX=Number.isFinite(targetX);",
    "const hasY=Number.isFinite(targetY);",
    "if(hasX||hasY){const dx=hasX?targetX-baseX:0;const dy=hasY?targetY-baseY:0;node.style.transform=[node.dataset.aflowBaseTransform||'',`translate(${dx}px, ${dy}px)`].filter(Boolean).join(' ');}",
    "Object.entries(style).forEach(([key,value])=>{try{if(key==='__aflowX'||key==='__aflowY')return;node.style[key]=String(value)}catch{}});",
    "});",
    "}",
    "function __aflowAncestors(target){",
    "const output=[];",
    "let node=target;",
    "while(node&&node.closest){",
    "node=node.closest(__aflowSelector());",
    "if(!node)break;",
    "const id=__aflowNodeId(node);",
    "if(id&&!output.includes(id))output.push(id);",
    "node=node.parentElement;",
    "}",
    "return output;",
    "}",
    "function __aflowAncestorComponents(target){",
    "const output=[];",
    "let node=target;",
    "while(node&&node.closest){",
    "node=node.closest(__aflowSelector());",
    "if(!node)break;",
    "const id=__aflowNodeId(node);",
    "if(id&&!output.some((item)=>item.id===id))output.push(__aflowDescribe(node,false));",
    "node=node.parentElement;",
    "}",
    "return output.reverse();",
    "}",
    "document.addEventListener('mousemove',(event)=>{",
    "__aflowEnsureSelectableIds();",
    "const target=event.target && event.target.closest ? event.target.closest(__aflowSelector()) : null;",
    "const id=__aflowNodeId(target);",
    "if(id!==__aflowHoverId){__aflowHoverId=id;__aflowApplySelection();if(id)window.parent.postMessage({type:'design-component-hover',frameId:__aflowFrameId,id,component:__aflowDescribe(target,false),x:event.clientX,y:event.clientY},'*');}",
    "},true);",
    "document.addEventListener('click',(event)=>{",
    "__aflowEnsureSelectableIds();",
    "const target=event.target && event.target.closest ? event.target.closest(__aflowSelector()) : null;",
    "if(!target)return;",
    "event.preventDefault();",
    "event.stopPropagation();",
    "window.parent.postMessage({type:'design-component-selected',frameId:__aflowFrameId,id:__aflowNodeId(target),component:__aflowDescribe(target,false),ancestors:__aflowAncestors(target),x:event.clientX,y:event.clientY},'*');",
    "},true);",
    "window.addEventListener('message',(event)=>{const data=event.data||{};if(data.type==='design-style-drafts'){__aflowStyleDrafts=data.drafts||{};__aflowApplyDrafts();return;}if(data.type==='design-component-hierarchy-request'&&typeof data.id==='string'){__aflowEnsureSelectableIds();const node=__aflowQueryById(data.id);if(!node)return;window.parent.postMessage({type:'design-component-hierarchy',requestId:data.requestId,frameId:__aflowFrameId,id:data.id,component:__aflowDescribe(node,true),path:__aflowAncestorComponents(node)},'*');}});",
    "window.addEventListener('DOMContentLoaded',()=>{__aflowApplySelection();__aflowApplyDrafts();});",
    "__aflowApplySelection();__aflowApplyDrafts();",
    "</script>",
  ].join("");
  return /<\/head>/i.test(source)
    ? source.replace(/<\/head>/i, `${bridge}</head>`)
    : `${bridge}${source}`;
}

function contentTypeFor(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".md") return "text/markdown; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

function mimeExtension(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".bin";
}

function withDefaultReferenceName(body: Partial<DesignReferenceImportRequest>): DesignReferenceImportRequest {
  if (body.type === "git") {
    return {
      type: "git",
      name: body.name?.trim() || defaultReferenceNameFromSource(body.url ?? ""),
      url: body.url ?? "",
      ...(body.branch ? { branch: body.branch } : {}),
    };
  }
  if (body.type === "copy") {
    return {
      type: "copy",
      name: body.name?.trim() || defaultReferenceNameFromSource(body.sourcePath ?? ""),
      sourcePath: body.sourcePath ?? "",
    };
  }
  throw httpError(400, "Unsupported design reference import type.");
}

function statusCode(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
}

function designErrorResponse(error: unknown): Response {
  const status = statusCode(error);
  return Response.json(designErrorPayload(error), { status });
}

function designErrorPayload(error: unknown): { error: string; code: string; retryable: boolean; status: number } {
  const status = statusCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: message,
    code: errorCode(status),
    retryable: status >= 500,
    status,
  };
}

function errorCode(status: number): string {
  if (status === 400) return "bad_request";
  if (status === 409) return "conflict";
  if (status === 404) return "not_found";
  if (status === 503) return "git_unavailable";
  return "design_api_error";
}

function httpError(status: number, message: string): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}
