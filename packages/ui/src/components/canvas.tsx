import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import type { WorkflowNode, Edge, Session, Selection, RunStateMap, GateNode, InputNode } from '../types';
import { branchAccent, edgeKey, nextSymbolKey, sessionAccent } from '../appearance';
import type { IconName } from './icon';
import { Icon } from './icon';
import { closesGateControlledCycle, isSameSessionContentEdge, wouldCreateExecutedCycle } from '../edge-semantics';
import { useI18n } from '../i18n';
import { nodeDisplayTitle, nodeTitleIsFallback } from '../node-display';

// ── geometry ──────────────────────────────────────────────────────────────────

function nodeAnchorOut(node: WorkflowNode, branchId?: string): { x: number; y: number } {
  if (node.kind === 'gate') {
    const branches = node.branches;
    const branchIndex = branches.findIndex((branch) => branch.id === branchId);
    const height = 110;
    const total = branches.length + 1;
    const positionRatio = (branchIndex + 1) / (total + 1);
    return { x: node.x + node.w, y: node.y + height * positionRatio };
  }
  if (node.kind === 'input') return { x: node.x + (node.w || 200), y: node.y + 36 };
  return { x: node.x + (node.w || 220), y: node.y + 60 };
}

function nodeAnchorIn(node: WorkflowNode): { x: number; y: number } {
  if (node.kind === 'gate') return { x: node.x, y: node.y + 110 / 2 };
  if (node.kind === 'end')  return { x: node.x - 2, y: node.y + 18 };
  if (node.kind === 'input') return { x: node.x, y: node.y + 36 }; // should not happen; InputNode has no input
  return { x: node.x, y: node.y + 60 };
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }, loopback?: boolean): string {
  if (loopback) {
    const top = Math.min(from.y, to.y) - 50;
    return `M ${from.x} ${from.y} C ${from.x + 60} ${from.y}, ${from.x + 80} ${top}, ${from.x + 30} ${top} L ${to.x - 30} ${top} C ${to.x - 80} ${top}, ${to.x - 60} ${to.y}, ${to.x} ${to.y}`;
  }
  const deltaX = Math.max(40, Math.abs(to.x - from.x) * 0.45);
  return `M ${from.x} ${from.y} C ${from.x + deltaX} ${from.y}, ${to.x - deltaX} ${to.y}, ${to.x} ${to.y}`;
}

function edgeMid(from: { x: number; y: number }, to: { x: number; y: number }, loopback?: boolean): { x: number; y: number } {
  if (loopback) return { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 50 };
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

const NODE_H: Record<string, number> = { step: 120, gate: 110, end: 36, input: 72 };

export interface CanvasFitResult {
  zoom: number;
  pan: { x: number; y: number };
}

export function calculateCanvasFit(nodes: WorkflowNode[], viewport: { width: number; height: number }): CanvasFitResult | null {
  if (nodes.length === 0 || viewport.width <= 0 || viewport.height <= 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const width = node.w || 220;
    const height = NODE_H[node.kind] ?? 120;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + width);
    maxY = Math.max(maxY, node.y + height);
  }

  const leftAnchor = 96;
  const rightPad = 48;
  const verticalPad = 48;
  const usableWidth = Math.max(1, viewport.width - leftAnchor - rightPad);
  const usableHeight = Math.max(1, viewport.height - verticalPad * 2);
  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const zoom = Math.min(1.4, Math.max(0.3, Math.min(
    usableWidth / boundsWidth,
    usableHeight / boundsHeight,
  )));
  const centerY = (minY + maxY) / 2;
  const targetY = verticalPad + usableHeight / 2;

  return {
    zoom,
    pan: {
      x: leftAnchor - minX * zoom,
      y: targetY - centerY * zoom,
    },
  };
}

// ── node cards ────────────────────────────────────────────────────────────────

