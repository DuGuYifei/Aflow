import { useState, useRef, useEffect } from 'react';
import type { Workflow, Run } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './icon';

interface SidebarProps {
  workflows: Workflow[];
  runs: Run[];
  activeWorkflow: string;
  activeRun: string;
  onSelectWorkflow: (id: string) => void;
  onSelectRun: (id: string) => void;
  onNewRun: () => void;
  onRerunRun: (id: string) => void;
  onResumeRun?: (id: string) => void;
  onDeleteRun: (id: string) => void;
  onCreateWorkflow: (name: string) => void;
  onRenameWorkflow: (id: string, name: string) => void;
}

export function Sidebar({ workflows, runs, activeWorkflow, activeRun, onSelectWorkflow, onSelectRun, onNewRun, onRerunRun, onResumeRun, onDeleteRun, onCreateWorkflow, onRenameWorkflow }: SidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState(t('app.untitledWorkflow'));
  const [editingWorkflowId, setEditingWorkflowId] = useState('');
  const [editingWorkflowName, setEditingWorkflowName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const wf = workflows.find((w) => w.id === activeWorkflow) || workflows[0];
  const runLabelById = new Map(runs.map((run) => [run.id, run.label]));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ⌘K / Ctrl+K focuses search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur(); }
  };

  const filteredWorkflows = query.trim()
    ? workflows.filter((w) => w.name.toLowerCase().includes(query.toLowerCase()))
    : workflows;
  const submitCreateWorkflow = () => {
    const name = (createInputRef.current?.value ?? newWorkflowName).trim();
    if (!name) return;
    onCreateWorkflow(name);
    setCreateOpen(false);
    setNewWorkflowName(t('app.untitledWorkflow'));
  };
  const startRenameWorkflow = (workflow: Workflow) => {
    setEditingWorkflowId(workflow.id);
    setEditingWorkflowName(workflow.name);
  };
  const cancelRenameWorkflow = () => {
    setEditingWorkflowId('');
    setEditingWorkflowName('');
  };
  const submitRenameWorkflow = (value = editingWorkflowName) => {
    const name = value.trim();
    if (!editingWorkflowId || !name) return;
    onRenameWorkflow(editingWorkflowId, name);
    cancelRenameWorkflow();
  };

  return (
    <div className="left two-col">
      <div className="col">
        <div className="col-head">
          <div>
            <div className="col-title">{t('sidebar.workflows')}</div>
          </div>
          <button className="btn sm icon" title={t('sidebar.newWorkflow')} onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        {createOpen && (
          <div className="workflow-create">
            <input
              ref={createInputRef}
              className="input sm"
              value={newWorkflowName}
              autoFocus
              onChange={(event) => setNewWorkflowName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitCreateWorkflow();
                if (event.key === 'Escape') setCreateOpen(false);
              }}
            />
            <button className="btn sm primary" disabled={!newWorkflowName.trim()} onClick={submitCreateWorkflow}>{t('sidebar.createWorkflow')}</button>
            <button className="btn sm" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</button>
          </div>
        )}
        <div className="search">
          <Icon name="search" size={12} />
          <input
            ref={searchRef}
            placeholder={t('sidebar.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="kbd">⌘K</span>
        </div>
        <div className="col-list">
          {filteredWorkflows.map((w) => (
            <div
              key={w.id}
              className={`wf-card${w.id === activeWorkflow ? ' active' : ''}`}
              onClick={() => onSelectWorkflow(w.id)}
            >
              <div className="wf-row">
                {editingWorkflowId === w.id ? (
                  <input
                    className="input sm workflow-name-input"
                    value={editingWorkflowName}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setEditingWorkflowName(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) => submitRenameWorkflow(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitRenameWorkflow(event.currentTarget.value);
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelRenameWorkflow();
                      }
                    }}
                  />
                ) : (
                  <div className="name">{w.name}</div>
                )}
                <button
                  className="btn sm icon workflow-rename"
                  title={t('sidebar.renameWorkflow')}
                  onClick={(event) => {
                    event.stopPropagation();
                    startRenameWorkflow(w);
                  }}
                >
                  <Icon name="edit" size={10} />
                </button>
              </div>
              <div className="meta">
                <span><Icon name="flow" size={10} style={{ verticalAlign: -1 }} /> {w.meta}</span>
                <span><Icon name="history" size={10} style={{ verticalAlign: -1 }} /> {t('sidebar.runsCount', { count: w.runs })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="col">
        <div className="col-head">
          <div>
            <div className="col-title">{t('sidebar.runs')}</div>
            <div className="col-sub">{wf?.name}</div>
          </div>
          <button className="btn sm primary" title={t('sidebar.startRunTitle')} onClick={onNewRun}>
            <Icon name="play-circle" size={12} />{t('sidebar.start')}
          </button>
        </div>
        <div className="col-list">
          {runs.map((r) => (
            <div
              key={r.id}
              className={`run-card${r.id === activeRun ? ' active' : ''}`}
              onClick={() => onSelectRun(r.id)}
            >
              <div className="row">
                <span className={`status-dot ${r.status}`} />
                <span className="label">{r.label}</span>
                <div className="actions" onClick={(e) => e.stopPropagation()}>
                  {onResumeRun && !r.resumedByRunId && (r.status === 'cancelled' || r.status === 'error') && (
                    <button className="btn sm icon" title={t('sidebar.resumeSessionTitle')} onClick={() => onResumeRun(r.id)}>
                      <Icon name="play-circle" size={11} />
                    </button>
                  )}
                  <button className="btn sm icon" title={t('sidebar.rerunTitle')} onClick={() => onRerunRun(r.id)}>
                    <Icon name="rotate" size={11} />
                  </button>
                  <button className="btn sm icon" title={t('sidebar.delete')} onClick={() => onDeleteRun(r.id)}>
                    <Icon name="trash" size={11} />
                  </button>
                </div>
              </div>
              <div className="ticket">{r.ticket}</div>
              {r.resumedFromRunId && (
                <button className="run-link" onClick={(event) => { event.stopPropagation(); onSelectRun(r.resumedFromRunId!); }}>
                  Resumed from {runLabelById.get(r.resumedFromRunId) ?? r.resumedFromRunId}
                </button>
              )}
              {r.resumedByRunId && (
                <button className="run-link" onClick={(event) => { event.stopPropagation(); onSelectRun(r.resumedByRunId!); }}>
                  Continued as {runLabelById.get(r.resumedByRunId) ?? r.resumedByRunId}
                </button>
              )}
              <div className="meta-row">
                <span>{r.time}</span>
                <span>·</span>
                <span>{r.duration}</span>
                <span style={{ marginLeft: 'auto' }} className="agent-badge">
                  <span className="dot" />{r.agent}
                </span>
              </div>
              {r.errorMsg && (
                <div style={{ color: 'var(--err)', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {r.errorMsg}
                </div>
              )}
              {r.status === 'running' && r.progress && (
                <div style={{ color: 'var(--running)', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {r.progress}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
