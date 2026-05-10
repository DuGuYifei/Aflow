import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { WorkflowNode, Edge, Session, Workflow, Run, Selection, RunStateMap, Theme, RunStatus } from './types';
import {
  fetchCanvases, fetchCanvas, saveCanvas, runCanvas,
  fetchRuns, fetchRun, subscribeToRun,
  apiRunToUiRun, summaryToWorkflow,
  type SseEventType,
} from './api';
import { TopBar } from './components/top-bar';
import { Sidebar } from './components/sidebar';
import { Canvas } from './components/canvas';
import { NodePanel } from './components/node-panel';
import { ConnectionPanel } from './components/connection-panel';
import { SessionsBar } from './components/sessions-bar';

export function App() {
  const [activeWorkflow, setActiveWorkflow] = useState('wf1');
  const [activeCanvasName, setActiveCanvasName] = useState('');

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  const [activeRunId, setActiveRunId] = useState('');
  const activeRun = runs.find((r) => r.id === activeRunId);

  // Node state from the selected historical run record
  const [historicNodeStates, setHistoricNodeStates] = useState<RunStateMap>({});
  // Live node state overrides from SSE during an active run
  const [liveNodeStates, setLiveNodeStates] = useState<RunStateMap>({});
  const runState = useMemo<RunStateMap>(() => ({ ...historicNodeStates, ...liveNodeStates }), [historicNodeStates, liveNodeStates]);

  const [logLines, setLogLines] = useState<string[]>([]);

  const [selection, setSelection]             = useState<Selection | null>(null);
  const [zoom, setZoom]                       = useState(1);
  const [pan, setPan]                         = useState({ x: 0, y: 0 });
  const [barExpanded, setBarExpanded]         = useState(false);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [addSessionPing, setAddSessionPing]   = useState(0);
  const [theme, setTheme]                     = useState<Theme>('light');

  const nodesRef    = useRef(nodes);
  const edgesRef    = useRef(edges);
  const sessionsRef = useRef(sessions);
  useEffect(() => { nodesRef.current    = nodes;    }, [nodes]);
  useEffect(() => { edgesRef.current    = edges;    }, [edges]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load canvases list once
  useEffect(() => {
    fetchCanvases().then((list) => {
      setWorkflows(list.map(summaryToWorkflow));
    }).catch(console.error);
  }, []);

  // Load active canvas + runs whenever workflow changes
  useEffect(() => {
    fetchCanvas(activeWorkflow).then((doc) => {
      setNodes(doc.nodes as WorkflowNode[]);
      setEdges(doc.edges as Edge[]);
      setSessions(doc.sessions as Session[]);
      setActiveCanvasName(doc.name);
      if (doc.sessions[0]) setActiveSessionId(doc.sessions[0].id);
      setSelection(null);
    }).catch(console.error);

    fetchRuns(activeWorkflow).then((records) => {
      const uiRuns = records.map(apiRunToUiRun);
      setRuns(uiRuns);
      if (records[0]) {
        setActiveRunId(records[0].id);
        setHistoricNodeStates(records[0].nodeStates);
        setLiveNodeStates({});
      }
    }).catch(console.error);
  }, [activeWorkflow]);

  // ── debounced save ────────────────────────────────────────────────────────

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const doc = {
        id: activeWorkflow,
        name: activeCanvasName,
        sessions: sessionsRef.current,
        nodes: nodesRef.current,
        edges: edgesRef.current,
      };
      saveCanvas(activeWorkflow, doc).catch(console.error);
    }, 300);
  }, [activeWorkflow, activeCanvasName]);

  // ── canvas edit handlers ──────────────────────────────────────────────────

  const onNodeMove = useCallback((id: string, x: number, y: number) => {
    setNodes((ns) => {
      const updated = ns.map((n) => n.id === id ? { ...n, x, y } : n);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onToggleUpdateDoc = (id: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== id || n.kind !== 'step') return n;
        return { ...n, updateDoc: !n.updateDoc };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  };

  const onChangeSession = useCallback((id: string, sid: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== id || n.kind === 'end') return n;
        return { ...n, sessionId: sid };
      });
      nodesRef.current = updated;
      setEdges((es) => {
        const recomputed = es.map((e) => {
          const fromN = updated.find((n) => n.id === e.from);
          const toN   = updated.find((n) => n.id === e.to);
          if (!fromN || !toN || e.loopback || fromN.kind === 'gate' || toN.kind === 'gate' || toN.kind === 'end') return e;
          const fromSid = fromN.sessionId;
          const toSid   = toN.sessionId;
          return { ...e, sameSession: fromSid != null && fromSid === toSid };
        });
        edgesRef.current = recomputed;
        scheduleSave();
        return recomputed;
      });
      return updated;
    });
  }, [scheduleSave]);

  const onEditEdge = useCallback((id: string, patch: { tag?: string; prompt?: string }) => {
    setEdges((es) => {
      const updated = es.map((e) => e.id === id ? { ...e, ...patch } : e);
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  // ── selection ─────────────────────────────────────────────────────────────

  const onSelectNode     = (id: string) => setSelection({ kind: 'node', id });
  const onSelectEdge     = (id: string) => setSelection({ kind: 'edge', id });
  const onClearSelection = ()            => setSelection(null);

  const onAddSessionRequest = useCallback(() => {
    setBarExpanded(true);
    setAddSessionPing((n) => n + 1);
  }, []);

  // ── run management ────────────────────────────────────────────────────────

  const onSelectRun = useCallback((id: string) => {
    setActiveRunId(id);
    setLiveNodeStates({});
    fetchRun(id).then((rec) => {
      setHistoricNodeStates(rec.nodeStates);
    }).catch(console.error);
  }, []);

  const handleNewRun = useCallback(async () => {
    try {
      const { runId } = await runCanvas(activeWorkflow);

      // Initialise all nodes as pending
      const pending: RunStateMap = {};
      for (const n of nodesRef.current) pending[n.id] = 'pending';
      setLiveNodeStates(pending);
      setHistoricNodeStates({});
      setLogLines([]);

      const placeholder: Run = {
        id: runId,
        label: 'New run…',
        ticket: '',
        status: 'running',
        time: 'just now',
        duration: '—',
        agent: sessionsRef.current[0]?.agent ?? 'mock',
      };
      setRuns((prev) => [placeholder, ...prev]);
      setActiveRunId(runId);
      setBarExpanded(true);

      const unsub = subscribeToRun(runId, (type: SseEventType, data: unknown) => {
        if (type === 'node-status') {
          const ev = data as { nodeId: string; status: string };
          setLiveNodeStates((prev) => ({ ...prev, [ev.nodeId]: ev.status as import('./types').RunState }));
        } else if (type === 'terminal') {
          const ev = data as { chunk: string };
          setLogLines((prev) => [...prev.slice(-500), ev.chunk]);
        } else if (type === 'run-status') {
          const ev = data as { status: string };
          const uiStatus = ev.status === 'done' ? 'success' : ev.status === 'failed' ? 'error' : 'running';
          setRuns((prev) => prev.map((r) =>
            r.id === runId ? { ...r, status: uiStatus as RunStatus } : r,
          ));
          if (uiStatus !== 'running') {
            unsub();
            // Reload fresh run list + states
            fetchRuns(activeWorkflow).then((records) => {
              setRuns(records.map(apiRunToUiRun));
              const fresh = records.find((r) => r.id === runId);
              if (fresh) {
                setHistoricNodeStates(fresh.nodeStates);
                setLiveNodeStates({});
              }
            }).catch(console.error);
          }
        }
      });
    } catch (err) {
      console.error('Failed to start run', err);
    }
  }, [activeWorkflow]);

  // ── derived selection state ───────────────────────────────────────────────

  const selectedNode     = selection?.kind === 'node' ? nodes.find((n) => n.id === selection.id) : null;
  const selectedEdge     = selection?.kind === 'edge' ? edges.find((e) => e.id === selection.id) : null;
  const selectedFromNode = selectedEdge ? nodes.find((n) => n.id === selectedEdge.from) : undefined;
  const selectedToNode   = selectedEdge ? nodes.find((n) => n.id === selectedEdge.to)   : undefined;

  const selectedNodeWithState = selectedNode
    ? { ...selectedNode, runState: runState[selectedNode.id] }
    : null;

  const barH     = barExpanded ? 252 : 32;
  const rootClass = ['app', 'two-col-left', 'has-bottom-bar', selection ? '' : 'no-right'].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      style={{ '--bar-h': `${barH}px` } as React.CSSProperties}
    >
      <TopBar
        theme={theme}
        onThemeChange={setTheme}
        runLabel={activeRun?.label}
        workflowName={activeCanvasName}
        onNewRun={handleNewRun}
      />

      <Sidebar
        workflows={workflows}
        runs={runs}
        activeWorkflow={activeWorkflow}
        activeRun={activeRunId}
        onSelectWorkflow={setActiveWorkflow}
        onSelectRun={onSelectRun}
      />

      <div className="canvas-cell" style={{ position: 'relative', overflow: 'hidden', minHeight: 0, height: '100%' }}>
        <Canvas
          nodes={nodes}
          edges={edges}
          sessions={sessions}
          selection={selection}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onClearSelection={onClearSelection}
          runState={runState}
          showRun={!!activeRun}
          onNodeMove={onNodeMove}
          zoom={zoom} setZoom={setZoom}
          pan={pan} setPan={setPan}
        />
        {activeRun && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 6 }}>
            <div className="run-pill">
              <span className={`status-dot ${activeRun.status}`} />
              <span className="label">RUN</span>
              <span className="value">{activeRun.label}</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span className="value" style={{ color: 'var(--ink-3)' }}>{activeRun.duration}</span>
            </div>
          </div>
        )}
      </div>

      {selection?.kind === 'node' && selectedNodeWithState && (
        <NodePanel
          node={selectedNodeWithState}
          run={activeRun}
          sessions={sessions}
          onClose={onClearSelection}
          onToggleUpdateDoc={onToggleUpdateDoc}
          onChangeSession={onChangeSession}
          onAddSessionRequest={onAddSessionRequest}
        />
      )}
      {selection?.kind === 'edge' && selectedEdge && (
        <ConnectionPanel
          edge={selectedEdge}
          fromNode={selectedFromNode}
          toNode={selectedToNode}
          onClose={onClearSelection}
          onEditEdge={onEditEdge}
        />
      )}

      <div className="bottom-bar-cell">
        <SessionsBar
          sessions={sessions}
          nodes={nodes}
          expanded={barExpanded}
          setExpanded={setBarExpanded}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          onAssignSession={onChangeSession}
          addSessionPing={addSessionPing}
          logLines={logLines}
        />
      </div>
    </div>
  );
}
