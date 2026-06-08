import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { WorkflowNode, Edge, Session, Workflow, Run, Selection, RunStateMap, Theme, RunStatus, TimelineEvent, InputNode } from './types';
import { edgeKey, isSymbolKey } from './appearance';
import {
  fetchCanvases, fetchCanvas, saveCanvas, uploadCanvasAssets, runCanvas,
  fetchRuns, fetchRun, fetchRunLogs, subscribeToRun,
  createCanvas, deleteCanvas as apiDeleteCanvas, deleteRun as apiDeleteRun, rerunRun as apiRerunRun,
  cancelRun as apiCancelRun,
  fetchAgentSessions, fetchAgentServers, fetchAgentServerCapabilities, refreshAgentServerCapabilities, restoreAgentSession, subscribeToRestore,
  fetchAgentSession, fetchResumableSession, fetchRunLogsRange, resumeWorkflowRun,
  promptRestoredSession, closeRestoredSession, cancelRestoredSession, fetchPausedNodes, promptPausedNode, continuePausedNode,
  apiRunToUiRun, apiRunLogsToTimelineEvents, summaryToWorkflow, respondToRunInteraction,
  AgentAuthenticationRequiredError,
  type SseEventType,
  type AgentAuthenticationStatus,
  type RunInteraction,
  type AgentSessionRecord,
  type AgentServerCapabilities,
  type AgentServerEntry,
  type RestoreMode,
  type RestoreSseEventType,
  type RestoreStreamEvent,
  type PausedNodeSession,
  type ApiRunLogEvent,
} from './api';
import { TopBar } from './components/top-bar';
import { Sidebar, sidebarTotalWidth, type SidebarLayout } from './components/sidebar';
import { Canvas } from './components/canvas';
import { NodePanel } from './components/node-panel';
import { ConnectionPanel } from './components/connection-panel';
import { SessionsBar } from './components/sessions-bar';
import { RunConfigPanel } from './components/run-config-panel';
import { InteractionModal } from './components/interaction-modal';
import { AgentAuthModal } from './components/agent-auth-modal';
import { AgentServerManager } from './components/agent-server-manager';
import { AgentConversationWindow } from './components/agent-conversation-window';
import { Icon } from './components/icon';
import { normalizeTransferConfiguration, resolveTransferSource } from './edge-semantics';
import { useI18n } from './i18n';
import { nodeDisplayTitle } from './node-display';
import {
  createCanvasNodeCopy,
  createPastedNodes,
  type CanvasNodeCopy,
  type CanvasPastePosition,
} from './canvas-clipboard';

function runStatusFromEvent(status: string): RunStatus {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'done') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ConversationConfigState = {
  capabilities?: AgentServerCapabilities;
  modeId: string;
  configOptions: Record<string, string | boolean>;
  configTouched: boolean;
};

function applyConversationCapabilities<T extends ConversationConfigState>(
  current: T,
  capabilities: AgentServerCapabilities | undefined,
  options: { preferCurrentValues: boolean },
): T {
  if (!capabilities) return current;
  if (!options.preferCurrentValues || current.configTouched) {
    return { ...current, capabilities };
  }
  return {
    ...current,
    capabilities,
    modeId: capabilities.modes?.currentModeId ?? current.modeId,
    configOptions: currentConfigOptions(capabilities),
  };
}

function applyConversationSessionUpdate<T extends ConversationConfigState>(
  current: T,
  update: unknown,
): T {
  const record = update && typeof update === 'object' ? update as {
    modes?: AgentServerCapabilities['modes'];
    configOptions?: AgentServerCapabilities['configOptions'];
  } : undefined;
  if (!record || (!record.modes && !record.configOptions)) return current;
  const capabilities: AgentServerCapabilities = {
    ...(current.capabilities ?? emptyAgentCapabilities()),
    modes: record.modes ?? current.capabilities?.modes ?? null,
    configOptions: record.configOptions ?? current.capabilities?.configOptions ?? null,
  };
  return applyConversationCapabilities(current, capabilities, { preferCurrentValues: true });
}

function restoreEventCapabilities(
  current: AgentServerCapabilities | undefined,
  capabilities: Pick<AgentServerCapabilities, 'modes' | 'configOptions'> | undefined,
): AgentServerCapabilities | undefined {
  if (!capabilities) return current;
  return {
    ...(current ?? emptyAgentCapabilities()),
    modes: capabilities.modes,
    configOptions: capabilities.configOptions,
  };
}

function currentConfigOptions(capabilities: AgentServerCapabilities): Record<string, string | boolean> {
  const next: Record<string, string | boolean> = {};
  for (const option of capabilities.configOptions ?? []) {
    if (typeof option.currentValue === 'string' || typeof option.currentValue === 'boolean') {
      next[option.id] = option.currentValue;
    }
  }
  return next;
}

function conversationPromptOptions(
  conversation: ConversationConfigState | null | undefined,
): { modeId?: string; configOptions?: Record<string, string | boolean> } {
  if (!conversation?.configTouched) return {};
  return {
    ...(conversation.modeId ? { modeId: conversation.modeId } : {}),
    ...(Object.keys(conversation.configOptions).length > 0 ? { configOptions: conversation.configOptions } : {}),
  };
}

function emptyAgentCapabilities(): AgentServerCapabilities {
  return {
    probedAt: new Date(0).toISOString(),
    agentCapabilities: {},
    modes: null,
    configOptions: null,
    availableCommands: [],
  };
}

const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  workflowsWidth: 220,
  runsWidth: 280,
  workflowsCollapsed: false,
  runsCollapsed: false,
};

function loadSidebarLayout(): SidebarLayout {
  try {
    const rawValue = localStorage.getItem('sf-sidebar-layout');
    if (!rawValue) return DEFAULT_SIDEBAR_LAYOUT;
    const parsed = JSON.parse(rawValue) as Partial<SidebarLayout>;
    return {
      workflowsWidth: typeof parsed.workflowsWidth === 'number' ? parsed.workflowsWidth : DEFAULT_SIDEBAR_LAYOUT.workflowsWidth,
      runsWidth: typeof parsed.runsWidth === 'number' ? parsed.runsWidth : DEFAULT_SIDEBAR_LAYOUT.runsWidth,
      workflowsCollapsed: parsed.workflowsCollapsed === true,
      runsCollapsed: parsed.runsCollapsed === true,
    };
  } catch {
    return DEFAULT_SIDEBAR_LAYOUT;
  }
}