interface StepCardProps {
  node: Extract<WorkflowNode, { kind: 'step' }>;
  session: Session | undefined;
  selected: boolean;
  runState: string | undefined;
  onMouseDown: (element: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
  onContinue?: () => void;
}

function StepCard({ node, session, selected, runState, onMouseDown, onSelect, onContinue }: StepCardProps) {
  const { t } = useI18n();
  const classNames = ['node'];
  if (selected)               classNames.push('selected');
  if (runState === 'running') classNames.push('running');
  if (runState === 'paused')  classNames.push('paused');
  if (runState === 'success') classNames.push('success');
  if (runState === 'error')   classNames.push('error');
  if (node.locked)            classNames.push('locked');

  return (
    <div
      className={classNames.join(' ')}
      data-session={node.sessionId || ''}
      style={{ left: node.x, top: node.y, width: node.w, '--session-color': session ? sessionAccent(session) : 'var(--ink-3)' } as React.CSSProperties}
      onMouseDown={(event) => onMouseDown(event, node.id)}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
    >
      <div className="node-head">
        <span className="node-id">{node.alias}</span>
        {node.locked && <span className="lock-badge"><Icon name="lock" size={10} /></span>}
        <span className="node-state-icon">
          {runState === 'running' && <><Icon name="loader" size={11} style={{ animation: 'spin 1.4s linear infinite' }} />{t('canvas.running')}</>}
          {runState === 'paused'  && <><span style={{ color: 'var(--warn)' }}>{t('canvas.paused')}</span><button className="btn sm primary node-continue" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onContinue?.(); }}>{t('canvas.continue')}</button></>}
          {runState === 'success' && <><Icon name="check"  size={11} style={{ color: 'oklch(0.55 0.13 145)' }} />{t('canvas.done')}</>}
          {runState === 'error'   && <><Icon name="alert"  size={11} style={{ color: 'var(--err)' }} />{t('canvas.failed')}</>}
          {runState === 'pending' && <span style={{ color: 'var(--ink-3)' }}>{t('canvas.queued')}</span>}
        </span>
      </div>
      <h3 className={`node-title${nodeTitleIsFallback(node) ? ' placeholder' : ''}`}>{nodeDisplayTitle(node)}</h3>
      <p className="node-desc">{node.prompt}</p>
      <div className="node-meta">
        {(node.images || []).map((attachment, index) => (
          <span className="chip attach" key={index}><Icon name="attachment-img" size={10} />{attachment.label ?? attachment.path}</span>
        ))}
        {(node.paths || []).map((path, index) => (
          <span className="chip path" key={index}>
            <Icon name={path.endsWith('/') ? 'folder' : 'file'} size={10} />{path}
          </span>
        ))}
      </div>
      <div className="port in"  data-port="in"  data-node={node.id} />
      <div className="port out" data-port="out" data-node={node.id} />
    </div>
  );
}

