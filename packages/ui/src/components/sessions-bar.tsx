import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { Session, WorkflowNode, TimelineEvent, Variable, RunStatus } from '../types';
import type { AgentServerEntry, AgentSessionRecord, PausedNodeSession, RestoreMode } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './icon';
import { isSymbolKey, sessionAccent } from '../appearance';
import { SessionTimeline } from './session-timeline';
import { nodeDisplayTitle } from '../node-display';

interface SessionsBarProps {
  sessions: Session[];
  nodes: WorkflowNode[];
  expanded: boolean;
  setExpanded: (b: boolean) => void;
  barHeight: number;
  setBarHeight: (height: number) => void;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  activeRunId?: string;
  activeRunStatus?: RunStatus;
  onAssignSession: (nodeId: string, sessionId: string) => void;
  addSessionPing: number;
  timelineEvents?: TimelineEvent[];
  onLoadEarlierLogs?: () => void;
  canLoadEarlierLogs?: boolean;
  loadingEarlierLogs?: boolean;
  historicLogTotal?: number;
  historicLogLoadedFromIndex?: number;
  onAddSession: (name: string, agentServerId: Session['agentServerId']) => void;
  onEditSession: (id: string, patch: Partial<Pick<Session, 'name' | 'agentServerId'>>) => void;
  onDeleteSession: (id: string) => void;
  onClearLogs: () => void;
  variables: Variable[];
  runVariableValues?: Record<string, string>;
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  agentSessions?: AgentSessionRecord[];
  agentServers?: AgentServerEntry[];
  onRestoreSession?: (session: AgentSessionRecord, mode: RestoreMode) => void;
  restoreStatusBySession?: Record<string, string>;
  pausedNode?: PausedNodeSession | null;
  pausedPromptBusy?: boolean;
  onPromptPausedNode?: (prompt: string) => void;
  onCancelPausedPrompt?: () => void;
  onContinuePausedNode?: () => void;
  readonly?: boolean;
}

