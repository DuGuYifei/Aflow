import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/icon';
import { useI18n } from '../i18n';
import type { DesignArtifact, DesignArtifactFrame, DesignComponentNode } from './types';

export type DesignCanvasView = 'html' | 'wireframe';
type DesignCanvasMode = 'select' | 'hand';
type CanvasPanelTarget = 'description';

interface DesignCanvasProps {
  artifact?: DesignArtifact;
  artifactRevision: number;
  view: DesignCanvasView;
  selectedComponentId: string;
  selectedComponent?: DesignComponentNode;
  styleDrafts?: Record<string, Record<string, string>>;
  onViewChange: (view: DesignCanvasView) => void;
  onComponentHover?: (id: string) => void;
  onComponentSelect: (id: string, component?: DesignComponentNode) => void;
  onComponentHierarchy?: (id: string, component: DesignComponentNode, path: DesignComponentNode[]) => void;
  onOpenPanel: (target: CanvasPanelTarget, frame: DesignArtifactFrame) => void;
}

interface DragState {
  startX: number;
  startY: number;
  panX: number;
  panY: number;
}

export function DesignCanvas({
  artifact,
  artifactRevision,
  view,
  selectedComponentId,
  styleDrafts = {},
  onViewChange,
  onComponentHover,
  onComponentSelect,
  onComponentHierarchy,
  onOpenPanel,
}: DesignCanvasProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<DesignCanvasMode>('select');
  const [zoom, setZoom] = useState(0.72);
  const [pan, setPan] = useState({ x: 80, y: 72 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>());
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const frames = useMemo(() => artifactFrames(artifact), [artifact]);
  const hasHtml = frames.some((frame) => frame.designPath || frame.route);
  const hasWireframe = frames.some((frame) => frame.designPath || frame.wireframePath || frame.route);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: unknown;
        id?: unknown;
        frameId?: unknown;
        x?: unknown;
        y?: unknown;
        ancestors?: unknown;
        component?: unknown;
        path?: unknown;
      } | undefined;
      if (!data || typeof data.id !== 'string' || typeof data.frameId !== 'string') return;
      if (data.type === 'design-component-hover') {
        onComponentHover?.(data.id);
        return;
      }
      if (data.type === 'design-component-hierarchy') {
        const component = parseFrameComponent(data.component, data.id);
        if (component) onComponentHierarchy?.(data.id, component, parseFrameComponentList(data.path));
        return;
      }
      if (data.type !== 'design-component-selected') return;
      onComponentSelect(data.id, parseFrameComponent(data.component, data.id));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onComponentHierarchy, onComponentHover, onComponentSelect]);

  useEffect(() => {
    for (const [frameId, iframe] of iframeRefs.current) {
      iframe.contentWindow?.postMessage({ type: 'design-style-drafts', drafts: styleDrafts }, '*');
      if (!frames.some((frame) => frame.id === frameId)) iframeRefs.current.delete(frameId);
    }
  }, [styleDrafts, frames]);

  useEffect(() => {
    postSelectedComponent(iframeRefs.current, selectedComponentId);
    if (selectedComponentId) requestComponentHierarchy(iframeRefs.current, selectedComponentId);
  }, [selectedComponentId, frames, view]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        setZoom((current) => Math.min(2, Math.max(0.2, current * (1 - event.deltaY * 0.0015))));
      } else {
        setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPan({
        x: drag.panX + event.clientX - drag.startX,
        y: drag.panY + event.clientY - drag.startY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startPan = (event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, panX: panRef.current.x, panY: panRef.current.y };
  };

  const fitToView = () => {
    if (!wrapRef.current || frames.length === 0) return;
    const bounds = frameBounds(frames);
    const width = wrapRef.current.clientWidth;
    const height = wrapRef.current.clientHeight;
    const nextZoom = Math.min(1, Math.max(0.2, Math.min((width - 120) / bounds.width, (height - 120) / bounds.height)));
    setZoom(nextZoom);
    setPan({
      x: width / 2 - (bounds.left + bounds.width / 2) * nextZoom,
      y: height / 2 - (bounds.top + bounds.height / 2) * nextZoom,
    });
  };

  return (
    <div
      ref={wrapRef}
      className={`design-frame-canvas mode-${mode}`}
      onMouseDown={(event) => {
        if (event.button === 1 || (event.button === 0 && mode === 'hand')) startPan(event);
      }}
    >
      <div className="design-canvas-toolbar">
        <button className={view === 'html' ? 'active' : ''} disabled={!hasHtml} onClick={() => onViewChange('html')}>{t('design.tabs.html')}</button>
        <button className={view === 'wireframe' ? 'active' : ''} disabled={!hasWireframe} onClick={() => onViewChange('wireframe')}>{t('design.tabs.wireframe')}</button>
        <span className="design-canvas-divider" />
        <button className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')} title={t('design.canvas.select')}>
          <Icon name="cursor" size={13} />
        </button>
        <button className={mode === 'hand' ? 'active' : ''} onClick={() => setMode('hand')} title={t('design.canvas.pan')}>
          <Icon name="hand" size={13} />
        </button>
        <button onClick={() => setZoom((current) => Math.max(0.2, current - 0.1))} title={t('design.canvas.zoomOut')}>
          <Icon name="zoom-out" size={13} />
        </button>
        <button onClick={() => setZoom((current) => Math.min(2, current + 0.1))} title={t('design.canvas.zoomIn')}>
          <Icon name="zoom-in" size={13} />
        </button>
        <button onClick={fitToView} title={t('design.canvas.fit')}>
          <Icon name="fit" size={13} />
        </button>
        <span className="design-zoom-label">{Math.round(zoom * 100)}%</span>
      </div>
      {frames.length === 0 ? (
        <div className="design-empty-preview">
          <Icon name="sparkle" size={18} />
          <span>{t('design.preview.empty')}</span>
        </div>
      ) : (
        <div className="design-frame-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {frames.map((frame) => (
            <div
              key={frame.id}
              className="design-frame-card"
              style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
            >
              <div className="design-frame-title">
                <span>{frame.title}</span>
                <small>{frame.width}x{frame.height}</small>
              </div>
              {framePreviewAvailable(artifact!, frame) ? (
                <iframe
                  ref={(node) => {
                    if (node) iframeRefs.current.set(frame.id, node);
                    else iframeRefs.current.delete(frame.id);
                  }}
                  className="design-frame-iframe"
                  title={`${frame.title} ${view}`}
                  sandbox={artifact?.kind === 'react' ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
                  src={frameSource(artifact!, frame, view, artifactRevision)}
                  onLoad={(event) => {
                    event.currentTarget.contentWindow?.postMessage({ type: 'design-style-drafts', drafts: styleDrafts }, '*');
                    event.currentTarget.contentWindow?.postMessage({ type: 'design-selected-component', id: selectedComponentId }, '*');
                    if (selectedComponentId) requestComponentHierarchy(iframeRefs.current, selectedComponentId);
                  }}
                />
              ) : (
                <div className="design-frame-runtime-empty">
                  <Icon name="terminal" size={15} />
                  <span>{artifact?.runtime?.status === 'failed' ? t('design.runtime.failed') : t('design.runtime.notRunning')}</span>
                </div>
              )}
              <div className="design-frame-actions">
                <button type="button" onClick={() => onOpenPanel('description', frame)} disabled={!frame.descriptionPath}>
                  <Icon name="file" size={12} />{t('design.frame.description')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function artifactFrames(artifact: DesignArtifact | undefined): DesignArtifactFrame[] {
  if (!artifact) return [];
  if (artifact.frames?.length) return artifact.frames;
  return [];
}

function parseFrameComponent(value: unknown, fallbackId: string): DesignComponentNode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === 'string' && input.id ? input.id : fallbackId;
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : id;
  return {
    id,
    name,
    type: typeof input.type === 'string' ? input.type : undefined,
    selector: typeof input.selector === 'string' ? input.selector : undefined,
    filePath: typeof input.filePath === 'string' ? input.filePath : undefined,
    xpath: typeof input.xpath === 'string' ? input.xpath : undefined,
    tagName: typeof input.tagName === 'string' ? input.tagName : undefined,
    textContent: typeof input.textContent === 'string' ? input.textContent : undefined,
    selectionLevel: typeof input.selectionLevel === 'string' ? input.selectionLevel : undefined,
    anchorKind: typeof input.anchorKind === 'string' ? input.anchorKind : undefined,
    description: typeof input.description === 'string' ? input.description : undefined,
    bounds: parseFrameBounds(input.bounds),
    computedStyle: parseFrameComputedStyle(input.computedStyle),
    children: parseFrameComponentChildren(input.children),
  };
}

function parseFrameComponentChildren(value: unknown): DesignComponentNode[] | undefined {
  const children = parseFrameComponentList(value);
  return children.length ? children : undefined;
}

function parseFrameComponentList(value: unknown): DesignComponentNode[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => parseFrameComponent(item, `dom-child:${index}`))
    .filter((item): item is DesignComponentNode => Boolean(item));
}

function parseFrameBounds(value: unknown): DesignComponentNode['bounds'] {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const x = Number(input.x);
  const y = Number(input.y);
  const width = Number(input.width);
  const height = Number(input.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x, y, width, height };
}

function parseFrameComputedStyle(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function frameSource(artifact: DesignArtifact, frame: DesignArtifactFrame, view: DesignCanvasView, artifactRevision: number): string {
  if (artifact.kind === 'react') {
    if (!artifact.runtime?.url || !frame.route) return '';
    const url = new URL(frame.route, artifact.runtime.url);
    url.searchParams.set('frameId', frame.id);
    if (view === 'wireframe') url.searchParams.set('view', 'wireframe');
    if (artifactRevision > 0) url.searchParams.set('rev', String(artifactRevision));
    return url.toString();
  }
  const path = view === 'wireframe' ? frame.designPath ?? frame.wireframePath : frame.designPath;
  if (!path) return '';
  const params = new URLSearchParams();
  params.set('frameId', frame.id);
  if (view === 'wireframe') params.set('view', 'wireframe');
  if (artifactRevision > 0) params.set('rev', String(artifactRevision));
  const query = params.toString();
  return `/api/design/projects/${encodeURIComponent(artifact.projectName)}/files/${encodeURIComponent(path)}${query ? `?${query}` : ''}`;
}

function framePreviewAvailable(artifact: DesignArtifact, frame: DesignArtifactFrame): boolean {
  if (artifact.kind !== 'react') return Boolean(frame.designPath || frame.wireframePath);
  return Boolean(frame.route && artifact.runtime?.status === 'running' && artifact.runtime.url);
}

function postSelectedComponent(iframes: Map<string, HTMLIFrameElement>, id: string): void {
  for (const iframe of iframes.values()) {
    iframe.contentWindow?.postMessage({ type: 'design-selected-component', id }, '*');
  }
}

function requestComponentHierarchy(iframes: Map<string, HTMLIFrameElement>, id: string): void {
  const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  for (const iframe of iframes.values()) {
    iframe.contentWindow?.postMessage({ type: 'design-component-hierarchy-request', id, requestId }, '*');
  }
}

function frameBounds(frames: DesignArtifactFrame[]): { left: number; top: number; width: number; height: number } {
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