interface GateCardProps {
  node: GateNode;
  selected: boolean;
  runState: string | undefined;
  onMouseDown: (element: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
  onAddBranch: (gateId: string) => void;
}

function GateCard({ node, selected, runState, onMouseDown, onSelect, onAddBranch }: GateCardProps) {
  const { t } = useI18n();
  const classNames = ['gate-wrap'];
  if (selected)               classNames.push('selected');
  if (runState === 'running') classNames.push('running');
  if (runState === 'success') classNames.push('success');
  if (runState === 'error')   classNames.push('error');
  if (node.locked)            classNames.push('locked');

  const width = node.w;
  const height = 110;
  const branches = node.branches;

  return (
    <div
      className={classNames.join(' ')}
      style={{ left: node.x, top: node.y, width, height }}
      onMouseDown={(event) => onMouseDown(event, node.id)}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
    >
      <div className="gate-card">
        <div className="gate-head">
          <span className="node-id">{node.alias}</span>
          {node.locked && <span className="lock-badge"><Icon name="lock" size={10} /></span>}
          <span className="gate-sub"><Icon name="route" size={10} /> {t('canvas.gateBranches', { count: branches.length })}</span>
        </div>
        <h3 className={`gate-title${nodeTitleIsFallback(node) ? ' placeholder' : ''}`}>{nodeDisplayTitle(node)}</h3>
      </div>
      <div className="gate-port-in" data-port="in" data-node={node.id} />
      {branches.map((branch, index) => {
        const total = branches.length + 1;
        const positionRatio = (index + 1) / (total + 1);
        const top = height * positionRatio - 6;
        return (
          <div
            key={branch.id}
            className={`gate-port-out ${branch.id}`}
            data-port="gate-out"
            data-node={node.id}
            data-branch={branch.id}
            style={{ right: -7, top, borderColor: branchAccent(branch) }}
          >
            <span className="pl">{branch.label}</span>
          </div>
        );
      })}
      <div
        className="gate-port-add"
        style={{ right: -8, top: height * (branches.length + 1) / (branches.length + 2) - 7 }}
        title={t('canvas.addBranchTitle')}
        onClick={(event) => { event.stopPropagation(); onAddBranch(node.id); }}
      >+</div>
    </div>
  );
}

interface EndCardProps {
  node: Extract<WorkflowNode, { kind: 'end' }>;
  selected: boolean;
  onMouseDown: (element: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
}

function EndCard({ node, selected, onMouseDown, onSelect }: EndCardProps) {
  const { t } = useI18n();
  const classNames = ['end-node'];
  if (selected) classNames.push('selected');
  if (node.locked) classNames.push('locked');

  return (
    <div
      className={classNames.join(' ')}
      style={{ left: node.x, top: node.y }}
      onMouseDown={(event) => onMouseDown(event, node.id)}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
      data-port="in" data-node={node.id}
    >
      <Icon name="check" size={11} /><span className={nodeTitleIsFallback(node) ? 'placeholder-title' : undefined}>{node.title || nodeDisplayTitle(node) || t('canvas.end')}</span>
      {node.locked && <span className="lock-badge"><Icon name="lock" size={10} /></span>}
    </div>
  );
}

interface InputCardProps {
  node: InputNode;
  selected: boolean;
  onMouseDown: (element: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
}

function InputCard({ node, selected, onMouseDown, onSelect }: InputCardProps) {
  const classNames = ['input-node'];
  if (selected) classNames.push('selected');
  if (node.locked) classNames.push('locked');

  return (
    <div
      className={classNames.join(' ')}
      style={{ left: node.x, top: node.y, width: node.w || 200 }}
      onMouseDown={(event) => onMouseDown(event, node.id)}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
    >
      <div className="input-node-head">
        <Icon name="tag" size={10} />
        <span className="node-id">{node.alias}</span>
        {node.locked && <span className="lock-badge"><Icon name="lock" size={10} /></span>}
        <span className={nodeTitleIsFallback(node) ? 'placeholder-title' : undefined} style={{ flex: 1 }}>{nodeDisplayTitle(node)}</span>
      </div>
      <div className="input-node-var">
        <span className="var-chip">&lt;{node.variableName}&gt;</span>
        {node.defaultValue && (
          <span style={{ color: 'var(--ink-4)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.defaultValue}
          </span>
        )}
      </div>
      {/* output-only port */}
      <div className="port out" data-port="out" data-node={node.id} />
    </div>
  );
}

// ── canvas ────────────────────────────────────────────────────────────────────

export type CanvasMode = 'select' | 'hand' | 'add-step' | 'add-gate' | 'add-end' | 'add-input';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: Edge[];
  sessions: Session[];
  selection: Selection | null;
  onSelectNode: (id: string) => void;
  onSelectNodes: (ids: string[]) => void;
  onSelectEdge: (id: string) => void;
  onClearSelection: () => void;
  runState: RunStateMap;
  showRun: boolean;
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodesMove: (moves: Array<{ id: string; x: number; y: number }>) => void;
  onAddNode: (node: WorkflowNode) => void;
  onAddEdge: (edge: Edge) => void;
  onDeleteNode: (id: string) => void;
  onAddBranch: (gateId: string) => void;
  canCopyNode: boolean;
  canPasteNode: boolean;
  canDeleteSelection: boolean;
  onCopyNode: () => void;
  onPasteNode: (position: { x: number; y: number }) => void;
  onDeleteSelection: () => void;
  onContinuePausedNode?: (nodeId: string) => void;
  viewMode: 'edit' | 'run';
  zoom: number;
  setZoom: (z: number) => void;
  pan: { x: number; y: number };
  setPan: (path: { x: number; y: number }) => void;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'node'; nodeId: string; startX: number; startY: number; nx: number; ny: number }
  | { kind: 'nodes'; startX: number; startY: number; nodes: Array<{ nodeId: string; x: number; y: number }> }
  | { kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number };

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isAddMode(mode: CanvasMode): boolean {
  return mode === 'add-step' || mode === 'add-gate' || mode === 'add-end' || mode === 'add-input';
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
    || Boolean(target.closest('[contenteditable="true"]'));
}

function normalizedRect(startX: number, startY: number, currentX: number, currentY: number): MarqueeRect {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  return { left, top, width, height };
}

function rectIntersectsNode(rect: MarqueeRect, node: WorkflowNode): boolean {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const nodeRight = node.x + node.w;
  const nodeBottom = node.y + NODE_H[node.kind];
  return rect.left <= nodeRight && right >= node.x && rect.top <= nodeBottom && bottom >= node.y;
}

interface DragEdge {
  fromId: string;
  branch?: string;
  cursorX: number;
  cursorY: number;
}

export function Canvas({
  nodes, edges, sessions,
  selection, onSelectNode, onSelectNodes, onSelectEdge, onClearSelection,
  runState, showRun, onNodeMove, onNodesMove,
  onAddNode, onAddEdge, onDeleteNode, onAddBranch,
  canCopyNode, canPasteNode, canDeleteSelection, onCopyNode, onPasteNode, onDeleteSelection, onContinuePausedNode,
  viewMode,
  zoom, setZoom, pan, setPan,
}: CanvasProps) {
  const { t } = useI18n();
  void onDeleteNode;  // handled by App-level keyboard listener

  const [mode, setMode] = useState<CanvasMode>('select');
  const [dragEdge, setDragEdge] = useState<DragEdge | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const dragEdgeRef = useRef<DragEdge | null>(null);
  const suppressClickRef = useRef(false);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  zoomRef.current   = zoom;
  panRef.current    = pan;
  nodesRef.current  = nodes;
  edgesRef.current  = edges;
  dragEdgeRef.current = dragEdge;

  const isEdit = viewMode === 'edit';

  // ESC + Delete handling for canvas modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddMode(mode)) { setMode('select'); setGhostPos(null); }
        if (dragRef.current?.kind === 'marquee') dragRef.current = null;
        setMarqueeRect(null);
        if (dragEdgeRef.current) setDragEdge(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode]);

  // Auto-reset to select if view becomes readonly while in add mode
  useEffect(() => {
    if (!isEdit && isAddMode(mode)) {
      setMode('select');
      setGhostPos(null);
      setDragEdge(null);
    }
  }, [isEdit, mode]);

  const fitToView = useCallback(() => {
    if (!wrapRef.current || nodes.length === 0) return;
    const canvasFit = calculateCanvasFit(nodes, {
      width: wrapRef.current.clientWidth,
      height: wrapRef.current.clientHeight,
    });
    if (!canvasFit) return;
    setZoom(canvasFit.zoom);
    setPan(canvasFit.pan);
  }, [nodes, setZoom, setPan]);

  useEffect(() => {
    const fitTimer = setTimeout(fitToView, 0);
    return () => clearTimeout(fitTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const next = Math.min(1.6, Math.max(0.3, zoomRef.current * (1 - e.deltaY * 0.0015)));
        setZoom(next);
      } else {
        setPan({ x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY });
      }
    };
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, [setZoom, setPan]);

  // canvas-coord helpers
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!wrapRef.current) return { x: 0, y: 0 };
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top  - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const viewportCenterToCanvas = useCallback(() => {
    if (!wrapRef.current) return { x: 0, y: 0 };
    const rect = wrapRef.current.getBoundingClientRect();
    return clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [clientToCanvas]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'c' && isEdit && canCopyNode) {
        event.preventDefault();
        onCopyNode();
      } else if (key === 'v' && isEdit) {
        event.preventDefault();
        onPasteNode(viewportCenterToCanvas());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canCopyNode, isEdit, onCopyNode, onPasteNode, viewportCenterToCanvas]);