export function App() {
  const { t } = useI18n();
  const [activeWorkflow, setActiveWorkflow] = useState('');
  const [loadedWorkflowId, setLoadedWorkflowId] = useState('');
  const [activeCanvasName, setActiveCanvasName] = useState('');
  const [sidebarLayout, setSidebarLayout] = useState<SidebarLayout>(() => loadSidebarLayout());

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const workflowsRef = useRef<Workflow[]>([]);

  const [activeRunId, setActiveRunId] = useState('');
  const activeRun = runs.find((run) => run.id === activeRunId);

  const [historicNodeStates, setHistoricNodeStates] = useState<RunStateMap>({});
  const [liveNodeStates, setLiveNodeStates] = useState<RunStateMap>({});
  const runState = useMemo<RunStateMap>(() => ({ ...historicNodeStates, ...liveNodeStates }), [historicNodeStates, liveNodeStates]);

  const [logEvents, setLogEvents] = useState<TimelineEvent[]>([]);
  // Window into the persisted run log for the active run. Used to drive "Load
  // earlier" pagination. `earliestIndex` is the absolute position (in the
  // full persisted log) of the first item currently in `logEvents` that came
  // from history, or `total` if we haven't loaded any historic events yet.
  const [logHistoryTotal, setLogHistoryTotal] = useState(0);
  const [logHistoryEarliestIndex, setLogHistoryEarliestIndex] = useState(0);
  const [logHistoryLoading, setLogHistoryLoading] = useState(false);
  const LOG_TAIL_INITIAL = 500;
  const LOG_PAGE_SIZE = 500;
  const LOG_LIVE_CAP = 5000;
  const [agentSessions, setAgentSessions] = useState<AgentSessionRecord[]>([]);
  const [agentServers, setAgentServers] = useState<AgentServerEntry[]>([]);
  const [restoreStatusBySession, setRestoreStatusBySession] = useState<Record<string, string>>({});
  const [conversation, setConversation] = useState<{
    session: AgentSessionRecord;
    mode: RestoreMode;
    restoreId?: string;
    status: string;
    events: TimelineEvent[];
    canPrompt: boolean;
    busy: boolean;
    capabilities?: AgentServerCapabilities;
    capabilityRefreshing: boolean;
    modeId: string;
    configOptions: Record<string, string | boolean>;
    configTouched: boolean;
  } | null>(null);
  const [pausedNode, setPausedNode] = useState<PausedNodeSession | null>(null);
  const [pausedPromptBusy, setPausedPromptBusy] = useState(false);

  const [selection, setSelection]             = useState<Selection | null>(null);
  const [nodeCopyBuffer, setNodeCopyBuffer]   = useState<CanvasNodeCopy | null>(null);
  const [zoom, setZoom]                       = useState(1);
  const [pan, setPan]                         = useState({ x: 0, y: 0 });
  const [barExpanded, setBarExpanded]         = useState(false);
  const [barHeight, setBarHeight]             = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('sf-bar-h') ?? '', 10);
      return Number.isFinite(saved) ? Math.min(600, Math.max(120, saved)) : 252;
    } catch { return 252; }
  });
  const [activeSessionId, setActiveSessionId] = useState('');
  const [addSessionPing, setAddSessionPing]   = useState(0);
  const [theme, setTheme]                     = useState<Theme>('light');

  // Run config panel state
  const [runConfigOpen, setRunConfigOpen]     = useState(false);
  const [runConfigVars, setRunConfigVars]     = useState<Record<string, string>>({});
  const [runConfigBusy, setRunConfigBusy]     = useState(false);
  const [runStartBusy, setRunStartBusy]       = useState(false);
  const [runStartError, setRunStartError]     = useState('');
  const [pendingInteractions, setPendingInteractions] = useState<RunInteraction[]>([]);
  const [agentServerManagerOpen, setAgentServerManagerOpen] = useState(false);
  const [authStatuses, setAuthStatuses] = useState<AgentAuthenticationStatus[]>([]);

  // viewMode is derived from selection: viewing a run → run view (readonly).
  const view: 'edit' | 'run' = activeRunId ? 'run' : 'edit';

  // displayDoc: render the run's snapshot when in run view, else the live doc.
  const displayNodes: WorkflowNode[]  = (activeRun?.canvasSnapshot?.nodes  as WorkflowNode[]) ?? nodes;
  const displayEdges: Edge[]          = (activeRun?.canvasSnapshot?.edges  as Edge[])         ?? edges;
  const displaySessions: Session[]    = (activeRun?.canvasSnapshot?.sessions as Session[])    ?? sessions;

  const refreshWorkflows = useCallback(async () => {
    const list = await fetchCanvases();
    const nextWorkflows = list.map(summaryToWorkflow);
    const previousIds = new Set(workflowsRef.current.map((workflow) => workflow.id));
    const newLocalWorkflow = nextWorkflows.find((workflow) => workflow.local && !previousIds.has(workflow.id));
    workflowsRef.current = nextWorkflows;
    setWorkflows(nextWorkflows);
    if (newLocalWorkflow) {
      setActiveWorkflow(newLocalWorkflow.id);
      return;
    }
    setActiveWorkflow((current) => {
      if (current && nextWorkflows.some((workflow) => workflow.id === current)) return current;
      const initial = nextWorkflows.find((workflow) => workflow.id === 'example-code-frontend-flow') ?? nextWorkflows[0];
      return initial?.id ?? '';
    });
  }, []);

  // Variables are derived from InputNodes — both in edit and run view.
  const variables = useMemo(
    () => nodes.filter((node): node is InputNode => node.kind === 'input')
              .map((node) => ({ name: node.variableName, required: node.required, defaultValue: node.defaultValue, description: node.description })),
    [nodes],
  );
  const displayVariables = useMemo(
    () => displayNodes.filter((node): node is InputNode => node.kind === 'input')
                      .map((node) => ({ name: node.variableName, required: node.required, defaultValue: node.defaultValue, description: node.description })),
    [displayNodes],
  );
  const hasAgentUpdates = useMemo(
    () => agentServers.some((server) => server.registry?.updateAvailable),
    [agentServers],
  );

  const nodesRef     = useRef(nodes);
  const edgesRef     = useRef(edges);
  const sessionsRef  = useRef(sessions);
  const resumeAfterAuthRef = useRef<undefined | (() => void | Promise<void>)>(undefined);
  const restoreUnsubscribeRef = useRef<undefined | (() => void)>(undefined);
  const runUnsubscribeRef = useRef<undefined | (() => void)>(undefined);
  const subscribedRunIdRef = useRef<string | undefined>(undefined);
  const restoreRequestTokenRef = useRef(0);
  const conversationPromptAbortRef = useRef<AbortController | null>(null);
  const pausedPromptAbortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef(conversation);
  const nodeCopyBufferRef = useRef<CanvasNodeCopy | null>(null);
  const pasteCountRef = useRef(0);
  useEffect(() => { nodesRef.current     = nodes;     }, [nodes]);
  useEffect(() => { edgesRef.current     = edges;     }, [edges]);
  useEffect(() => { sessionsRef.current  = sessions;  }, [sessions]);
  useEffect(() => { workflowsRef.current = workflows; }, [workflows]);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => { nodeCopyBufferRef.current = nodeCopyBuffer; }, [nodeCopyBuffer]);

  const terminateConversation = useCallback((active: typeof conversation) => {
    conversationPromptAbortRef.current?.abort();
    conversationPromptAbortRef.current = null;
    restoreUnsubscribeRef.current?.();
    restoreUnsubscribeRef.current = undefined;
    if (!active?.restoreId) return;
    const terminate = active.mode === 'continue' && active.status === 'success'
      ? closeRestoredSession(active.restoreId)
      : cancelRestoredSession(active.restoreId);
    void terminate.catch(console.error);
  }, []);

  useEffect(() => () => {
    conversationPromptAbortRef.current?.abort();
    pausedPromptAbortRef.current?.abort();
    terminateConversation(conversationRef.current);
    runUnsubscribeRef.current?.();
    runUnsubscribeRef.current = undefined;
    subscribedRunIdRef.current = undefined;
  }, [terminateConversation]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem('sf-sidebar-layout', JSON.stringify(sidebarLayout)); } catch { /* ignore */ }
  }, [sidebarLayout]);

  // Keep the workflow list in sync with files written outside the browser, such as Aflow-generated local drafts.
  useEffect(() => {
    refreshWorkflows().catch(console.error);
    const onFocus = () => {
      refreshWorkflows().catch(console.error);
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshWorkflows().catch(console.error);
    }, 5000);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshWorkflows]);

  // Load active canvas + runs whenever workflow changes
  useEffect(() => {
    setLoadedWorkflowId('');
    if (!activeWorkflow) return;
    fetchCanvas(activeWorkflow).then((canvasDocument) => {
      setNodes(canvasDocument.nodes as WorkflowNode[]);
      setEdges(canvasDocument.edges as Edge[]);
      setSessions(canvasDocument.sessions as Session[]);
      setActiveCanvasName(canvasDocument.name);
      setActiveSessionId(canvasDocument.sessions[0]?.id ?? '');
      setSelection(null);
      setLoadedWorkflowId(canvasDocument.id);
    }).catch(console.error);

    fetchRuns(activeWorkflow).then((records) => {
      const uiRuns = records.map(apiRunToUiRun);
      setRuns(uiRuns);
    }).catch(console.error);
    fetchAgentSessions({ workflowId: activeWorkflow }).then(setAgentSessions).catch(console.error);
    fetchAgentServers().then(setAgentServers).catch(console.error);
    // Clicking a workflow always returns to workflow-edit (no run selected).
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setRestoreStatusBySession({});
    restoreRequestTokenRef.current += 1;
    terminateConversation(conversationRef.current);
    setConversation(null);
    setPausedNode(null);
    setPendingInteractions([]);
    setRunStartError('');
  }, [activeWorkflow, terminateConversation]);

  // ── debounced save ────────────────────────────────────────────────────────

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const canvasDocument = {
        id: activeWorkflow,
        name: activeCanvasName,
        sessions: sessionsRef.current,
        nodes: nodesRef.current,
        edges: edgesRef.current,
      };
      saveCanvas(activeWorkflow, canvasDocument).catch(console.error);
    }, 300);
  }, [activeWorkflow, activeCanvasName]);

  // ── canvas edit handlers ──────────────────────────────────────────────────

  const onNodeMove = useCallback((id: string, x: number, y: number) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => node.id === id ? { ...node, x, y } : node);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onNodesMove = useCallback((moves: Array<{ id: string; x: number; y: number }>) => {
    if (moves.length === 0) return;
    const moveMap = new Map(moves.map((move) => [move.id, move]));
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        const move = moveMap.get(node.id);
        return move ? { ...node, x: move.x, y: move.y } : node;
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditNode = useCallback((id: string, patch: Record<string, unknown>) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => node.id === id ? { ...node, ...patch } as WorkflowNode : node);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onRenameNode = useCallback((oldId: string, newId: string) => {
    const nextId = newId.trim();
    if (nextId === oldId || !isSymbolKey(nextId) || nodesRef.current.some((node) => node.id === nextId)) return;

    const updatedNodes = nodesRef.current.map((node) =>
      node.id === oldId ? { ...node, id: nextId } as WorkflowNode : node,
    );
    const updatedEdges = edgesRef.current.map((edge) => {
      const from = edge.from === oldId ? nextId : edge.from;
      const to = edge.to === oldId ? nextId : edge.to;
      return { ...edge, from, to, id: edgeKey({ from, to, branch: edge.branch }) };
    });
    nodesRef.current = updatedNodes;
    edgesRef.current = updatedEdges;
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelection((current) => {
      if (!current) return current;
      if (current.kind === 'node') {
        return current.id === oldId ? { kind: 'node', id: nextId } : current;
      }
      if (current.kind === 'nodes') {
        return { kind: 'nodes', ids: current.ids.map((id) => id === oldId ? nextId : id) };
      }
      const updatedEdge = updatedEdges.find((edge) =>
        edge.id === current.id
        || edgeKey({
          from: edge.from === nextId ? oldId : edge.from,
          to: edge.to === nextId ? oldId : edge.to,
          branch: edge.branch,
        }) === current.id,
      );
      return updatedEdge ? { kind: 'edge', id: updatedEdge.id } : current;
    });
    const renameStateKey = (states: RunStateMap): RunStateMap => {
      if (!(oldId in states)) return states;
      const { [oldId]: value, ...rest } = states;
      return { ...rest, [nextId]: value };
    };
    setLiveNodeStates(renameStateKey);
    setHistoricNodeStates(renameStateKey);
    scheduleSave();
  }, [scheduleSave]);

  const onChangeSession = useCallback((id: string, sid: string) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== id || node.kind !== 'step') return node;
        return { ...node, sessionId: sid };
      });
      nodesRef.current = updated;
      setEdges((current) => {
        const normalized = normalizeTransferConfiguration(current, updated);
        edgesRef.current = normalized;
        return normalized;
      });
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onAddBranch = useCallback((gateId: string) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== gateId || node.kind !== 'gate') return node;
        let suffix = node.branches.length + 1;
        let id = `branch-${suffix}`;
        while (node.branches.some((branch) => branch.id === id)) {
          suffix += 1;
          id = `branch-${suffix}`;
        }
        const newBranch = { id, label: id };
        return { ...node, branches: [...node.branches, newBranch] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditBranch = useCallback((gateId: string, branchId: string, patch: { label?: string; description?: string }) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== gateId || node.kind !== 'gate') return node;
        return { ...node, branches: node.branches.map((secondBranch) => secondBranch.id === branchId ? { ...secondBranch, ...patch } : secondBranch) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteBranch = useCallback((gateId: string, branchId: string) => {
    const gate = nodesRef.current.find((node): node is Extract<WorkflowNode, { kind: 'gate' }> => node.kind === 'gate' && node.id === gateId);
    if (!gate || gate.branches.length <= 1) return;
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== gateId || node.kind !== 'gate') return node;
        return { ...node, branches: node.branches.filter((secondBranch) => secondBranch.id !== branchId) };
      });
      nodesRef.current = updated;
      return updated;
    });
    setEdges((previousEdges) => {
      const updated = previousEdges.filter((edge) => !(edge.from === gateId && edge.branch === branchId));
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onAddPath = useCallback((nodeId: string, path = '') => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== nodeId || node.kind !== 'step') return node;
        return { ...node, paths: [...(node.paths ?? []), path] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditPath = useCallback((nodeId: string, index: number, value: string) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== nodeId || node.kind !== 'step') return node;
        const paths = [...(node.paths ?? [])];
        paths[index] = value;
        return { ...node, paths };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeletePath = useCallback((nodeId: string, index: number) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== nodeId || node.kind !== 'step') return node;
        return { ...node, paths: (node.paths ?? []).filter((_, pathIndex) => pathIndex !== index) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onUploadImages = useCallback(async (nodeId: string, files: File[]) => {
    const uploaded = await uploadCanvasAssets(activeWorkflow, 'image', files);
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== nodeId || node.kind !== 'step') return node;
        return { ...node, images: [...(node.images ?? []), ...(uploaded.images ?? [])] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [activeWorkflow, scheduleSave]);

  const onDeleteImage = useCallback((nodeId: string, index: number) => {
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => {
        if (node.id !== nodeId || node.kind !== 'step') return node;
        return { ...node, images: (node.images ?? []).filter((_, imageIndex) => imageIndex !== index) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onImportPaths = useCallback(async (nodeId: string, files: File[], directory: boolean) => {
    if (!files.length) return;
    const uploaded = await uploadCanvasAssets(activeWorkflow, 'path', files, directory);
    setNodes((previousNodes) => {
      const updated = previousNodes.map((node) => node.id === nodeId && node.kind === 'step'
        ? { ...node, paths: [...(node.paths ?? []), ...uploaded.paths] }
        : node);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [activeWorkflow, scheduleSave]);

  const onEditEdge = useCallback((id: string, patch: Partial<Edge>) => {
    setEdges((previousEdges) => {
      const updated = previousEdges.map((edge) => edge.id === id ? { ...edge, ...patch } : edge);
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteEdge = useCallback((id: string) => {
    setEdges((previousEdges) => {
      const updated = previousEdges.filter((edge) => edge.id !== id);
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  // ── node/edge create (from canvas) ────────────────────────────────────────

  const onAddNode = useCallback((node: WorkflowNode) => {
    setNodes((previousNodes) => {
      const updated = [...previousNodes, node];
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onAddEdge = useCallback((edge: Edge) => {
    setEdges((previousEdges) => {
      const updated = [...previousEdges, edge];
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteNode = useCallback((id: string) => {
    const node = nodesRef.current.find((node) => node.id === id);
    if (!node) return;
    if ((node as WorkflowNode & { locked?: boolean }).locked) return;
    if (!window.confirm(t('node.deleteConfirm', { title: nodeDisplayTitle(node) }))) return;
    const updatedNodes = nodesRef.current.filter((node) => node.id !== id);
    const updatedEdges = edgesRef.current.filter((edge) => edge.from !== id && edge.to !== id);
    nodesRef.current = updatedNodes;
    edgesRef.current = updatedEdges;
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelection(null);
    scheduleSave();
  }, [scheduleSave, t]);

  const onDeleteNodes = useCallback((ids: string[]) => {
    const selectedIdSet = new Set(ids);
    const deletableNodes = nodesRef.current.filter((node) =>
      selectedIdSet.has(node.id) && !(node as WorkflowNode & { locked?: boolean }).locked);
    if (deletableNodes.length === 0) return;
    if (!window.confirm(t('node.deleteManyConfirm', { count: deletableNodes.length }))) return;
    const deleteIdSet = new Set(deletableNodes.map((node) => node.id));
    const updatedNodes = nodesRef.current.filter((node) => !deleteIdSet.has(node.id));
    const updatedEdges = edgesRef.current.filter((edge) => !deleteIdSet.has(edge.from) && !deleteIdSet.has(edge.to));
    nodesRef.current = updatedNodes;
    edgesRef.current = updatedEdges;
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelection(null);
    scheduleSave();
  }, [scheduleSave, t]);

  // ── session management ────────────────────────────────────────────────────

  const onAddSession = useCallback((name: string, agentServerId: Session['agentServerId']) => {
    setSessions((previousSessions) => {
      const id = name.trim();
      if (!isSymbolKey(id) || previousSessions.some((session) => session.id === id)) return previousSessions;
      const updated = [...previousSessions, { id, name: id, agentServerId }];
      sessionsRef.current = updated;
      setActiveSessionId(id);
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteSession = useCallback((id: string) => {
    if (sessionsRef.current.length <= 1) return;
    const remaining = sessionsRef.current.filter((session) => session.id !== id);
    const fallback = remaining[0]?.id ?? null;
    const updatedNodes = nodesRef.current.map((node) =>
      node.kind === 'step' && node.sessionId === id ? { ...node, sessionId: fallback } as WorkflowNode : node,
    );
    sessionsRef.current = remaining;
    nodesRef.current    = updatedNodes;
    const updatedEdges = normalizeTransferConfiguration(edgesRef.current, updatedNodes);
    edgesRef.current = updatedEdges;
    setSessions(remaining);
    setActiveSessionId(fallback ?? '');
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    scheduleSave();
  }, [scheduleSave]);

  const onUpdateSessionMcpServers = useCallback((id: string, mcpServers: string | undefined) => {
    setSessions((previousSessions) => {
      const updated = previousSessions.map((session) =>
        session.id === id ? { ...session, mcpServers: mcpServers || undefined } : session,
      );
      sessionsRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditSession = useCallback((id: string, patch: Partial<Pick<Session, 'name' | 'agentServerId'>>) => {
    const nextId = patch.name?.trim() ?? id;
    if (!isSymbolKey(nextId) || sessionsRef.current.some((session) => session.id === nextId && session.id !== id)) {
      return;
    }
    const updated = sessionsRef.current.map((session) =>
      session.id === id ? { ...session, ...patch, id: nextId, name: nextId } : session,
    );
    const updatedNodes = nodesRef.current.map((node) =>
      node.kind === 'step' && node.sessionId === id ? { ...node, sessionId: nextId } as WorkflowNode : node,
    );
    sessionsRef.current = updated;
    nodesRef.current = updatedNodes;
    const updatedEdges = normalizeTransferConfiguration(edgesRef.current, updatedNodes);
    edgesRef.current = updatedEdges;
    setSessions(updated);
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setActiveSessionId((active) => active === id ? nextId : active);
    scheduleSave();
  }, [scheduleSave]);

  // ── variable management (InputNode-derived) ───────────────────────────────

  // Variables are declared via InputNodes on the canvas. Editing a variable
  // default value from the SessionsBar patches the InputNode directly.
  const onEditVariable = useCallback((name: string, patch: Partial<{ defaultValue?: string; description?: string }>) => {
    const inputNode = nodesRef.current.find((node): node is InputNode => node.kind === 'input' && node.variableName === name);
    if (inputNode) onEditNode(inputNode.id, patch);
  }, [onEditNode]);

  // ── logs ──────────────────────────────────────────────────────────────────

  const onClearLogs = useCallback(() => setLogEvents([]), []);

  // ── selection ─────────────────────────────────────────────────────────────

  const onSelectNode     = (id: string) => { setRunConfigOpen(false); setSelection({ kind: 'node', id }); };
  const onSelectEdge     = (id: string) => { setRunConfigOpen(false); setSelection({ kind: 'edge', id }); };
  const onSelectNodes    = (ids: string[]) => {
    setRunConfigOpen(false);
    setSelection(ids.length === 1 ? { kind: 'node', id: ids[0]! } : ids.length > 1 ? { kind: 'nodes', ids } : null);
  };
  const onClearSelection = ()            => setSelection(null);

  const onCopyNode = useCallback(() => {
    if (view !== 'edit' || loadedWorkflowId !== activeWorkflow) return;
    const selectedIds = selection?.kind === 'node'
      ? [selection.id]
      : selection?.kind === 'nodes'
        ? selection.ids
        : [];
    if (selectedIds.length === 0) return;
    const selectedIdSet = new Set(selectedIds);
    const selectedNodes = nodesRef.current.filter((node) => selectedIdSet.has(node.id));
    if (selectedNodes.length === 0) return;
    const nextCopyBuffer = createCanvasNodeCopy({
      sourceWorkflowId: activeWorkflow,
      nodes: selectedNodes,
      edges: edgesRef.current,
    });
    nodeCopyBufferRef.current = nextCopyBuffer;
    setNodeCopyBuffer(nextCopyBuffer);
    pasteCountRef.current = 0;
  }, [activeWorkflow, loadedWorkflowId, selection, view]);

  const onPasteNode = useCallback((position: CanvasPastePosition) => {
    const copyBuffer = nodeCopyBufferRef.current;
    if (view !== 'edit' || !copyBuffer || !activeWorkflow || loadedWorkflowId !== activeWorkflow) return;
    const pasteIndex = pasteCountRef.current;
    const pasted = createPastedNodes({
      copiedNodes: copyBuffer.nodes,
      copiedEdges: copyBuffer.edges,
      existingNodes: nodesRef.current,
      existingEdges: edgesRef.current,
      sessions: sessionsRef.current,
      position,
      pasteIndex,
    });
    if (pasted.nodes.length === 0) return;
    const updatedNodes = [...nodesRef.current, ...pasted.nodes];
    const updatedEdges = [...edgesRef.current, ...pasted.edges];
    nodesRef.current = updatedNodes;
    edgesRef.current = updatedEdges;
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelection(pasted.nodes.length === 1 ? { kind: 'node', id: pasted.nodes[0]!.id } : { kind: 'nodes', ids: pasted.nodes.map((node) => node.id) });
    pasteCountRef.current = pasteIndex + 1;
    scheduleSave();
  }, [activeWorkflow, loadedWorkflowId, scheduleSave, view]);

  const onDeleteSelection = useCallback(() => {
    if (view !== 'edit' || loadedWorkflowId !== activeWorkflow || !selection) return;
    if (selection.kind === 'node') onDeleteNode(selection.id);
    if (selection.kind === 'nodes') onDeleteNodes(selection.ids);
    if (selection.kind === 'edge') onDeleteEdge(selection.id);
  }, [activeWorkflow, loadedWorkflowId, onDeleteEdge, onDeleteNode, onDeleteNodes, selection, view]);

  const onAddSessionRequest = useCallback(() => {
    setBarExpanded(true);
    setAddSessionPing((previousPing) => previousPing + 1);
  }, []);

  // ── keyboard delete ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (
        active.tagName === 'INPUT'
        || active.tagName === 'TEXTAREA'
        || active.tagName === 'SELECT'
        || active.isContentEditable
        || Boolean(active.closest('[contenteditable="true"]'))
      )) return;
      if (!selection) return;
      e.preventDefault();
      onDeleteSelection();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, onDeleteSelection]);

  // ── run management ────────────────────────────────────────────────────────

  const refreshAgentSessions = useCallback(() => {
    fetchAgentSessions({ workflowId: activeWorkflow }).then(setAgentSessions).catch(console.error);
  }, [activeWorkflow]);

  const refreshAgentServers = useCallback(() => {
    fetchAgentServers().then(setAgentServers).catch(console.error);
  }, []);

  const requestAuth = useCallback((statuses: AgentAuthenticationStatus[], resume?: () => void | Promise<void>) => {
    const required = statuses.filter((status) => status.needsAuth);
    if (required.length === 0) return;
    resumeAfterAuthRef.current = resume;
    setAuthStatuses(required);
  }, []);

  const onAuthReady = useCallback(async () => {
    const resume = resumeAfterAuthRef.current;
    resumeAfterAuthRef.current = undefined;
    setAuthStatuses([]);
    await resume?.();
  }, []);

  const onRunInteractionEvent = useCallback((interaction: RunInteraction) => {
    setPendingInteractions((previous) => {
      if (interaction.status !== 'pending') {
        return previous.filter((item) => item.id !== interaction.id);
      }
      const index = previous.findIndex((item) => item.id === interaction.id);
      if (index < 0) return [...previous, interaction];
      const next = [...previous];
      next[index] = interaction;
      return next;
    });
  }, []);

  const attachToRun = useCallback((runId: string, options: { replay?: boolean } = {}) => {
    if (subscribedRunIdRef.current === runId && runUnsubscribeRef.current) return;
    runUnsubscribeRef.current?.();
    subscribedRunIdRef.current = runId;
    let cancelled = false;
    let unsub = () => {};
    const cleanup = () => {
      cancelled = true;
      unsub();
      if (subscribedRunIdRef.current === runId) {
        subscribedRunIdRef.current = undefined;
        runUnsubscribeRef.current = undefined;
      }
    };
    runUnsubscribeRef.current = cleanup;

    unsub = subscribeToRun(runId, (type: SseEventType, data: unknown) => {
      if (cancelled) return;
      if (type === 'node-status') {
        const event = data as {
          nodeId: string;
          status: string;
          gateDecision?: { branchId: string; reason?: string };
          gateBranches?: Array<{ branchId: string; label: string; traversalsUsed: number; maxTraversals: number; available: boolean }>;
          replay?: boolean;
        };
        setLiveNodeStates((previous) => ({ ...previous, [event.nodeId]: event.status as import('./types').RunState }));
        if (event.gateDecision) {
          const decision = event.gateDecision;
          setLogEvents((previous) => {
            const last = previous[previous.length - 1];
            if (last && last.type === 'gate-decision' && last.nodeId === event.nodeId && last.branchId === decision.branchId) {
              return previous;
            }
            return [...previous.slice(-LOG_LIVE_CAP), {
              type: 'gate-decision',
              nodeId: event.nodeId,
              branchId: decision.branchId,
              reason: decision.reason,
              branches: event.gateBranches,
            }];
          });
        }
        if (event.status === 'paused' && !event.replay) {
          const node = nodesRef.current.find((candidate) => candidate.id === event.nodeId);
          if (node?.kind === 'step' && node.sessionId) {
            setPausedNode({ runId, nodeId: node.id, specflowSessionId: node.sessionId, agentServerId: sessionsRef.current.find((session) => session.id === node.sessionId)?.agentServerId ?? '', pausedAt: new Date().toISOString() });
            setActiveSessionId(node.sessionId);
            setBarExpanded(true);
          }
        } else if (event.status === 'success') {
          setPausedNode((paused) => paused?.nodeId === event.nodeId ? null : paused);
        }
      } else if (type === 'terminal') {
        // New runs receive terminal output through ACP timeline events.
      } else if (type === 'timeline') {
        setLogEvents((previous) => [...previous.slice(-LOG_LIVE_CAP), data as TimelineEvent]);
      } else if (type === 'session-update') {
        // ACP timeline is the live log source for new runs. Keep this legacy
        // branch silent to avoid double-rendering session updates.
      } else if (type === 'agent-prompt' || type === 'agent-lifecycle') {
        const event = data as ApiRunLogEvent;
        if (event.type === 'agent_lifecycle') {
          const lifecycle = event.lifecycle && typeof event.lifecycle === 'object' ? event.lifecycle as { type?: string } : {};
          if (lifecycle.type === 'session_created' || lifecycle.type === 'session_forked') {
            refreshAgentSessions();
          }
        }
      } else if (type === 'interaction-requested') {
        onRunInteractionEvent(data as RunInteraction);
      } else if (type === 'run-status') {
        const event = data as { status: string; error?: string; replay?: boolean };
        const uiStatus = runStatusFromEvent(event.status);
        setRuns((previous) => previous.map((run) =>
          run.id === runId ? { ...run, status: uiStatus } : run,
        ));
        if (uiStatus !== 'running') {
          if (!event.replay) {
            setPausedNode(null);
          }
          cleanup();
          if (!event.replay) {
            fetchRuns(activeWorkflow).then((records) => {
              setRuns(records.map(apiRunToUiRun));
              const fresh = records.find((run) => run.id === runId);
              if (fresh) {
                setHistoricNodeStates(fresh.nodeStates);
                setLiveNodeStates({});
              }
            }).catch(console.error);
            refreshAgentSessions();
          }
        }
      }
    }, options);
    return cleanup;
  }, [activeWorkflow, onRunInteractionEvent, refreshAgentSessions]);

  const onSelectRun = useCallback((id: string) => {
    setActiveRunId(id);
    setLiveNodeStates({});
    setLogEvents([]);
    setLogHistoryTotal(0);
    setLogHistoryEarliestIndex(0);
    setPendingInteractions([]);
    fetchRun(id).then((runRecord) => {
      const uiRun = apiRunToUiRun(runRecord);
      setHistoricNodeStates(uiRun.nodeStates ?? {});
      setRuns((previous) => previous.map((run) =>
        run.id === id
          ? {
              ...run,
              canvasSnapshot: uiRun.canvasSnapshot,
              nodeStates: uiRun.nodeStates,
              nodeOutputs: uiRun.nodeOutputs,
              initialInput: uiRun.initialInput,
              variableValues: uiRun.variableValues,
            }
          : run,
      ));
    }).catch(console.error);
    fetchPausedNodes(id).then((paused) => {
      setPausedNode(paused[0] ?? null);
      if (paused[0]) {
        setActiveSessionId(paused[0].specflowSessionId);
        setBarExpanded(true);
      }
    }).catch(console.error);
    // Load the most recent slice of historical events in one shot (cheap on
    // the client), then connect SSE with replay=false so we only get live
    // updates. This avoids flooding the UI with 70k+ session_update events
    // on long runs.
    fetchRunLogsRange(id, { tail: LOG_TAIL_INITIAL }).then((page) => {
      setLogEvents(apiRunLogsToTimelineEvents(page.events));
      setLogHistoryTotal(page.total);
      setLogHistoryEarliestIndex(page.startIndex);
    }).catch(console.error);
    attachToRun(id, { replay: false });
  }, [attachToRun]);

  const onLoadEarlierLogs = useCallback(async () => {
    if (!activeRunId || logHistoryLoading || logHistoryEarliestIndex <= 0) return;
    setLogHistoryLoading(true);
    try {
      const from = Math.max(0, logHistoryEarliestIndex - LOG_PAGE_SIZE);
      const page = await fetchRunLogsRange(activeRunId, { from, to: logHistoryEarliestIndex });
      if (page.events.length === 0) {
        setLogHistoryEarliestIndex(0);
        return;
      }
      const olderEvents = apiRunLogsToTimelineEvents(page.events);
      setLogEvents((previous) => [...olderEvents, ...previous]);
      setLogHistoryEarliestIndex(page.startIndex);
      setLogHistoryTotal(page.total);
    } catch (error) {
      console.error('Failed to load earlier logs', error);
    } finally {
      setLogHistoryLoading(false);
    }
  }, [activeRunId, logHistoryEarliestIndex, logHistoryLoading]);

  const onExitRunView = useCallback(() => {
    runUnsubscribeRef.current?.();
    runUnsubscribeRef.current = undefined;
    subscribedRunIdRef.current = undefined;
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setSelection(null);
    setPendingInteractions([]);
    setPausedNode(null);
  }, []);

  const onOpenNewRun = useCallback(() => {
    setRunStartError('');
    const defaults: Record<string, string> = {};
    for (const node of nodesRef.current) {
      if (node.kind === 'input') defaults[node.variableName] = node.defaultValue ?? '';
    }
    setRunConfigVars(defaults);
    setRunConfigBusy(false);
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setSelection(null);
    setPendingInteractions([]);
    setRunConfigOpen(true);
  }, []);

  const onRespondToInteraction = useCallback(async (interaction: RunInteraction, response: unknown) => {
    try {
      await respondToRunInteraction(interaction.runId, interaction.id, response);
      setPendingInteractions((previous) => previous.filter((item) => item.id !== interaction.id));
    } catch (error) {
      console.error('Failed to respond to interaction', error);
    }
  }, []);

  const startRun = useCallback(async (initialInput: string, variableValues: Record<string, string>) => {
    setRunStartBusy(true);
    setRunStartError('');
    try {
      const { runId } = await runCanvas(activeWorkflow, { initialInput, variableValues });

      const pending: RunStateMap = {};
      for (const node of nodesRef.current) pending[node.id] = 'pending';
      setLiveNodeStates(pending);
      setHistoricNodeStates({});
      setLogEvents([]);
      setPendingInteractions([]);
      setPausedNode(null);

      let placeholder: Run;
      try {
        const initial = await fetchRun(runId);
        placeholder = apiRunToUiRun(initial);
      } catch {
        placeholder = {
          id: runId,
          label: t('app.startingRun'),
          ticket: '',
          status: 'running',
          time: t('app.justNow'),
          duration: '—',
          agent: sessionsRef.current[0]?.agentServerId ?? t('app.unconfigured'),
        };
      }
      setRuns((previous) => [placeholder, ...previous]);
      setActiveRunId(runId);
      setBarExpanded(true);

      attachToRun(runId);
      fetchPausedNodes(runId).then((paused) => {
        if (paused[0]) {
          setPausedNode(paused[0]);
          setActiveSessionId(paused[0].specflowSessionId);
        }
      }).catch(console.error);
      return true;
    } catch (error) {
      if (error instanceof AgentAuthenticationRequiredError) {
        requestAuth(error.statuses, () => { void startRun(initialInput, variableValues); });
        return true;
      }
      console.error('Failed to start run', error);
      setRunStartError(t('app.runStartFailed', { message: errorMessage(error) }));
      return false;
    } finally {
      setRunStartBusy(false);
    }
  }, [activeWorkflow, attachToRun, requestAuth, t]);

  const onStartConfiguredRun = useCallback(async () => {
    setRunConfigBusy(true);
    const started = await startRun('', runConfigVars);
    if (started) setRunConfigOpen(false);
    setRunConfigBusy(false);
  }, [startRun, runConfigVars]);

  const handleRerun = useCallback(async (runId: string) => {
    setRunStartBusy(true);
    try {
      const { runId: newRunId } = await apiRerunRun(runId);
      const initial = await fetchRun(newRunId);
      const placeholder = apiRunToUiRun(initial);
      setRuns((previous) => [placeholder, ...previous]);
      setActiveRunId(newRunId);
      setLiveNodeStates(initial.nodeStates ?? {});
      setHistoricNodeStates({});
      setLogEvents([]);
      setPendingInteractions([]);
      setPausedNode(null);
      setBarExpanded(true);

      attachToRun(newRunId);
      fetchPausedNodes(newRunId).then((paused) => {
        if (paused[0]) {
          setPausedNode(paused[0]);
          setActiveSessionId(paused[0].specflowSessionId);
        }
      }).catch(console.error);
    } catch (error) {
      if (error instanceof AgentAuthenticationRequiredError) {
        requestAuth(error.statuses, () => handleRerun(runId));
        return;
      }
      console.error('Failed to re-run', error);
      setRunStartError(t('app.runStartFailed', { message: errorMessage(error) }));
    } finally {
      setRunStartBusy(false);
    }
  }, [attachToRun, requestAuth, t]);

  const onDeleteRun = useCallback(async (id: string) => {
    if (!window.confirm(t('app.deleteRunConfirm'))) return;
    try {
      await apiDeleteRun(id);
      setRuns((previous) => previous
        .filter((run) => run.id !== id)
        .map((run) => ({
          ...run,
          ...(run.resumedFromRunId === id ? { resumedFromRunId: undefined } : {}),
          ...(run.resumedByRunId === id ? { resumedByRunId: undefined } : {}),
        })));
      if (activeRunId === id) {
        setActiveRunId('');
        setHistoricNodeStates({});
        setLiveNodeStates({});
        setPendingInteractions([]);
      }
      refreshAgentSessions();
    } catch (error) {
      console.error('Failed to delete run', error);
    }
  }, [activeRunId, refreshAgentSessions]);

  const onCancelRun = useCallback(async (id: string) => {
    try {
      await apiCancelRun(id);
      setRuns((previous) => previous.map((run) =>
        run.id === id ? { ...run, status: 'cancelled' } : run,
      ));
      setLogEvents((previous) => [...previous.slice(-LOG_LIVE_CAP), { type: 'terminal', chunk: t('app.cancelRequested'), stream: 'system' }]);
    } catch (error) {
      console.error('Failed to cancel run', error);
    }
  }, []);

  const onRestoreHistoricalSession = useCallback(async (
    session: AgentSessionRecord,
    mode: RestoreMode,
    options?: { autoPrompt?: string },
  ) => {
    restoreRequestTokenRef.current += 1;
    const requestToken = restoreRequestTokenRef.current;
    terminateConversation(conversationRef.current);
    setRestoreStatusBySession((previous) => ({ ...previous, [session.id]: 'starting' }));
    setConversation({
      session,
      mode,
      status: 'starting',
      events: [{ type: 'display-message', role: 'system', text: mode === 'inspect' ? t('app.restoreLoading') : t('app.restoreResuming') }],
      canPrompt: false,
      busy: false,
      capabilityRefreshing: false,
      modeId: '',
      configOptions: {},
      configTouched: false,
    });

    fetchAgentServerCapabilities(session.agentServerId)
      .then((capabilities) => {
        if (!capabilities || requestToken !== restoreRequestTokenRef.current) return;
        setConversation((current) => current?.session.id === session.id
          ? applyConversationCapabilities(current, capabilities, { preferCurrentValues: true })
          : current);
      })
      .catch(() => {});

    let recordedContextLoaded = false;
    const loadRecordedContext = async () => {
      if (recordedContextLoaded) return;
      recordedContextLoaded = true;
      const recorded = apiRunLogsToTimelineEvents(await fetchRunLogs(session.latestRunId))
        .filter((event) =>
          !('agentInvocationId' in event)
          || !event.agentInvocationId
          || session.invocationIds.includes(event.agentInvocationId)
          || (event.type === 'session-update' && event.sessionId === session.acpSessionId))
        .map((event) => ({ ...event, localContext: true }));
      setConversation((current) => current?.session.id === session.id
        ? {
            ...current,
            events: [
              ...current.events,
              { type: 'display-message', role: 'system', text: t('app.restoreCannotReplay') },
              ...recorded,
            ],
          }
        : current);
    };

    try {
      if (mode === 'continue' && !session.acpSupportsLoadSession) {
        await loadRecordedContext();
      }
      const started = await restoreAgentSession(session.id, mode);
      if (requestToken !== restoreRequestTokenRef.current) {
        void cancelRestoredSession(started.restoreId).catch(console.error);
        return;
      }
      setConversation((current) => current?.session.id === session.id ? { ...current, restoreId: started.restoreId } : current);
      restoreUnsubscribeRef.current = subscribeToRestore(started.restoreId, (type: RestoreSseEventType, event: RestoreStreamEvent) => {
        if (type === 'terminal' && event.type === 'terminal') {
          setConversation((current) => current?.session.id === session.id
            ? { ...current, events: [...current.events, { type: 'terminal', chunk: event.chunk, stream: event.stream }] }
            : current);
          return;
        }

        if (type === 'session-update' && event.type === 'session-update') {
          setConversation((current) => current?.session.id === session.id
            ? applyConversationSessionUpdate({
                ...current,
                events: [...current.events, { type: 'session-update' as const, update: event.update, sessionId: event.sessionId }],
              }, event.update)
            : current);
          return;
        }

        if (type === 'interaction-requested' && event.type === 'interaction-requested') {
          onRunInteractionEvent(event.interaction);
          return;
        }

        if (type === 'restore-status' && event.type === 'restore-status') {
          if (mode === 'continue' && event.status === 'success' && event.selectedPrimitive === 'resume') {
            void loadRecordedContext().catch(console.error);
          }
          setRestoreStatusBySession((previous) => ({ ...previous, [session.id]: event.status }));
          const text = event.status === 'success'
            ? t('app.restoreSuccess', { primitive: event.selectedPrimitive ?? 'resume' })
            : event.status === 'failure'
              ? t('app.restoreFailed', { error: event.error ?? t('app.restoreUnknownError') })
              : t('app.restoreRequested');
          setConversation((current) => current?.session.id === session.id
            ? applyConversationCapabilities({
                ...current,
                status: event.status,
                canPrompt: mode === 'continue' && event.status === 'success',
                events: [...current.events, { type: 'display-message' as const, role: 'system' as const, text }],
              }, restoreEventCapabilities(current.capabilities, event.capabilities), { preferCurrentValues: true })
            : current);
          if (event.status === 'failure' || (event.status === 'success' && mode === 'inspect')) {
            refreshAgentSessions();
            restoreUnsubscribeRef.current?.();
            restoreUnsubscribeRef.current = undefined;
          }
          if (event.status === 'success' && mode === 'continue' && options?.autoPrompt) {
            const prompt = options.autoPrompt;
            const restoreId = started.restoreId;
            setConversation((current) => current?.session.id === session.id
              ? { ...current, busy: true }
              : current);
            void promptRestoredSession(restoreId, prompt, conversationPromptOptions(conversationRef.current))
              .catch((promptError) => {
                const message = promptError instanceof Error ? promptError.message : String(promptError);
                setConversation((current) => current?.session.id === session.id
                  ? { ...current, events: [...current.events, { type: 'display-message', role: 'system', text: t('app.autoContinuationFailed', { message }) }] }
                  : current);
              })
              .finally(() => {
                setConversation((current) => current?.session.id === session.id ? { ...current, busy: false } : current);
              });
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRestoreStatusBySession((previous) => ({ ...previous, [session.id]: 'failure' }));
      setConversation((current) => current?.session.id === session.id
        ? { ...current, status: 'failure', events: [...current.events, { type: 'display-message', role: 'system', text: t('app.restoreFailed', { error: message }) }] }
        : current);
    }
  }, [onRunInteractionEvent, refreshAgentSessions, terminateConversation]);

  const onResumeRun = useCallback(async (sourceRunId: string) => {
    try {
      const { runId: newRunId } = await resumeWorkflowRun(sourceRunId);
      const initial = await fetchRun(newRunId);
      const placeholder = apiRunToUiRun(initial);
      setRuns((previous) => [
        placeholder,
        ...previous.map((run) => run.id === sourceRunId ? { ...run, resumedByRunId: newRunId } : run),
      ]);
      setActiveRunId(newRunId);
      setLiveNodeStates(initial.nodeStates ?? {});
      setHistoricNodeStates({});
      setLogEvents([]);
      setLogHistoryTotal(0);
      setLogHistoryEarliestIndex(0);
      setPendingInteractions([]);
      setPausedNode(null);
      setBarExpanded(true);
      attachToRun(newRunId);
    } catch (error) {
      if (error instanceof AgentAuthenticationRequiredError) {
        requestAuth(error.statuses, () => onResumeRun(sourceRunId));
        return;
      }
      console.error('Failed to resume run', error);
      setRunStartError(t('app.resumeFailed', { message: errorMessage(error) }));
    }
  }, [attachToRun, requestAuth, t]);

  const onPromptConversation = useCallback(async (prompt: string) => {
    const active = conversation;
    if (!active?.restoreId || !active.canPrompt || active.busy) return;
    const controller = new AbortController();
    conversationPromptAbortRef.current?.abort();
    conversationPromptAbortRef.current = controller;
    setConversation((current) => current ? { ...current, busy: true } : current);
    try {
      await promptRestoredSession(active.restoreId, prompt, conversationPromptOptions(active), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setConversation((current) => current ? { ...current, events: [...current.events, { type: 'display-message', role: 'system', text: message }] } : current);
    } finally {
      if (conversationPromptAbortRef.current === controller) conversationPromptAbortRef.current = null;
      setConversation((current) => current ? { ...current, busy: false } : current);
    }
  }, [conversation]);

  const onCancelConversationPrompt = useCallback(() => {
    conversationPromptAbortRef.current?.abort();
  }, []);

  const refreshConversationCapabilities = useCallback(async () => {
    const active = conversation;
    if (!active) return;
    setConversation((current) => current?.session.id === active.session.id ? { ...current, capabilityRefreshing: true } : current);
    try {
      const capabilities = await refreshAgentServerCapabilities(active.session.agentServerId);
      setConversation((current) => current?.session.id === active.session.id
        ? applyConversationCapabilities({ ...current, capabilityRefreshing: false }, capabilities, { preferCurrentValues: !current.configTouched })
        : current);
    } catch {
      setConversation((current) => current?.session.id === active.session.id ? { ...current, capabilityRefreshing: false } : current);
    }
  }, [conversation]);

  const onCloseConversation = useCallback(() => {
    restoreRequestTokenRef.current += 1;
    terminateConversation(conversation);
    if (conversation?.restoreId) {
      setPendingInteractions((current) => current.filter((interaction) =>
        interaction.agentInvocationId !== `restore:${conversation.restoreId}`));
    }
    setConversation(null);
  }, [conversation, terminateConversation]);

  const appendPausedDisplayMessage = useCallback((
    node: PausedNodeSession,
    role: Extract<TimelineEvent, { type: 'display-message' }>['role'],
    text: string,
  ) => {
    setLogEvents((previous) => [...previous.slice(-LOG_LIVE_CAP), {
      type: 'display-message',
      role,
      text,
      nodeId: node.nodeId,
      specflowSessionId: node.specflowSessionId,
    }]);
  }, []);

  const onPromptPausedNode = useCallback(async (prompt: string) => {
    if (!pausedNode || pausedPromptBusy) return;
    const controller = new AbortController();
    pausedPromptAbortRef.current?.abort();
    pausedPromptAbortRef.current = controller;
    setPausedPromptBusy(true);
    try {
      await promptPausedNode(pausedNode.runId, pausedNode.nodeId, prompt, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      appendPausedDisplayMessage(pausedNode, 'system', error instanceof Error ? error.message : String(error));
    } finally {
      if (pausedPromptAbortRef.current === controller) pausedPromptAbortRef.current = null;
      setPausedPromptBusy(false);
    }
  }, [appendPausedDisplayMessage, pausedNode, pausedPromptBusy]);

  const onCancelPausedPrompt = useCallback(() => {
    pausedPromptAbortRef.current?.abort();
  }, []);

  const onContinuePausedNode = useCallback(async () => {
    if (!pausedNode || pausedPromptBusy) return;
    try {
      await continuePausedNode(pausedNode.runId, pausedNode.nodeId);
      setPausedNode(null);
    } catch (error) {
      appendPausedDisplayMessage(pausedNode, 'system', error instanceof Error ? error.message : String(error));
    }
  }, [appendPausedDisplayMessage, pausedNode, pausedPromptBusy]);

  // ── workflow management ───────────────────────────────────────────────────

  const onCreateWorkflow = useCallback(async (name: string) => {
    try {
      const canvasDocument = await createCanvas(name.trim() || t('app.untitledWorkflow'));
      const summary = { id: canvasDocument.id, name: canvasDocument.name, runs: 0 };
      setWorkflows((previous) => [summaryToWorkflow(summary), ...previous]);
      setActiveWorkflow(canvasDocument.id);
    } catch (error) {
      console.error('Failed to create workflow', error);
    }
  }, [t]);

  const onRenameWorkflow = useCallback(async (id: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;
    try {
      if (id === activeWorkflow) {
        clearTimeout(saveTimerRef.current);
        const canvasDocument = {
          id,
          name: nextName,
          sessions: sessionsRef.current,
          nodes: nodesRef.current,
          edges: edgesRef.current,
        };
        await saveCanvas(id, canvasDocument);
        setActiveCanvasName(nextName);
      } else {
        const canvasDocument = await fetchCanvas(id);
        await saveCanvas(id, { ...canvasDocument, name: nextName });
      }
      setWorkflows((previous) => previous.map((workflow) =>
        workflow.id === id ? { ...workflow, name: nextName } : workflow));
    } catch (error) {
      console.error('Failed to rename workflow', error);
    }
  }, [activeWorkflow]);

  const onDeleteWorkflow = useCallback(async (id: string) => {
    const workflow = workflows.find((candidate) => candidate.id === id);
    if (!workflow || !window.confirm(t('app.deleteWorkflowConfirm', { name: workflow.name }))) return;
    try {
      clearTimeout(saveTimerRef.current);
      await apiDeleteCanvas(id);
      setWorkflows((previous) => previous.filter((candidate) => candidate.id !== id));
      if (id === activeWorkflow) {
        const next = workflows.find((candidate) => candidate.id !== id);
        if (next) {
          setActiveWorkflow(next.id);
        } else {
          setActiveWorkflow('');
          setActiveCanvasName('');
          setSessions([]);
          sessionsRef.current = [];
          setNodes([]);
          nodesRef.current = [];
          setEdges([]);
          edgesRef.current = [];
          setRuns([]);
          setActiveRunId('');
          setSelection(null);
          setActiveSessionId('');
          setLogEvents([]);
          setPendingInteractions([]);
          setPausedNode(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete workflow', error);
    }
  }, [activeWorkflow, t, workflows]);

  // ── derived selection state ───────────────────────────────────────────────

  const selectedNode     = selection?.kind === 'node' ? displayNodes.find((node) => node.id === selection.id) : null;
  const selectedEdge     = selection?.kind === 'edge' ? displayEdges.find((edge) => edge.id === selection.id) : null;
  const selectedFromNode = selectedEdge ? displayNodes.find((node) => node.id === selectedEdge.from) : undefined;
  const selectedToNode   = selectedEdge ? displayNodes.find((node) => node.id === selectedEdge.to)   : undefined;
  const selectedTransferSourceNode = selectedEdge ? resolveTransferSource(selectedEdge, displayNodes, displayEdges) : undefined;
  const selectedNodeIds = selection?.kind === 'node' ? [selection.id] : selection?.kind === 'nodes' ? selection.ids : [];
  const canCopyNode = view === 'edit' && loadedWorkflowId === activeWorkflow && selectedNodeIds.some((id) => nodes.some((node) => node.id === id));
  const canPasteNode = view === 'edit' && loadedWorkflowId === activeWorkflow && Boolean(nodeCopyBuffer);
  const canDeleteSelection = view === 'edit'
    && loadedWorkflowId === activeWorkflow
    && (
      selection?.kind === 'edge'
        ? edges.some((edge) => edge.id === selection.id)
        : selectedNodeIds.some((id) => {
            const node = nodes.find((candidate) => candidate.id === id);
            return node && !(node as WorkflowNode & { locked?: boolean }).locked;
          })
    );

  const selectedNodeWithState = selectedNode
    ? { ...selectedNode, runState: runState[selectedNode.id] }
    : null;

  const hasRightPanel = selection?.kind === 'node' || selection?.kind === 'edge';
  const barH     = barExpanded ? barHeight : 32;
  const rootClass = ['app', 'two-col-left', 'has-bottom-bar', hasRightPanel ? '' : 'no-right'].filter(Boolean).join(' ');
  const leftWidth = sidebarTotalWidth(sidebarLayout);

  return (
    <div
      className={rootClass}
      style={{ '--bar-h': `${barH}px`, '--left-w': `${leftWidth}px` } as React.CSSProperties}
    >
      <TopBar
        theme={theme}
        onThemeChange={setTheme}
        runLabel={activeRun?.label}
        workflowName={activeCanvasName}
        onNewRun={onOpenNewRun}
        onRerun={activeRunId ? () => handleRerun(activeRunId) : undefined}
        onCancelRun={activeRunId ? () => onCancelRun(activeRunId) : undefined}
        canCancelRun={activeRun?.status === 'running'}
        onAgentServers={() => setAgentServerManagerOpen(true)}
        hasAgentUpdates={hasAgentUpdates}
        view={view}
        onExitRunView={onExitRunView}
      />
      {runStartError && (
        <div className="app-toast error" role="alert">
          <Icon name="alert" size={14} />
          <div className="app-toast-body">
            <div className="app-toast-title">{t('app.runBlocked')}</div>
            <div className="app-toast-message">{runStartError}</div>
          </div>
          <button className="icon-btn app-toast-close" title={t('common.close')} onClick={() => setRunStartError('')}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      <Sidebar
        workflows={workflows}
        runs={runs}
        activeWorkflow={activeWorkflow}
        activeRun={activeRunId}
        layout={sidebarLayout}
        onLayoutChange={setSidebarLayout}
        onSelectWorkflow={setActiveWorkflow}
        onSelectRun={onSelectRun}
        onNewRun={onOpenNewRun}
        onRerunRun={handleRerun}
        onResumeRun={onResumeRun}
        onDeleteRun={onDeleteRun}
        onCreateWorkflow={onCreateWorkflow}
        onRenameWorkflow={onRenameWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
      />

      <div className="canvas-cell" style={{ position: 'relative', overflow: 'hidden', minHeight: 0, height: '100%' }}>
        <Canvas
          nodes={displayNodes}
          edges={displayEdges}
          sessions={displaySessions}
          selection={selection}
          onSelectNode={onSelectNode}
          onSelectNodes={onSelectNodes}
          onSelectEdge={onSelectEdge}
          onClearSelection={onClearSelection}
          runState={runState}
          showRun={!!activeRun}
          onNodeMove={onNodeMove}
          onNodesMove={onNodesMove}
          onAddNode={onAddNode}
          onAddEdge={onAddEdge}
          onDeleteNode={onDeleteNode}
          onAddBranch={onAddBranch}
          canCopyNode={canCopyNode}
          canPasteNode={canPasteNode}
          canDeleteSelection={canDeleteSelection}
          onCopyNode={onCopyNode}
          onPasteNode={onPasteNode}
          onDeleteSelection={onDeleteSelection}
          onContinuePausedNode={(nodeId) => {
            if (pausedNode?.nodeId === nodeId) void onContinuePausedNode();
          }}
          viewMode={view}
          zoom={zoom} setZoom={setZoom}
          pan={pan} setPan={setPan}
        />
        {activeRun && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 6 }}>
            <div className="run-pill">
              <span className={`status-dot ${activeRun.status}`} />
              <span className="label">{t('app.runLabel')}</span>
              <span className="value">{activeRun.label}</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span className="value" style={{ color: 'var(--ink-3)' }}>{activeRun.duration}</span>
            </div>
          </div>
        )}
        {runStartBusy && !runConfigOpen && (
          <div className="run-start-busy" role="status">
            <span className="run-start-spinner" />
            {t('app.checkingAgents')}
          </div>
        )}
      </div>

      {runConfigOpen && (
        <RunConfigPanel
          workflowName={activeCanvasName}
          variables={variables}
          values={runConfigVars}
          setValue={(name, value) => setRunConfigVars((previous) => ({ ...previous, [name]: value }))}
          onCancel={() => setRunConfigOpen(false)}
          onStart={onStartConfiguredRun}
          busy={runConfigBusy}
        />
      )}

      {!runConfigOpen && pendingInteractions[0] && (
        <InteractionModal
          interaction={pendingInteractions[0]}
          onRespond={onRespondToInteraction}
        />
      )}

      {!runConfigOpen && agentServerManagerOpen && (
        <AgentServerManager
          onClose={() => setAgentServerManagerOpen(false)}
          onChanged={refreshAgentServers}
          onAuthRequired={(statuses) => requestAuth(statuses)}
        />
      )}

      {authStatuses.length > 0 && (
        <AgentAuthModal
          statuses={authStatuses}
          onClose={() => {
            resumeAfterAuthRef.current = undefined;
            setAuthStatuses([]);
          }}
          onReady={onAuthReady}
          onChanged={refreshAgentServers}
        />
      )}

      {!runConfigOpen && selection?.kind === 'node' && selectedNodeWithState && (
        <NodePanel
          node={selectedNodeWithState}
          run={activeRun}
          sessions={displaySessions}
          nodes={displayNodes}
          edges={displayEdges}
          viewMode={view}
          timelineEvents={logEvents}
          onClose={onClearSelection}
          onEditNode={onEditNode}
          onRenameNode={onRenameNode}
          onChangeSession={onChangeSession}
          onEditSession={(id, patch) => {
            if ('mcpServers' in patch) onUpdateSessionMcpServers(id, patch.mcpServers ?? undefined);
          }}
          onAddSessionRequest={onAddSessionRequest}
          onAddEdge={onAddEdge}
          onDeleteEdge={onDeleteEdge}
          onAddBranch={onAddBranch}
          onEditBranch={onEditBranch}
          onDeleteBranch={onDeleteBranch}
          onAddPath={onAddPath}
          onEditPath={onEditPath}
          onDeletePath={onDeletePath}
          onUploadImages={onUploadImages}
          onDeleteImage={onDeleteImage}
          onImportPaths={onImportPaths}
        />
      )}
      {!runConfigOpen && selection?.kind === 'edge' && selectedEdge && (
        <ConnectionPanel
          edge={selectedEdge}
          fromNode={selectedFromNode}
          toNode={selectedToNode}
          transferSourceNode={selectedTransferSourceNode}
          viewMode={view}
          onClose={onClearSelection}
          onEditEdge={onEditEdge}
          onDeleteEdge={onDeleteEdge}
        />
      )}

      <div className="bottom-bar-cell">
        <SessionsBar
          sessions={displaySessions}
          nodes={displayNodes}
          expanded={barExpanded}
          setExpanded={setBarExpanded}
          barHeight={barHeight}
          setBarHeight={(height) => {
            setBarHeight(height);
            try { localStorage.setItem('sf-bar-h', String(height)); } catch { /* ignore */ }
          }}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          activeRunId={activeRunId}
          activeRunStatus={activeRun?.status}
          onAssignSession={onChangeSession}
          addSessionPing={addSessionPing}
          timelineEvents={logEvents}
          onLoadEarlierLogs={onLoadEarlierLogs}
          canLoadEarlierLogs={logHistoryEarliestIndex > 0}
          loadingEarlierLogs={logHistoryLoading}
          historicLogTotal={logHistoryTotal}
          historicLogLoadedFromIndex={logHistoryEarliestIndex}
          onAddSession={onAddSession}
          onEditSession={onEditSession}
          onDeleteSession={onDeleteSession}
          onClearLogs={onClearLogs}
          variables={displayVariables}
          runVariableValues={activeRun?.variableValues}
          onEditVariable={onEditVariable}
          agentSessions={agentSessions}
          agentServers={agentServers}
          onRestoreSession={onRestoreHistoricalSession}
          restoreStatusBySession={restoreStatusBySession}
          pausedNode={pausedNode}
          pausedPromptBusy={pausedPromptBusy}
          onPromptPausedNode={onPromptPausedNode}
          onCancelPausedPrompt={onCancelPausedPrompt}
          onContinuePausedNode={onContinuePausedNode}
          readonly={view === 'run'}
        />
      </div>
      {conversation && (
        <AgentConversationWindow
          session={conversation.session}
          mode={conversation.mode}
          status={conversation.status}
          events={conversation.events}
          canPrompt={conversation.canPrompt}
          busy={conversation.busy}
          capabilities={conversation.capabilities}
          capabilityRefreshing={conversation.capabilityRefreshing}
          modeId={conversation.modeId}
          configOptions={conversation.configOptions}
          onRefreshCapabilities={refreshConversationCapabilities}
          onChangeMode={(modeId) => {
            setConversation((current) => current ? { ...current, modeId: modeId ?? '', configTouched: true } : current);
          }}
          onChangeConfigOption={(configId, value) => {
            setConversation((current) => {
              if (!current) return current;
              const next = { ...current.configOptions };
              if (value === undefined) delete next[configId];
              else next[configId] = value;
              return { ...current, configOptions: next, configTouched: true };
            });
          }}
          onPrompt={onPromptConversation}
          onCancelPrompt={onCancelConversationPrompt}
          onClose={onCloseConversation}
        />
      )}
    </div>
  );
}