export function SessionsBar({
  sessions, nodes,
  expanded, setExpanded,
  barHeight, setBarHeight,
  activeSessionId, setActiveSessionId,
  activeRunId, activeRunStatus,
  onAssignSession, addSessionPing,
  timelineEvents,
  onLoadEarlierLogs, canLoadEarlierLogs, loadingEarlierLogs, historicLogTotal, historicLogLoadedFromIndex,
  onAddSession, onEditSession, onDeleteSession, onClearLogs,
  variables, runVariableValues, onEditVariable,
  agentSessions = [], agentServers = [],
  onRestoreSession,
  restoreStatusBySession = {},
  pausedNode, pausedPromptBusy = false,
  onPromptPausedNode, onCancelPausedPrompt, onContinuePausedNode,
  readonly,
}: SessionsBarProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'logs' | 'settings' | 'vars'>('logs');
  const barHeightRef = useRef(barHeight);
  const stepNodes = nodes.filter((node) => node.kind === 'step');

  useEffect(() => { barHeightRef.current = barHeight; }, [barHeight]);

  useEffect(() => {
    if (addSessionPing) setTab('settings');
  }, [addSessionPing]);

  const onResizeDown = (element: React.MouseEvent) => {
    element.preventDefault();
    const startY = element.clientY;
    const startH = barHeightRef.current;
    const onMove = (event: MouseEvent) => {
      const deltaY = startY - event.clientY;
      setBarHeight(Math.min(600, Math.max(120, startH + deltaY)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!expanded) {
    return (
      <div className="sessions-bar" style={{ height: 32 }}>
        <div className="sessions-head">
          <button className="bar-handle" onClick={() => setExpanded(true)} style={{ marginRight: 4 }}>
            <Icon name="chevron-up" size={12} />
          </button>
          <span className="title">
            <Icon name="terminal" size={11} style={{ verticalAlign: -2, marginRight: 4 }} />{t('sessions.title')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {t('sessions.sessionsCount', { count: sessions.length })} · {t('sessions.nodesCount', { count: stepNodes.length })}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{t('sessions.activity')}</span>
          {sessions.slice(0, 4).map((session) => (
            <span key={session.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--ink-2)' }}>
              <span className="ses-dot" style={{ width: 6, height: 6, borderRadius: 2, background: sessionAccent(session) }} />{session.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-bar" style={{ height: barHeight }}>
      {/* resize handle — drag up to grow, drag down to shrink */}
      <div
        className="bar-resize-handle"
        onMouseDown={onResizeDown}
        title={t('sessions.dragToResize')}
      />
      <div className="sessions-head">
        <button className="bar-handle" onClick={() => setExpanded(false)} style={{ marginRight: 4 }}>
          <Icon name="chevron-down" size={12} />
        </button>
        <div className="bar-tabs">
          <button className={`bar-tab${tab === 'logs' ? ' active' : ''}`} onClick={() => setTab('logs')}>
            <Icon name="terminal" size={11} />{t('sessions.logs')}
          </button>
          <button className={`bar-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
            <Icon name="settings" size={11} />{t('sessions.title')}
            <span className="count">{sessions.length}</span>
          </button>
          <button className={`bar-tab${tab === 'vars' ? ' active' : ''}`} onClick={() => setTab('vars')}>
            <Icon name="tag" size={11} />{t('sessions.variables')}
            {variables.length > 0 && <span className="count">{variables.length}</span>}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'logs' && (
          <button className="bar-handle" title={t('sessions.clearLogs')} onClick={onClearLogs}>
            <Icon name="trash" size={11} />
          </button>
        )}
      </div>

      {tab === 'logs' && (
        <LogsTab
          sessions={sessions}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          activeRunId={activeRunId}
          activeRunStatus={activeRunStatus}
          stepNodes={stepNodes}
          timelineEvents={timelineEvents}
          agentSessions={agentSessions}
          restoreStatusBySession={restoreStatusBySession}
          onRestoreSession={onRestoreSession}
          onLoadEarlierLogs={onLoadEarlierLogs}
          canLoadEarlierLogs={canLoadEarlierLogs}
          loadingEarlierLogs={loadingEarlierLogs}
          historicLogTotal={historicLogTotal}
          historicLogLoadedFromIndex={historicLogLoadedFromIndex}
          onDeleteSession={onDeleteSession}
          pausedNode={pausedNode}
          pausedPromptBusy={pausedPromptBusy}
          onPromptPausedNode={onPromptPausedNode}
          onCancelPausedPrompt={onCancelPausedPrompt}
          onContinuePausedNode={onContinuePausedNode}
          t={t}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab
          sessions={sessions}
          stepNodes={stepNodes}
          onAssignSession={onAssignSession}
          addSessionPing={addSessionPing}
          onAddSession={onAddSession}
          onEditSession={onEditSession}
          onDeleteSession={onDeleteSession}
          agentServers={agentServers}
          readonly={readonly}
          t={t}
        />
      )}
      {tab === 'vars' && (
        <VariablesTab
          variables={variables}
          runVariableValues={runVariableValues}
          onEditVariable={onEditVariable}
          readonly={readonly}
          t={t}
        />
      )}
    </div>
  );
}

// ── logs tab ──────────────────────────────────────────────────────────────────

interface LogsTabProps {
  sessions: Session[];
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  activeRunId?: string;
  activeRunStatus?: RunStatus;
  stepNodes: WorkflowNode[];
  timelineEvents?: TimelineEvent[];
  agentSessions: AgentSessionRecord[];
  restoreStatusBySession: Record<string, string>;
  onRestoreSession?: (session: AgentSessionRecord, mode: RestoreMode) => void;
  onLoadEarlierLogs?: () => void;
  canLoadEarlierLogs?: boolean;
  loadingEarlierLogs?: boolean;
  historicLogTotal?: number;
  historicLogLoadedFromIndex?: number;
  onDeleteSession: (id: string) => void;
  pausedNode?: PausedNodeSession | null;
  pausedPromptBusy: boolean;
  onPromptPausedNode?: (prompt: string) => void;
  onCancelPausedPrompt?: () => void;
  onContinuePausedNode?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function LogsTab({
  sessions, activeSessionId, setActiveSessionId, activeRunId, activeRunStatus, stepNodes, timelineEvents, agentSessions, restoreStatusBySession, onRestoreSession, onDeleteSession,
  onLoadEarlierLogs, canLoadEarlierLogs, loadingEarlierLogs, historicLogTotal, historicLogLoadedFromIndex,
  pausedNode, pausedPromptBusy, onPromptPausedNode, onCancelPausedPrompt, onContinuePausedNode,
  t,
}: LogsTabProps) {
  const [sideW, setSideW] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('sf-side-w') ?? '', 10);
      return Number.isFinite(saved) ? Math.min(360, Math.max(140, saved)) : 180;
    } catch { return 180; }
  });
  const [dragging, setDragging] = useState(false);
  const sideWRef = useRef(sideW);

  useEffect(() => {
    sideWRef.current = sideW;
    try { localStorage.setItem('sf-side-w', String(sideW)); } catch { /* ignore */ }
  }, [sideW]);

  const onResizerDown = (element: React.MouseEvent) => {
    element.preventDefault();
    setDragging(true);
    const startX = element.clientX;
    const startW = sideWRef.current;
    const onMove = (event: MouseEvent) => {
      const deltaX = startX - event.clientX;
      setSideW(Math.min(360, Math.max(140, startW + deltaX)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const termRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const prevLenRef = useRef(0);
  const prevFirstRef = useRef<TimelineEvent | undefined>(undefined);
  const prevLastRef = useRef<TimelineEvent | undefined>(undefined);
  const prevHeightRef = useRef(0);
  const prevActiveEntryIdRef = useRef<string | undefined>(undefined);

  const sessionTree = buildLogSessionTree({ sessions, stepNodes, timelineEvents, agentSessions, activeRunId, t });
  const activeEntry = findLogSessionEntry(sessionTree, activeSessionId) ?? sessionTree[0]?.root ?? sessionTree[0]?.forks[0];
  const activeNodeIds = new Set(
    stepNodes.filter((node) => node.kind === 'step' && node.sessionId === activeEntry?.id).map((node) => node.id),
  );
  const nodeById = new Map(stepNodes.map((node) => [node.id, node]));
  const visibleEvents = (timelineEvents ?? []).filter((event) => {
    if (!activeEntry) return true;
    if (event.type === 'acp_timeline' && event.kind === 'lifecycle') {
      const data = event.data && typeof event.data === 'object'
        ? event.data as { specflowSessionId?: unknown; parentSpecflowSessionId?: unknown }
        : undefined;
      const eventSessionId = typeof event.specflowSessionId === 'string'
        ? event.specflowSessionId
        : typeof data?.specflowSessionId === 'string'
          ? data.specflowSessionId
          : undefined;
      const parentSessionId = typeof data?.parentSpecflowSessionId === 'string'
        ? data.parentSpecflowSessionId
        : undefined;
      if (eventSessionId || parentSessionId) {
        if (activeEntry.kind === 'fork') return eventSessionId === activeEntry.id;
        return eventSessionId === activeEntry.id || parentSessionId === activeEntry.id;
      }
      return true;
    }
    // Events explicitly tagged with this session win over display metadata.
    if ('specflowSessionId' in event && event.specflowSessionId) {
      return event.specflowSessionId === activeEntry.id;
    }
    if (event.type === 'display-message' && event.fork) {
      if (activeEntry.kind === 'fork') return event.fork.specflowSessionId === activeEntry.id;
      return event.fork.parentSpecflowSessionId === activeEntry.id;
    }
    // Events with a nodeId: only show if that node belongs to the active session.
    if ('nodeId' in event && event.nodeId) {
      return activeEntry.kind === 'root' && activeNodeIds.has(event.nodeId);
    }
    // Unscoped run-level events (system messages, cancellation, etc) appear in every tab.
    return true;
  });

  useLayoutEffect(() => {
    const events = visibleEvents;
    const element = termRef.current;
    const currFirst = events[0];
    const currLast = events.at(-1);
    const activeEntryId = activeEntry?.id;
    if (!element) {
      prevLenRef.current = events.length;
      prevFirstRef.current = currFirst;
      prevLastRef.current = currLast;
      prevActiveEntryIdRef.current = activeEntryId;
      return;
    }
    const prevLen = prevLenRef.current;
    const prevFirst = prevFirstRef.current;
    const prevLast = prevLastRef.current;
    const activeChanged = activeEntryId !== prevActiveEntryIdRef.current;
    const grew = events.length > prevLen;
    const firstChanged = prevLen > 0 && currFirst !== prevFirst;
    const lastChanged = currLast !== prevLast;
    const prepended = grew && firstChanged && !lastChanged;

    if (activeChanged) {
      element.scrollTop = element.scrollHeight;
      stickToBottomRef.current = true;
    } else if (prepended) {
      // Prepend (Load earlier): keep the currently-visible content under the
      // user's eye by compensating scrollTop for the height added at the top.
      const delta = element.scrollHeight - prevHeightRef.current;
      element.scrollTop = element.scrollTop + delta;
      stickToBottomRef.current = isNearLogBottom(element);
    } else if (lastChanged && stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
      stickToBottomRef.current = true;
    }

    prevLenRef.current = events.length;
    prevFirstRef.current = currFirst;
    prevLastRef.current = currLast;
    prevActiveEntryIdRef.current = activeEntryId;
    prevHeightRef.current = element.scrollHeight;
  }, [visibleEvents, activeEntry?.id]);

  const onTermScroll = () => {
    const element = termRef.current;
    if (!element) return;
    stickToBottomRef.current = isNearLogBottom(element);
  };

  return (
    <div className="sessions-body logs">
      <div className="term-pane">
        <div className="term-header">
          <span className="ses-dot" style={{ width: 8, height: 8, borderRadius: 2, background: activeEntry ? logSessionAccent(activeEntry) : 'var(--ink-3)' }} />
          <strong style={{ fontSize: 11.5 }}>{activeEntry?.name}</strong>
          <span className="agent-badge">
            <span className="dot" style={{ background: activeEntry ? logSessionAccent(activeEntry) : 'var(--ink-3)' }} />{activeEntry?.agentServerId ?? t('sessions.runtimeSession')}
          </span>
          <span style={{ color: 'var(--ink-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
            · {activeEntry?.kind === 'fork' ? t('sessions.runtimeFork') : t('sessions.nodesCount', { count: activeNodeIds.size })}
          </span>
          <LogSessionActions
            entry={activeEntry}
            activeRunId={activeRunId}
            activeRunStatus={activeRunStatus}
            restoreStatusBySession={restoreStatusBySession}
            onRestoreSession={onRestoreSession}
            t={t}
          />
        </div>
        <div className="term-stream" ref={termRef} onScroll={onTermScroll}>
          {canLoadEarlierLogs && onLoadEarlierLogs && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '6px 12px',
              borderBottom: '1px solid var(--rule-2, #2a2a2a)',
              fontSize: 10.5,
              color: 'var(--ink-3)',
              fontFamily: 'var(--font-mono)',
            }}>
              <button
                className="btn sm"
                disabled={loadingEarlierLogs}
                onClick={onLoadEarlierLogs}
              >
                <Icon name="chevron-up" size={10} />
                {loadingEarlierLogs ? t('common.loading') : t('sessions.loadEarlier')}
              </button>
              {typeof historicLogTotal === 'number' && typeof historicLogLoadedFromIndex === 'number' && (
                <span>{t('sessions.eventsCount', { loaded: historicLogTotal - historicLogLoadedFromIndex, total: historicLogTotal })}</span>
              )}
            </div>
          )}
          {visibleEvents.length > 0 ? (
            <SessionTimeline events={visibleEvents} nodeById={nodeById} />
          ) : (
            <>
              <div className="term-line"><span className="ts">-</span><span className="lvl">[sys]</span><span>{timelineEvents && timelineEvents.length > 0 ? t('sessions.noOutputForSession') : t('sessions.noRunOutputYet')}</span></div>
              <div className="term-line">
                <span className="ts">—</span>
                <span style={{ color: 'var(--ink-3)' }}>·</span>
                <span style={{ animation: 'blink 1s steps(2) infinite' }}>▎</span>
              </div>
            </>
          )}
        </div>
        {pausedNode && activeEntry?.kind === 'root' && pausedNode.specflowSessionId === activeEntry.id && (
          <PausedNodeComposer
            node={stepNodes.find((candidate) => candidate.id === pausedNode.nodeId)}
            busy={pausedPromptBusy}
            onPrompt={onPromptPausedNode}
            onCancel={onCancelPausedPrompt}
            onContinue={onContinuePausedNode}
            t={t}
          />
        )}
      </div>
      <div
        className={`term-resizer${dragging ? ' dragging' : ''}`}
        onMouseDown={onResizerDown}
        title={t('sessions.dragToResize')}
      />
      <div className="term-sidebar" style={{ width: sideW }}>
        <div className="term-sidebar-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{t('sessions.title')}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-4)' }}>{countLogSessions(sessionTree)}</span>
        </div>
        <div className="term-sidebar-list">
          {sessionTree.length === 0 && (
            <div className="term-empty-session">{t('sessions.noSessions')}</div>
          )}
          {sessionTree.map((group) => (
            <div key={group.id} className="term-session-group">
              {group.missingParent ? (
                <div className="term-session-group-label">{t('agentSession.missingParent', { id: group.id })}</div>
              ) : (
                <LogSessionRow
                  entry={group.root}
                  active={group.root.id === activeEntry?.id}
                  canDelete={Boolean(group.root.authoredSession) && sessions.length > 1}
                  onClick={() => setActiveSessionId(group.root.id)}
                  onDelete={() => onDeleteSession(group.root.id)}
                  t={t}
                />
              )}
              {group.forks.map((fork) => (
                <LogSessionRow
                  key={fork.id}
                  entry={fork}
                  active={fork.id === activeEntry?.id}
                  onClick={() => setActiveSessionId(fork.id)}
                  t={t}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type TFunction = (key: string, params?: Record<string, string | number>) => string;

interface LogSessionEntry {
  id: string;
  name: string;
  kind: 'root' | 'fork';
  agentServerId?: string;
  parentId?: string;
  nodeCount: number;
  record?: AgentSessionRecord;
  authoredSession?: Session;
  fork?: NonNullable<Extract<TimelineEvent, { type: 'display-message' }>['fork']>;
}

interface LogSessionGroup {
  id: string;
  root: LogSessionEntry;
  forks: LogSessionEntry[];
  missingParent?: boolean;
}

function buildLogSessionTree(input: {
  sessions: Session[];
  stepNodes: WorkflowNode[];
  timelineEvents?: TimelineEvent[];
  agentSessions: AgentSessionRecord[];
  activeRunId?: string;
  t: TFunction;
}): LogSessionGroup[] {
  const groups = new Map<string, LogSessionGroup>();
  const nodeCounts = new Map<string, number>();
  for (const node of input.stepNodes) {
    if (node.kind !== 'step' || !node.sessionId) continue;
    nodeCounts.set(node.sessionId, (nodeCounts.get(node.sessionId) ?? 0) + 1);
  }
  const ensureGroup = (id: string, missingParent = false): LogSessionGroup => {
    const existing = groups.get(id);
    if (existing) return existing;
    const authored = input.sessions.find((session) => session.id === id);
    const group: LogSessionGroup = {
      id,
      missingParent,
      root: {
        id,
        kind: 'root',
        name: authored?.name ?? (missingParent ? input.t('agentSession.missingParent', { id }) : id || input.t('agentSession.unscoped')),
        agentServerId: authored?.agentServerId ?? authored?.agent,
        nodeCount: nodeCounts.get(id) ?? 0,
        authoredSession: authored,
      },
      forks: [],
    };
    groups.set(id, group);
    return group;
  };

  for (const session of input.sessions) ensureGroup(session.id);

  const addFork = (entry: LogSessionEntry) => {
    const parentId = entry.parentId ?? '';
    const group = ensureGroup(parentId, !input.sessions.some((session) => session.id === parentId));
    const index = group.forks.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) {
      group.forks[index] = {
        ...group.forks[index],
        ...entry,
        record: entry.record ?? group.forks[index]!.record,
        fork: entry.fork ?? group.forks[index]!.fork,
      };
    } else {
      group.forks.push(entry);
    }
  };

  for (const record of input.agentSessions) {
    if (!record.specflowSessionId || !agentSessionMatchesRun(record, input.activeRunId)) continue;
    if (!record.parentSpecflowSessionId) {
      const group = ensureGroup(record.specflowSessionId);
      group.root = {
        ...group.root,
        agentServerId: record.agentServerId,
        record,
      };
      continue;
    }
    addFork({
      id: record.specflowSessionId,
      kind: 'fork',
      name: sessionForkLabel(record, input.t),
      agentServerId: record.agentServerId,
      parentId: record.parentSpecflowSessionId,
      nodeCount: record.invocations.length,
      record,
    });
  }

  for (const event of input.timelineEvents ?? []) {
    if (event.type !== 'display-message' || !event.fork?.specflowSessionId) continue;
    addFork({
      id: event.fork.specflowSessionId,
      kind: 'fork',
      name: forkEventLabel(event.fork, input.t),
      parentId: event.fork.parentSpecflowSessionId,
      nodeCount: 1,
      fork: event.fork,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      forks: [...group.forks].sort((left, right) => {
        const leftTime = left.record?.firstSeenAt ?? '';
        const rightTime = right.record?.firstSeenAt ?? '';
        return leftTime.localeCompare(rightTime) || left.id.localeCompare(right.id);
      }),
    }))
    .sort((left, right) => {
      if (left.missingParent !== right.missingParent) return left.missingParent ? 1 : -1;
      return left.id.localeCompare(right.id);
    });
}

function agentSessionMatchesRun(session: AgentSessionRecord, activeRunId?: string): boolean {
  if (!activeRunId) return false;
  return session.latestRunId === activeRunId || session.runIds.includes(activeRunId);
}

function findLogSessionEntry(groups: LogSessionGroup[], id: string): LogSessionEntry | undefined {
  for (const group of groups) {
    if (group.root.id === id) return group.root;
    const fork = group.forks.find((candidate) => candidate.id === id);
    if (fork) return fork;
  }
  return undefined;
}

function countLogSessions(groups: LogSessionGroup[]): number {
  return groups.reduce((count, group) => count + (group.missingParent ? 0 : 1) + group.forks.length, 0);
}

function logSessionAccent(entry: LogSessionEntry): string {
  if (entry.authoredSession) return sessionAccent(entry.authoredSession);
  if (entry.agentServerId) return sessionAccent({ agentServerId: entry.agentServerId });
  return 'var(--ink-3)';
}

function LogSessionRow({
  entry,
  active,
  canDelete = false,
  onClick,
  onDelete,
  t,
}: {
  entry: LogSessionEntry;
  active: boolean;
  canDelete?: boolean;
  onClick: () => void;
  onDelete?: () => void;
  t: TFunction;
}) {
  return (
    <div
      className={`term-ses-item${entry.kind === 'fork' ? ' fork' : ''}${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="ses-dot" style={{ background: logSessionAccent(entry) }} />
      <span className="name">{entry.name}</span>
      <span className="count">{entry.kind === 'fork' ? entry.id : entry.nodeCount}</span>
      {canDelete && (
        <button
          className="ses-del"
          title={t('sessions.deleteSession')}
          onClick={(event) => { event.stopPropagation(); onDelete?.(); }}
        >
          <Icon name="x" size={10} />
        </button>
      )}
    </div>
  );
}

function LogSessionActions({
  entry,
  activeRunId,
  activeRunStatus,
  restoreStatusBySession,
  onRestoreSession,
  t,
}: {
  entry?: LogSessionEntry;
  activeRunId?: string;
  activeRunStatus?: RunStatus;
  restoreStatusBySession: Record<string, string>;
  onRestoreSession?: (session: AgentSessionRecord, mode: RestoreMode) => void;
  t: TFunction;
}) {
  const record = entry?.record;
  const restoreStatus = record ? restoreStatusBySession[record.id] : undefined;
  const runBusy = activeRunStatus === 'running' || activeRunStatus === 'pending';
  const restoreBusy = restoreStatus === 'starting' || restoreStatus === 'requested';
  const supportsRestore = Boolean(record && (record.acpSupportsLoadSession || record.acpSupportsResumeSession));

  return (
    <div className="term-actions">
      {restoreStatus && <span className={`history-restore-status ${restoreStatus === 'failure' ? 'failed' : ''}`}>{t('agentSession.restoreStatus', { status: restoreStatus })}</span>}
      {activeRunId && !record && <span className="term-action-hint">{t('sessions.noAcpSessionYet')}</span>}
      {record && runBusy && <span className="term-action-hint">{t('sessions.runActive')}</span>}
      {record && !runBusy && !supportsRestore && <span className="term-action-hint">{t('sessions.noRestoreSupport')}</span>}
      {record && !runBusy && supportsRestore && (
        <>
          <button className="btn sm" disabled={restoreBusy} onClick={() => onRestoreSession?.(record, 'inspect')} title={t('agentSession.inspectTitle')}>
            <Icon name="search" size={10} />{t('agentSession.inspect')}
          </button>
          <button className="btn sm primary" disabled={restoreBusy} onClick={() => onRestoreSession?.(record, 'continue')} title={t('agentSession.resumeTitle')}>
            <Icon name="play-circle" size={10} />{t('agentSession.resume')}
          </button>
        </>
      )}
    </div>
  );
}

function sessionForkLabel(session: AgentSessionRecord, t: TFunction): string {
  const latest = [...session.invocations].reverse().find((reference) => reference.purpose === 'handoff' || reference.purpose === 'gate')
    ?? session.invocations.at(-1);
  if (!latest) return session.specflowSessionId ?? session.acpSessionId;
  if (latest.purpose === 'handoff') {
    return t('agentSession.handoffInvocation', {
      source: latest.sourceNodeId ?? latest.edgeId ?? 'source',
      target: latest.targetNodeId ?? 'target',
    });
  }
  if (latest.purpose === 'gate') {
    return t('agentSession.gateInvocation', { node: latest.nodeId ?? 'gate' });
  }
  return latest.nodeId ?? latest.edgeId ?? latest.invocationId;
}

function forkEventLabel(fork: NonNullable<Extract<TimelineEvent, { type: 'display-message' }>['fork']>, t: TFunction): string {
  if (fork.purpose === 'handoff') {
    return t('agentSession.handoffInvocation', {
      source: fork.sourceNodeId ?? 'source',
      target: fork.targetNodeId ?? 'target',
    });
  }
  if (fork.purpose === 'gate') {
    return t('agentSession.gateInvocation', { node: fork.nodeId ?? 'gate' });
  }
  return fork.specflowSessionId;
}

export function PausedNodeComposer(props: {
  node?: WorkflowNode;
  busy: boolean;
  onPrompt?: (prompt: string) => void;
  onCancel?: () => void;
  onContinue?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [prompt, setPrompt] = useState('');
  const submit = (override?: string) => {
    const value = (override ?? prompt).trim();
    if (!value || props.busy) return;
    props.onPrompt?.(value);
    setPrompt('');
  };
  return (
    <div className="paused-composer">
      <div className="paused-composer-head">
        <span><Icon name="pause" size={11} /> {props.t('sessions.pausedAfter', { node: props.node ? nodeDisplayTitle(props.node) : 'node' })}</span>
        <button className="btn sm primary" disabled={props.busy} onClick={props.onContinue}>
          <Icon name="play" size={10} />{props.t('sessions.continueWorkflow')}
        </button>
      </div>
      <div className="paused-compose-input">
        <textarea
          className="textarea"
          rows={2}
          value={prompt}
          disabled={props.busy}
          placeholder={props.t('sessions.promptPausedSession')}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event.currentTarget.value);
            }
          }}
        />
        {props.busy ? (
          <button className="btn sm" onClick={props.onCancel}>{props.t('common.cancel')}</button>
        ) : (
          <button className="btn sm" disabled={!prompt.trim()} onClick={() => submit()}>
            {props.t('sessions.send')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── settings tab ──────────────────────────────────────────────────────────────

interface SettingsTabProps {
  sessions: Session[];
  stepNodes: WorkflowNode[];
  onAssignSession: (nodeId: string, sessionId: string) => void;
  addSessionPing: number;
  onAddSession: (name: string, agentServerId: Session['agentServerId']) => void;
  onEditSession: (id: string, patch: Partial<Pick<Session, 'name' | 'agentServerId'>>) => void;
  onDeleteSession: (id: string) => void;
  agentServers: AgentServerEntry[];
  readonly?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

// ── variables tab ─────────────────────────────────────────────────────────────

interface VariablesTabProps {
  variables: Variable[];
  runVariableValues?: Record<string, string>;
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  readonly?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function VariablesTab({ variables, runVariableValues, onEditVariable, readonly, t }: VariablesTabProps) {
  if (variables.length === 0) {
    return (
      <div className="sessions-body settings">
        <div style={{ padding: '12px 16px', color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          {t('variables.empty')}<br />
          {t('variables.emptyHint')}
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-body settings">
      <div className="assn-list" style={{ overflow: 'auto', flex: 1 }}>
        <div className={`assn-list-head vars${readonly ? ' readonly' : ''}`}>
          <span>{t('variables.name')}</span>
          <span>{readonly ? t('variables.runValue') : t('variables.defaultValue')}</span>
          <span>{t('variables.description')}</span>
        </div>
        {variables.map((variable) => (
          <div key={variable.name} className={`assn-row vars${readonly ? ' readonly' : ''}`} style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-2)', flexShrink: 0, minWidth: 120 }}>
              &lt;{variable.name}&gt;
            </span>
            {readonly ? (
              <>
                <VariableValueCell variable={variable} runVariableValues={runVariableValues} t={t} />
                <ReadOnlyText value={variable.description} />
              </>
            ) : (
              <>
                <input
                  className="input"
                  value={variable.defaultValue ?? ''}
                  placeholder="—"
                  onChange={(event) => onEditVariable(variable.name, { defaultValue: event.target.value || undefined })}
                  style={{ flex: 1, minWidth: 80 }}
                />
                <input
                  className="input"
                  value={variable.description ?? ''}
                  placeholder="—"
                  onChange={(event) => onEditVariable(variable.name, { description: event.target.value || undefined })}
                  style={{ flex: 2 }}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VariableValueCell({
  variable,
  runVariableValues,
  t,
}: {
  variable: Variable;
  runVariableValues?: Record<string, string>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const hasRunValue = Boolean(runVariableValues && Object.prototype.hasOwnProperty.call(runVariableValues, variable.name));
  const value = hasRunValue ? runVariableValues![variable.name] : variable.defaultValue;
  return (
    <div className="readonly-value-cell">
      <span className={value ? undefined : 'placeholder'}>{value || '—'}</span>
      {!hasRunValue && variable.defaultValue !== undefined && <span className="mini-tag">{t('variables.defaultTag')}</span>}
    </div>
  );
}

function ReadOnlyText({ value }: { value?: string }) {
  return <div className="readonly-value-cell"><span className={value ? undefined : 'placeholder'}>{value || '—'}</span></div>;
}

function SettingsTab({ sessions, stepNodes, onAssignSession, addSessionPing, onAddSession, onEditSession, onDeleteSession, agentServers, readonly, t }: SettingsTabProps) {
  const [draftName, setDraftName] = useState('');
  const [draftAgent, setDraftAgent] = useState<Session['agentServerId']>('unconfigured');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingAgent, setEditingAgent] = useState<Session['agentServerId']>('unconfigured');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addSessionPing && inputRef.current) {
      const focusTimer = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 60);
      return () => clearTimeout(focusTimer);
    }
  }, [addSessionPing]);

  useEffect(() => {
    if (agentServers.length > 0 && !agentServers.some((server) => server.id === draftAgent)) {
      setDraftAgent(agentServers[0]!.id);
    }
  }, [agentServers, draftAgent]);

  const handleAdd = () => {
    if (readonly) return;
    const name = (inputRef.current?.value ?? draftName).trim();
    if (!isSymbolKey(name) || sessions.some((session) => session.id === name)) return;
    onAddSession(name, draftAgent);
    setDraftName('');
  };

  const startEdit = (session: Session) => {
    setEditingId(session.id);
    setEditingName(session.name);
    setEditingAgent(session.agentServerId ?? session.agent ?? draftAgent);
  };

  const cancelEdit = () => {
    setEditingId('');
    setEditingName('');
  };

  const saveEdit = () => {
    const name = editingName.trim();
    if (!editingId || !isSymbolKey(name) || sessions.some((session) => session.id === name && session.id !== editingId) || readonly) return;
    onEditSession(editingId, { name, agentServerId: editingAgent });
    cancelEdit();
  };

  return (
    <div className="sessions-body settings">
      <div className="add-session-row">
        <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginRight: 4 }}>
          {t('settings.newAgentSession')}
        </span>
        <input
          ref={inputRef}
          className="input sm"
          placeholder={t('settings.sessionName')}
          value={draftName}
          disabled={readonly}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleAdd()}
          style={{ width: 180, height: 26 }}
        />
        <select className="input sm" value={draftAgent} disabled={readonly} onChange={(event) => setDraftAgent(event.target.value)} style={{ height: 26, width: 180 }}>
          {agentServers.map((server) => (
            <option key={server.id} value={server.id}>{server.id}</option>
          ))}
        </select>
        <button className="btn sm primary" disabled={readonly} onClick={handleAdd}><Icon name="plus" size={11} />{t('settings.add')}</button>
        {draftName && (!isSymbolKey(draftName.trim()) || sessions.some((session) => session.id === draftName.trim())) && (
          <span className="field-error">{t('settings.invalidSessionName')}</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{t('sessions.sessionsCount', { count: sessions.length })}</span>
      </div>

      <div className="session-list-row">
        <span className="label">{t('sessions.title')}</span>
        {sessions.map((session) => {
          if (editingId === session.id) {
            return (
              <span key={session.id} className="session-chip editing">
                <span className="ses-dot" style={{ background: sessionAccent(session) }} />
                <input
                  className="input sm"
                  value={editingName}
                  disabled={readonly}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveEdit();
                    if (event.key === 'Escape') cancelEdit();
                  }}
                  style={{ width: 130, height: 20 }}
                />
                <select
                  className="input sm"
                  value={editingAgent}
                  disabled={readonly}
                  onChange={(event) => setEditingAgent(event.target.value)}
                  style={{ width: 140, height: 20 }}
                >
                  {agentServers.map((server) => (
                    <option key={server.id} value={server.id}>{server.id}</option>
                  ))}
                </select>
                <button className="ses-x save" title={t('settings.saveSession', { name: session.name })} disabled={readonly || !isSymbolKey(editingName.trim()) || sessions.some((session) => session.id === editingName.trim() && session.id !== editingId)} onClick={saveEdit}>
                  <Icon name="check" size={10} />
                </button>
                <button className="ses-x" title={t('settings.cancelEdit')} onClick={cancelEdit}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            );
          }
          return (
            <span key={session.id} className="session-chip">
              <span className="ses-dot" style={{ background: sessionAccent(session) }} />
              {session.name}
              <span className="agent">{session.agentServerId ?? session.agent}</span>
              <button className="ses-x" title={t('settings.editSession', { name: session.name })} disabled={readonly} onClick={() => startEdit(session)}>
                <Icon name="edit" size={10} />
              </button>
              <button className="ses-x" title={t('settings.deleteSession', { name: session.name })} disabled={readonly || sessions.length <= 1} onClick={() => onDeleteSession(session.id)}>
                <Icon name="x" size={10} />
              </button>
            </span>
          );
        })}
      </div>

      <div className="assn-list">
        <div className="assn-list-head">
          <span>{t('settings.node')}</span>
          <span>{t('settings.sessionAssignment')}</span>
        </div>
        {(stepNodes.filter((node) => node.kind === 'step') as Extract<WorkflowNode, { kind: 'step' }>[]).map((stepNode) => (
          <div key={stepNode.id} className="assn-row">
            <div className="nbox">
              <span className="nid">{stepNode.alias}</span>
              <span className="nname">{stepNode.title}</span>
            </div>
            <div className="session-pick">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className={stepNode.sessionId === session.id ? 'active' : ''}
                  onClick={() => onAssignSession(stepNode.id, session.id)}
                >
                  <span className="ses-dot" style={{ background: sessionAccent(session) }} />{session.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function isNearLogBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
}