  // ── port-drag-to-connect ──────────────────────────────────────────────────

  const startEdgeDrag = useCallback((fromId: string, branch: string | undefined, clientX: number, clientY: number) => {
    const position = clientToCanvas(clientX, clientY);
    setDragEdge({ fromId, branch, cursorX: position.x, cursorY: position.y });
  }, [clientToCanvas]);

  // Global mouse listeners for port-drag and ghost-cursor tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // 1. Active drag-edge: track cursor
      if (dragEdgeRef.current) {
        const position = clientToCanvas(e.clientX, e.clientY);
        setDragEdge((dragEdge) => dragEdge ? { ...dragEdge, cursorX: position.x, cursorY: position.y } : dragEdge);
        return;
      }
      // 2. Existing node drag / pan
      const dragState = dragRef.current;
      if (dragState) {
        const movedEnough = Math.abs(e.clientX - dragState.startX) >= 3 || Math.abs(e.clientY - dragState.startY) >= 3;
        if (dragState.kind === 'pan') {
          setPan({ x: dragState.panX + (e.clientX - dragState.startX), y: dragState.panY + (e.clientY - dragState.startY) });
        } else if (dragState.kind === 'marquee') {
          const position = clientToCanvas(e.clientX, e.clientY);
          dragRef.current = { ...dragState, currentX: position.x, currentY: position.y };
          setMarqueeRect(normalizedRect(dragState.startX, dragState.startY, position.x, position.y));
        } else if (dragState.kind === 'node') {
          const deltaX = (e.clientX - dragState.startX) / zoomRef.current;
          const deltaY = (e.clientY - dragState.startY) / zoomRef.current;
          if (movedEnough) suppressClickRef.current = true;
          onNodeMove(dragState.nodeId, dragState.nx + deltaX, dragState.ny + deltaY);
        } else {
          const deltaX = (e.clientX - dragState.startX) / zoomRef.current;
          const deltaY = (e.clientY - dragState.startY) / zoomRef.current;
          suppressClickRef.current = true;
          onNodesMove(dragState.nodes.map((node) => ({
            id: node.nodeId,
            x: node.x + deltaX,
            y: node.y + deltaY,
          })));
        }
        return;
      }
      // 3. Ghost preview in add-mode
      if (isAddMode(mode)) {
        const position = clientToCanvas(e.clientX, e.clientY);
        setGhostPos(position);
      }
    };

    const onUp = (e: MouseEvent) => {
      // Drop a port-drag
      if (dragEdgeRef.current) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const portIn = target?.closest('[data-port="in"]') as HTMLElement | null;
        const dragInfo = dragEdgeRef.current;
        setDragEdge(null);
        if (portIn) {
          const toId = portIn.getAttribute('data-node');
          if (toId && toId !== dragInfo.fromId) {
            const fromNode = nodesRef.current.find((node) => node.id === dragInfo.fromId);
            const toNode   = nodesRef.current.find((node) => node.id === toId);
            if (fromNode && toNode && toNode.kind !== 'input') {
              const edge = {
                id: edgeKey({ from: dragInfo.fromId, to: toId, branch: dragInfo.branch }),
                from: dragInfo.fromId,
                to: toId,
                branch: dragInfo.branch,
              };
              const secondGateInput = toNode.kind === 'gate'
                && fromNode.kind !== 'input'
                && edgesRef.current.some((existing) =>
                  existing.to === toId
                  && nodesRef.current.find((node) => node.id === existing.from)?.kind !== 'input');
              const executionCycle = wouldCreateExecutedCycle(edge, edgesRef.current);
              const controlledLoopback = executionCycle && (
                (fromNode.kind === 'gate' && Boolean(dragInfo.branch))
                || closesGateControlledCycle(edge, edgesRef.current, nodesRef.current)
              );
              if (!secondGateInput && (!executionCycle || controlledLoopback) && !edgesRef.current.some((existing) => existing.id === edge.id)) {
                onAddEdge(controlledLoopback ? { ...edge, loopback: true } : edge);
              }
            }
          }
        }
        return;
      }
      const dragState = dragRef.current;
      if (dragState?.kind === 'marquee') {
        const rect = normalizedRect(dragState.startX, dragState.startY, dragState.currentX, dragState.currentY);
        const hasDragArea = rect.width >= 4 || rect.height >= 4;
        const selectedIds = hasDragArea
          ? nodesRef.current.filter((node) => rectIntersectsNode(rect, node)).map((node) => node.id)
          : [];
        onSelectNodes(selectedIds);
        setMarqueeRect(null);
        dragRef.current = null;
        return;
      }
      dragRef.current = null;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [mode, clientToCanvas, onAddEdge, onSelectNodes, setPan, onNodeMove, onNodesMove]);

  // ── canvas mousedown ──────────────────────────────────────────────────────

  const startPanDrag = (element: React.MouseEvent) => {
    element.preventDefault();
    dragRef.current = { kind: 'pan', startX: element.clientX, startY: element.clientY, panX: pan.x, panY: pan.y };
  };

  const onCanvasMouseDown = (element: React.MouseEvent) => {
    const target = element.target as Element;
    if (target.closest('.canvas-toolbar')) return;
    if (element.button === 1) {
      startPanDrag(element);
      return;
    }
    if (element.button !== 0) return;
    if (mode !== 'hand' && target.closest('.node, .gate-wrap, .end-node, .input-node, .edge-tag, .edge-hover-target')) return;

    // In add-mode and edit view: place node at click
    if (isAddMode(mode) && isEdit) {
      const position = clientToCanvas(element.clientX, element.clientY);
      const keyPrefix =
        mode === 'add-step' ? 'step'
        : mode === 'add-gate' ? 'gate'
        : mode === 'add-input' ? 'input'
        : 'end';
      const id = nextSymbolKey(keyPrefix, nodesRef.current.map((node) => node.id));
      const firstSession = sessions[0]?.id ?? null;

      let newNode: WorkflowNode;
      if (mode === 'add-step') {
        const alias = String(nodesRef.current.filter((node) => node.kind === 'step').length + 1).padStart(2, '0');
        newNode = { kind: 'step', id, alias, x: position.x - 110, y: position.y - 60, w: 220, title: t('canvas.untitled'), prompt: '', sessionId: firstSession };
      } else if (mode === 'add-gate') {
        const alias = `G${nodesRef.current.filter((node) => node.kind === 'gate').length + 1}`;
        newNode = { kind: 'gate', id, alias, x: position.x - 110, y: position.y - 55, w: 220, title: t('canvas.decision'), decisionCriteria: '', branches: [{ id: 'pass', label: 'pass' }, { id: 'fix', label: 'fix' }] };
      } else if (mode === 'add-input') {
        const alias = 'IN';
        newNode = { kind: 'input', id, alias, x: position.x - 100, y: position.y - 36, w: 200, title: t('canvas.runInput'), variableName: `specflow_var${nodesRef.current.filter((node) => node.kind === 'input').length + 1}`, sessionId: null };
      } else {
        const alias = 'END';
        newNode = { kind: 'end', id, alias, x: position.x - 30, y: position.y - 18, w: 80, title: t('canvas.doneNode'), sessionId: null };
      }

      onAddNode(newNode);

      // Shift+click: stay in mode for rapid placement
      if (!element.shiftKey) {
        setMode('select');
        setGhostPos(null);
        onSelectNode(id);
      }
      return;
    }

    if (mode === 'hand') {
      startPanDrag(element);
      return;
    }

    const position = clientToCanvas(element.clientX, element.clientY);
    dragRef.current = {
      kind: 'marquee',
      startX: position.x,
      startY: position.y,
      currentX: position.x,
      currentY: position.y,
    };
    setMarqueeRect(normalizedRect(position.x, position.y, position.x, position.y));
  };

  // ── node mousedown ────────────────────────────────────────────────────────

  const onNodeMouseDown = (element: React.MouseEvent, nodeId: string) => {
    const target = element.target as Element;

    if (element.button === 1) {
      element.stopPropagation();
      startPanDrag(element);
      return;
    }
    if (element.button !== 0) return;

    if (mode === 'hand') {
      element.stopPropagation();
      startPanDrag(element);
      return;
    }

    // Port drag-out (edit mode only)
    if (isEdit) {
      const outEl = target.closest('[data-port="out"], [data-port="gate-out"]') as HTMLElement | null;
      if (outEl) {
        element.stopPropagation();
        const fromId = outEl.getAttribute('data-node') ?? nodeId;
        const branch = outEl.getAttribute('data-branch') ?? undefined;
        startEdgeDrag(fromId, branch, element.clientX, element.clientY);
        return;
      }
    }

    // Skip drag if clicked on any port or the gate add button
    if (
      target.classList.contains('port') ||
      target.classList.contains('gate-port-out') ||
      target.classList.contains('gate-port-add') ||
      target.classList.contains('gate-port-in') ||
      target.closest('.gate-port-out, .gate-port-add, .gate-port-in')
    ) return;

    element.stopPropagation();
    if (isAddMode(mode)) return;

    // In run view: select-only, no drag
    if (!isEdit) {
      onSelectNode(nodeId);
      return;
    }

    if (selectedNodeIds.has(nodeId) && selectedNodeIds.size > 1) {
      const selectedNodes = nodes.filter((node) => selectedNodeIds.has(node.id));
      if (selectedNodes.some((node) => (node as WorkflowNode & { locked?: boolean }).locked)) return;
      suppressClickRef.current = true;
      dragRef.current = {
        kind: 'nodes',
        startX: element.clientX,
        startY: element.clientY,
        nodes: selectedNodes.map((node) => ({ nodeId: node.id, x: node.x, y: node.y })),
      };
      return;
    }

    onSelectNode(nodeId);

    const node = nodes.find((node) => node.id === nodeId);
    if (!node) return;
    // Locked nodes can't be dragged
    if ((node as WorkflowNode & { locked?: boolean }).locked) return;
    dragRef.current = { kind: 'node', nodeId, startX: element.clientX, startY: element.clientY, nx: node.x, ny: node.y };
  };

  const nodeById = useMemo(() => {
    const nodeMap: Record<string, WorkflowNode> = {};
    for (const node of nodes) nodeMap[node.id] = node;
    return nodeMap;
  }, [nodes]);

  const sessionById = (id: string | null) => sessions.find((session) => session.id === id);

  const selectNode = useCallback((nodeId: string) => {
    if (mode !== 'select') return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelectNode(nodeId);
  }, [mode, onSelectNode]);

  const selectEdge = useCallback((edgeId: string) => {
    if (mode !== 'select') return;
    onSelectEdge(edgeId);
  }, [mode, onSelectEdge]);

  // Pending drag-edge origin
  const dragEdgeFrom = dragEdge
    ? (() => {
        const fromNode = nodeById[dragEdge.fromId];
        return fromNode ? nodeAnchorOut(fromNode, dragEdge.branch) : null;
      })()
    : null;

  const selectedNodeIds = new Set(
    selection?.kind === 'node'
      ? [selection.id]
      : selection?.kind === 'nodes'
        ? selection.ids
        : [],
  );

  // Toolbar button helper
  const toolbarModeBtn = (targetMode: CanvasMode, icon: IconName, label: string, tooltip = label) => (
    <button
      aria-label={label}
      aria-pressed={mode === targetMode}
      data-tooltip={tooltip}
      className={mode === targetMode ? 'mode-active' : ''}
      onClick={(event) => { event.stopPropagation(); setMode(mode === targetMode && isAddMode(targetMode) ? 'select' : targetMode); setGhostPos(null); setDragEdge(null); }}
    >
      <Icon name={icon} size={14} />
    </button>
  );

  const toolbarActionBtn = (icon: IconName, label: string, onClick: () => void, disabled = false) => (
    <button
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
    >
      <Icon name={icon} size={14} />
    </button>
  );

  const wrapClasses = ['canvas-wrap'];
  if (dragEdge) wrapClasses.push('dragging-edge');
  if (mode === 'hand') wrapClasses.push('hand-mode');
  if (isAddMode(mode) && ghostPos) wrapClasses.push('placing-node');

  return (
    <div
      ref={wrapRef}
      className={wrapClasses.join(' ')}
      onMouseDown={onCanvasMouseDown}
    >
      <div
        className="canvas-stage"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {/* edges */}
        <svg className="canvas-svg" style={{ left: 0, top: 0, width: 4000, height: 2400 }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--ink-2)" />
            </marker>
            <marker id="arrow-loopback" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--ink-3)" />
            </marker>
            <marker id="arrow-running" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--running)" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const fromNode = nodeById[edge.from];
            const toNode   = nodeById[edge.to];
            if (!fromNode || !toNode) return null;
            const sameSession = isSameSessionContentEdge(edge, nodes, edges);
            const sourceAnchor = nodeAnchorOut(fromNode, edge.branch);
            const targetAnchor = nodeAnchorIn(toNode);
            const pathData = edgePath(sourceAnchor, targetAnchor, edge.loopback);
            const isSelected = selection?.kind === 'edge' && selection.id === edge.id;
            const fromState  = runState[edge.from];
            const toState    = runState[edge.to];
            const active = showRun && fromState === 'success' && (toState === 'running' || toState === 'success');
            const stroke = edge.loopback
              ? 'var(--ink-3)'
              : active
                ? 'var(--running)'
                : sameSession ? 'var(--ink-3)' : 'var(--ink-2)';
            const dash = edge.loopback
              ? '4 4'
              : active
                ? '6 4'
                : sameSession ? '2 4' : '';
            const markerId = edge.loopback ? 'arrow-loopback' : active ? 'arrow-running' : 'arrow';

            return (
              <g key={edge.id}>
                <path
                  d={pathData}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isSelected ? 1.6 : 1.1}
                  strokeDasharray={dash}
                  markerEnd={`url(#${markerId})`}
                  style={active ? { animation: 'dashflow 1.2s linear infinite' } : undefined}
                />
                <path
                  d={pathData}
                  className="edge-hover-target"
                  onClick={(event) => { event.stopPropagation(); selectEdge(edge.id); }}
                  onMouseEnter={() => setHoverEdge(edge.id)}
                  onMouseLeave={() => setHoverEdge((h) => h === edge.id ? null : h)}
                />
              </g>
            );
          })}

          {/* Port-drag live line */}
          {dragEdge && dragEdgeFrom && (
            <path
              d={edgePath(dragEdgeFrom, { x: dragEdge.cursorX, y: dragEdge.cursorY })}
              fill="none"
              stroke="var(--ink-2)"
              strokeWidth={1.4}
              strokeDasharray="4 3"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </svg>

        {/* edge tag badges */}
        {edges.map((edge) => {
          const fromNode = nodeById[edge.from];
          const toNode   = nodeById[edge.to];
          if (!fromNode || !toNode) return null;
          const sameSession = isSameSessionContentEdge(edge, nodes, edges);

          const sourceAnchor = nodeAnchorOut(fromNode, edge.branch);
          const targetAnchor = nodeAnchorIn(toNode);
          const midpoint = edgeMid(sourceAnchor, targetAnchor, edge.loopback);

          // InputNode→Step edge: show the variable name chip
          if (fromNode.kind === 'input') {
            return (
              <div
                key={`tag-${edge.id}`}
                className="edge-tag edge-tag-var"
                style={{ left: midpoint.x, top: midpoint.y }}
                title={t('canvas.injectsVariable', { variable: fromNode.variableName })}
                onClick={(event) => { event.stopPropagation(); selectEdge(edge.id); }}
              >
                <Icon name="tag" size={9} />&lt;{fromNode.variableName}&gt;
              </div>
            );
          }

          if (toNode.kind === 'gate') {
            return (
              <div key={`tag-${edge.id}`} className="edge-tag" style={{ left: midpoint.x, top: midpoint.y, fontSize: 9.5, opacity: 0.7 }}>
                <Icon name="route" size={9} />{t('canvas.gateInput')}
              </div>
            );
          }

          if (sameSession) {
            return (
              <div
                key={`tag-${edge.id}`}
                className="edge-tag"
                style={{ left: midpoint.x, top: midpoint.y, fontSize: 9.5, opacity: 0.7, padding: '1px 5px', cursor: 'default' }}
                title={t('canvas.sameSessionTitle')}
              >
                <Icon name="link" size={9} />{t('canvas.sameSession')}
              </div>
            );
          }

          const isSelected = selection?.kind === 'edge' && selection.id === edge.id;
          return (
            <div
              key={`tag-${edge.id}`}
              className={`edge-tag${edge.outputTag ? '' : ' empty'}${isSelected ? ' selected' : ''}`}
              style={{ left: midpoint.x, top: midpoint.y }}
              onClick={(event) => { event.stopPropagation(); selectEdge(edge.id); }}
            >
              {edge.loopback && <Icon name="rotate" size={10} />}
              {edge.transmit && edge.outputTag ? <span className="tag-key">&lt;specflow_{edge.outputTag}&gt;</span> : <span>{t('canvas.noTransfer')}</span>}
            </div>
          );
        })}

        {/* nodes */}
        {nodes.map((node) => {
          const selected = selectedNodeIds.has(node.id);
          if (node.kind === 'gate') return (
            <GateCard
              key={node.id} node={node} selected={selected}
              runState={runState[node.id]}
              onMouseDown={onNodeMouseDown} onSelect={selectNode}
              onAddBranch={onAddBranch}
            />
          );
          if (node.kind === 'end') return (
            <EndCard
              key={node.id} node={node} selected={selected}
              onMouseDown={onNodeMouseDown} onSelect={selectNode}
            />
          );
          if (node.kind === 'input') return (
            <InputCard
              key={node.id} node={node} selected={selected}
              onMouseDown={onNodeMouseDown} onSelect={selectNode}
            />
          );
          return (
            <StepCard
              key={node.id} node={node}
              session={sessionById(node.sessionId)}
              selected={selected}
              runState={runState[node.id]}
              onMouseDown={onNodeMouseDown} onSelect={selectNode}
              onContinue={runState[node.id] === 'paused' ? () => onContinuePausedNode?.(node.id) : undefined}
            />
          );
        })}

        {marqueeRect && (
          <div
            className="canvas-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        )}

        {/* ghost preview while in add mode */}
        {isAddMode(mode) && isEdit && ghostPos && <GhostNode mode={mode} position={ghostPos} />}

        {/* hover prompt preview */}
        {hoverEdge && (() => {
          const edge = edges.find((edge) => edge.id === hoverEdge);
          if (!edge || !edge.handoffPrompt) return null;
          const fromNode = nodeById[edge.from];
          const toNode   = nodeById[edge.to];
          if (!fromNode || !toNode) return null;
          const midpoint = edgeMid(nodeAnchorOut(fromNode, edge.branch), nodeAnchorIn(toNode), edge.loopback);
          return (
            <div className="edge-preview" style={{ left: midpoint.x + 20, top: midpoint.y + 14 }}>
              <span className="pp-label">{t('canvas.handoffPrompt')}</span>
              {edge.handoffPrompt}
            </div>
          );
        })()}
      </div>

      {/* Empty-state hint */}
      {isEdit && nodes.length === 0 && (
        <div className="canvas-empty-hint">
          <div className="hint-card">
            <Icon name="sparkle" size={16} />
            <strong>{t('canvas.emptyWorkflow')}</strong>
            <div className="hint-line">{t('canvas.emptyHintPlace')}</div>
            <div className="hint-line muted">{t('canvas.emptyHintConnect')}</div>
          </div>
        </div>
      )}

      {/* toolbar — only in edit view */}
      {isEdit && (
        <div className="canvas-toolbar" onMouseDown={(event) => event.stopPropagation()}>
          {toolbarModeBtn('add-input', 'input', t('canvas.addRunInputTitle'))}
          {toolbarModeBtn('add-step', 'step-node', t('canvas.addStepTitle'), t('canvas.addStepTooltip'))}
          {toolbarModeBtn('add-gate', 'route', t('canvas.addGateTitle'))}
          {toolbarModeBtn('add-end', 'check', t('canvas.addEndTitle'))}
          <div className="divider" />
          {toolbarModeBtn('select', 'cursor', t('canvas.selectTool'))}
          {toolbarModeBtn('hand', 'hand', t('canvas.handTool'))}
          <div className="divider" />
          {toolbarActionBtn('copy', t('canvas.copyNode'), onCopyNode, !canCopyNode)}
          {toolbarActionBtn('paste', t('canvas.pasteNode'), () => onPasteNode(viewportCenterToCanvas()), !canPasteNode)}
          {toolbarActionBtn('trash', t('canvas.deleteSelection'), onDeleteSelection, !canDeleteSelection)}
          <div className="divider" />
          <button onClick={() => setZoom(Math.max(0.3, zoom - 0.1))} aria-label={t('canvas.zoomOut')} data-tooltip={t('canvas.zoomOut')}>
            <Icon name="zoom-out" size={13} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(1.6, zoom + 0.1))} aria-label={t('canvas.zoomIn')} data-tooltip={t('canvas.zoomIn')}>
            <Icon name="zoom-in" size={13} />
          </button>
          <button aria-label={t('canvas.fitToView')} data-tooltip={t('canvas.fitToView')} onClick={fitToView}>
            <Icon name="fit" size={13} />
          </button>
        </div>
      )}
      {!isEdit && (
        <div className="canvas-toolbar" onMouseDown={(event) => event.stopPropagation()}>
          {toolbarModeBtn('select', 'cursor', t('canvas.selectTool'))}
          {toolbarModeBtn('hand', 'hand', t('canvas.handTool'))}
          <div className="divider" />
          {toolbarActionBtn('copy', t('canvas.copyNode'), onCopyNode, true)}
          {toolbarActionBtn('paste', t('canvas.pasteNode'), () => onPasteNode(viewportCenterToCanvas()), true)}
          {toolbarActionBtn('trash', t('canvas.deleteSelection'), onDeleteSelection, true)}
          <div className="divider" />
          <button onClick={() => setZoom(Math.max(0.3, zoom - 0.1))} aria-label={t('canvas.zoomOut')} data-tooltip={t('canvas.zoomOut')}>
            <Icon name="zoom-out" size={13} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(1.6, zoom + 0.1))} aria-label={t('canvas.zoomIn')} data-tooltip={t('canvas.zoomIn')}>
            <Icon name="zoom-in" size={13} />
          </button>
          <button aria-label={t('canvas.fitToView')} data-tooltip={t('canvas.fitToView')} onClick={fitToView}>
            <Icon name="fit" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── ghost preview ─────────────────────────────────────────────────────────────

function GhostNode({ mode, position }: { mode: CanvasMode; position: { x: number; y: number } }) {
  const { t } = useI18n();
  if (mode === 'add-step') {
    return (
      <div className="ghost-node ghost-step" style={{ left: position.x - 110, top: position.y - 60, width: 220 }}>
        <div className="ghost-head">{t('canvas.step')}</div>
        <div className="ghost-title">{t('canvas.untitled')}</div>
      </div>
    );
  }
  if (mode === 'add-gate') {
    return (
      <div className="ghost-node ghost-gate" style={{ left: position.x - 110, top: position.y - 55, width: 220, height: 110 }}>
        <div className="ghost-head"><Icon name="route" size={10} /> {t('canvas.gateBranches', { count: 2 })}</div>
        <div className="ghost-title">{t('canvas.decision')}</div>
      </div>
    );
  }
  if (mode === 'add-input') {
    return (
      <div className="ghost-node ghost-input" style={{ left: position.x - 100, top: position.y - 36, width: 200 }}>
        <div className="ghost-head"><Icon name="input" size={10} /> {t('canvas.runInput')}</div>
        <div className="ghost-title">&lt;specflow_var&gt;</div>
      </div>
    );
  }
  return (
    <div className="ghost-node ghost-end" style={{ left: position.x - 30, top: position.y - 18, width: 80 }}>
      <Icon name="check" size={11} />{t('canvas.end')}
    </div>
  );
}
