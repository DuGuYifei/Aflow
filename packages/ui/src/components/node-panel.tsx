import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent } from 'react';
import type { WorkflowNode, Edge, Run, Session, RunState, GateNode, StepNode, InputNode, TimelineEvent, Variable } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';
import { branchAccent, edgeKey, isSymbolKey, sessionAccent } from '../appearance';
import { nodeDisplayTitle, nodeTitleFallback, nodeTitleIsFallback } from '../node-display';
import { SessionTimeline } from './session-timeline';
import {
  RichPromptInput,
  type RichPromptInputHandle,
  displayPromptVariableName,
  variableTokenDefinition,
} from './rich-prompt-input';
import {
  fetchAgentServerCapabilities,
  fetchSkills,
  refreshAgentServerCapabilities,
  type AgentServerCapabilities,
  type SkillSummary,
} from '../api';
import { useI18n } from '../i18n';

interface NodePanelProps {
  node: WorkflowNode & { runState?: RunState };
  run?: Run;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  variables: Variable[];
  workflowVersion: 1 | 2;
  viewMode: 'edit' | 'run';
  readonly?: boolean;
  identityReadonly?: boolean;
  editImpactLabel?: string;
  timelineEvents: TimelineEvent[];
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onRenameNode: (oldId: string, newId: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
  onAddEdge: (edge: Edge) => void;
  onDeleteEdge: (id: string) => void;
  onAddBranch: (gateId: string) => void;
  onEditBranch: (gateId: string, branchId: string, patch: { label?: string; description?: string; maxTraversals?: number }) => void;
  onDeleteBranch: (gateId: string, branchId: string) => void;
  onAddPath: (nodeId: string, path?: string) => void;
  onEditPath: (nodeId: string, index: number, value: string) => void;
  onDeletePath: (nodeId: string, index: number) => void;
  onUploadImages: (nodeId: string, files: File[]) => void;
  onDeleteImage: (nodeId: string, index: number) => void;
  onImportPaths: (nodeId: string, files: File[], directory: boolean) => void;
}

export function NodePanel(props: NodePanelProps) {
  const [tab, setTab] = useState('overview');
  const readonly = props.readonly ?? props.viewMode === 'run';
  if (props.node.kind === 'input') {
    return <InputPanelContent {...props} node={props.node} readonly={readonly} />;
  }
  if (props.node.kind === 'start') {
    return <StartPanelContent {...props} node={props.node} readonly={readonly} />;
  }
  if (props.node.kind === 'gate') {
    return <GatePanelContent {...props} node={props.node} readonly={readonly} />;
  }
  if (props.node.kind === 'end') {
    return <EndPanelContent node={props.node} run={props.run} nodes={props.nodes} readonly={readonly} identityReadonly={props.identityReadonly} editImpactLabel={props.editImpactLabel} onClose={props.onClose} onEditNode={props.onEditNode} onRenameNode={props.onRenameNode} />;
  }
  return <StepPanelContent {...props} node={props.node} readonly={readonly} tab={tab} setTab={setTab} />;
}

function PanelNodeTitle({ node }: { node: WorkflowNode }) {
  return <span className={nodeTitleIsFallback(node) ? 'panel-title-placeholder' : undefined}>{nodeDisplayTitle(node)}</span>;
}

function NodeRunStatusBadge({ status }: { status?: RunState }) {
  const { t } = useI18n();
  const state = status ?? 'pending';
  return (
    <div className={`run-status-badge ${state}`}>
      <span className={`status-dot ${state}`} />
      <span className="label">{t('node.status')}</span>
      <span className="value">{state}</span>
    </div>
  );
}

function EditImpactNote({ label }: { label?: string }) {
  if (!label) return null;
  return <div className="edit-impact-note">{label}</div>;
}

function NodeLockToggle({ node, readonly, onEditNode }: {
  node: WorkflowNode;
  readonly: boolean;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="section-title">{t('node.position')}</div>
      <label className="toggle-row node-lock-toggle">
        <input
          type="checkbox"
          checked={node.locked === true}
          disabled={readonly}
          onChange={(event) => onEditNode(node.id, { locked: event.target.checked || undefined })}
        />
        <span><Icon name="lock" size={11} /> {t('node.lockPosition')}</span>
      </label>
      <div className="code-hint">{t('node.lockPositionHint')}</div>
    </>
  );
}

function StepPanelContent(props: NodePanelProps & {
  node: StepNode & { runState?: RunState };
  readonly: boolean;
  tab: string;
  setTab: (tab: string) => void;
}) {
  const { t } = useI18n();
  const { node, run, sessions, timelineEvents, tab, setTab } = props;
  const session = sessions.find((candidate) => candidate.id === node.sessionId);
  const nodeLogEvents = timelineEvents.filter((event) => !('nodeId' in event) || !event.nodeId || event.nodeId === node.id);
  const tabs = run
    ? [{ key: 'overview', label: t('node.tabs.overview') }, { key: 'logs', label: t('node.tabs.logs'), count: nodeLogEvents.length || undefined }]
    : [{ key: 'overview', label: t('node.tabs.definition') }, { key: 'images', label: t('node.tabs.images'), count: node.images?.length || undefined }, { key: 'paths', label: t('node.tabs.paths'), count: node.paths?.length || undefined }];
  const label = (
    <>
      <Icon name="flow" size={11} /> {t('node.stepLabel', { alias: node.alias })}
      {session && <><span style={{ color: 'var(--ink-4)' }}>·</span><span className="ses-dot" style={{ background: sessionAccent(session) }} />{session.name}</>}
    </>
  );
  return (
    <RightPanel label={label} title={<PanelNodeTitle node={node} />} onClose={props.onClose} tabs={tabs} activeTab={tab} onTabChange={setTab}>
      <EditImpactNote label={props.editImpactLabel} />
      {tab === 'overview' && <StepOverview {...props} session={session} />}
      {tab === 'logs' && <NodeLogs events={nodeLogEvents} />}
      {tab === 'images' && <NodeImages {...props} />}
      {tab === 'paths' && <NodePaths {...props} />}
    </RightPanel>
  );
}

function StepOverview(props: NodePanelProps & {
  node: StepNode & { runState?: RunState };
  readonly: boolean;
  session?: Session;
}) {
  const { t } = useI18n();
  const { node, run, session, sessions, nodes, edges, readonly, variables, workflowVersion } = props;
  const promptRef = useRef<RichPromptInputHandle>(null);
  const { capabilities, refreshing, refresh } = useAgentCapabilities(session?.agentServerId);
  const skills = useSkills();
  const inputTokens = workflowVersion === 2
    ? variables.map((variable) => ({ token: variable.name, hint: variable.description || variable.title }))
    : edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => nodes.find((candidate) => candidate.id === edge.from))
      .filter((candidate): candidate is InputNode => candidate?.kind === 'input')
      .map((input) => ({ token: input.variableName, hint: input.description }));
  const outputTokens = edges
    .filter((edge) => edge.to === node.id && edge.transmit && edge.outputTag)
    .map((edge) => ({ token: `specflow_${edge.outputTag}`, hint: t('node.transferredOutputHint') }));
  const promptTokens = [...inputTokens, ...outputTokens];
  const promptTokenKey = promptTokens.map(({ token, hint }) => `${token}:${hint ?? ''}`).join('\n');
  const promptTokenDefinitions = useMemo(
    () => [variableTokenDefinition(promptTokens)],
    [promptTokenKey],
  );
  return (
    <>
      {run && <NodeRunStatusBadge status={node.runState} />}
      <NodeLockToggle node={node} readonly={readonly} onEditNode={props.onEditNode} />
      <NodeIdentityFields node={node} nodes={nodes} readonly={readonly} identityReadonly={props.identityReadonly} onEditNode={props.onEditNode} onRenameNode={props.onRenameNode} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
      <div className="section-title">{t('node.session')}</div>
      <div className="node-session-control">
        <select
          className="input node-session-select"
          value={node.sessionId ?? ''}
          disabled={readonly || sessions.length === 0}
          onChange={(event) => {
            if (event.target.value) props.onChangeSession(node.id, event.target.value);
          }}
        >
          {!node.sessionId && <option value="">{t('node.selectSession')}</option>}
          {sessions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.agentServerId ?? candidate.agent})</option>
          ))}
        </select>
        {!readonly && <button className="btn sm ghost" onClick={props.onAddSessionRequest}><Icon name="plus" size={11} />{t('node.add')}</button>}
      </div>
      <div className="section-title">{t('node.prompt')}</div>
      {!readonly && promptTokens.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {promptTokens.map(({ token, hint }) => (
            <button key={token} className="btn sm ghost" title={hint} onClick={() => promptRef.current?.insertSerialized(`<${token}>`)}>
              {displayPromptVariableName(token)}
            </button>
          ))}
        </div>
      )}
      <RichPromptInput
        ref={promptRef}
        rows={6}
        value={node.prompt}
        disabled={readonly}
        tokenDefinitions={promptTokenDefinitions}
        skills={skills}
        availableCommands={capabilities?.availableCommands}
        onChange={(next) => props.onEditNode(node.id, { prompt: next })}
      />
      <SlashCommandWarnings prompt={node.prompt} skills={skills} availableCommands={capabilities?.availableCommands} />
      <AcpControls
        readonly={readonly}
        capabilities={capabilities}
        refresh={refresh}
        refreshing={refreshing}
        modeId={node.modeId}
        configOptions={node.configOptions}
        allowMode
        onChangeMode={(modeId) => props.onEditNode(node.id, { modeId: modeId ?? undefined })}
        onChangeConfigOption={(configId, value) => {
          const next = { ...(node.configOptions ?? {}) };
          if (value === undefined) delete next[configId];
          else next[configId] = value;
          props.onEditNode(node.id, {
            configOptions: Object.keys(next).length > 0 ? next : undefined,
          });
        }}
      />
      <div className="section-title">{t('node.humanCheckpoint')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={node.pauseAfterRun === true}
          disabled={readonly}
          onChange={(event) => props.onEditNode(node.id, { pauseAfterRun: event.target.checked || undefined })}
        />
        {t('node.pauseAfter')}
      </label>
      <div className="code-hint">{t('node.pauseHint')}</div>
      <NodeImages {...props} compact />
      <NodePaths {...props} compact />
    </>
  );
}

function NodeImages(props: NodePanelProps & { node: StepNode; readonly: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) props.onUploadImages(props.node.id, files);
    event.target.value = '';
  };
  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (images.length) {
      event.preventDefault();
      props.onUploadImages(props.node.id, images);
    }
  };
  return (
    <div onPaste={onPaste}>
      {!props.compact && <div className="section-title">{t('node.images')}</div>}
      {props.compact && <div className="section-title">{t('node.images')}</div>}
      <div className="attach-row">
        {(props.node.images ?? []).map((image, index) => (
          <div key={image.path} className="attach-thumb">
            <span className="label">{image.label ?? image.path}</span>
            {!props.readonly && <button className="icon-btn" onClick={() => props.onDeleteImage(props.node.id, index)}><Icon name="trash" size={11} /></button>}
          </div>
        ))}
        {!props.readonly && <button className="attach-add" onClick={() => inputRef.current?.click()} title={t('node.chooseImageFiles')}><Icon name="plus" size={14} /></button>}
      </div>
      {!props.readonly && <div className="code-hint">{t('node.imagesHint')}</div>}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    </div>
  );
}

function NodePaths(props: NodePanelProps & { node: StepNode; readonly: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const onImport = (event: ChangeEvent<HTMLInputElement>, directory: boolean) => {
    props.onImportPaths(props.node.id, Array.from(event.target.files ?? []), directory);
    event.target.value = '';
  };
  return (
    <>
      <div className="section-title">{t('node.filesFolders')}</div>
      {(props.node.paths ?? []).map((path, index) => (
        <div key={`${path}-${index}`} className="path-row">
          <Icon name={path.endsWith('/') ? 'folder' : 'file'} size={13} />
          <input className="input" value={path} disabled={props.readonly} onChange={(event) => props.onEditPath(props.node.id, index, event.target.value)} />
          {!props.readonly && <button className="icon-btn" onClick={() => props.onDeletePath(props.node.id, index)}><Icon name="trash" size={12} /></button>}
        </div>
      ))}
      {!props.readonly && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button className="btn sm ghost" onClick={() => props.onAddPath(props.node.id, '')}><Icon name="plus" size={12} />{t('node.typePath')}</button>
          <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>{t('node.chooseFile')}</button>
          <button className="btn sm ghost" onClick={() => folderRef.current?.click()}>{t('node.chooseFolder')}</button>
        </div>
      )}
      {!props.readonly && <div className="code-hint">{t('node.pathsHint')}</div>}
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => onImport(event, false)} />
      <input ref={folderRef} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => onImport(event, true)} />
    </>
  );
}

function GatePanelContent(props: NodePanelProps & { node: GateNode & { runState?: RunState }; readonly: boolean }) {
  const { t } = useI18n();
  const { node, run, nodes, edges, readonly, variables, workflowVersion } = props;
  const criteriaRef = useRef<RichPromptInputHandle>(null);
  const predecessorEdge = edges.find((edge) => {
    const sourceKind = nodes.find((candidate) => candidate.id === edge.from)?.kind;
    return edge.to === node.id && sourceKind !== 'input' && sourceKind !== 'start';
  });
  const predecessor = nodes.find((candidate) => candidate.id === predecessorEdge?.from);
  const predecessorSession = predecessor?.kind === 'step'
    ? props.sessions.find((session) => session.id === predecessor.sessionId)
    : undefined;
  const supportsForkHint = predecessorSession?.agentServerId.toLowerCase().includes('claude');
  const { capabilities, refreshing, refresh } = useAgentCapabilities(predecessorSession?.agentServerId);
  const skills = useSkills();
  const criteriaTokenDefinitions = useMemo(
    () => [variableTokenDefinition(variables.map((variable) => ({ token: variable.name, hint: variable.description || variable.title })))],
    [variables],
  );
  return (
    <RightPanel label={<><Icon name="route" size={11} /> {t('node.gateLabel', { alias: node.alias })}</>} title={<PanelNodeTitle node={node} />} onClose={props.onClose}>
      <EditImpactNote label={props.editImpactLabel} />
      {run && <NodeRunStatusBadge status={node.runState} />}
      <div className="code-hint">
        {t('node.gateHint')}
        {predecessorSession && (supportsForkHint
          ? t('node.gateForkClaudeHint')
          : t('node.gateForkRuntimeHint'))}
      </div>
      <NodeLockToggle node={node} readonly={readonly} onEditNode={props.onEditNode} />
      <NodeIdentityFields node={node} nodes={nodes} readonly={readonly} identityReadonly={props.identityReadonly} onEditNode={props.onEditNode} onRenameNode={props.onRenameNode} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
      <div className="section-title">{t('node.decisionCriteria')}</div>
      {!readonly && workflowVersion === 2 && variables.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {variables.map((variable) => (
            <button
              key={variable.name}
              className="btn sm ghost"
              title={variable.description || variable.title}
              onClick={() => criteriaRef.current?.insertSerialized(`<${variable.name}>`)}
            >
              {displayPromptVariableName(variable.name)}
            </button>
          ))}
        </div>
      )}
      <RichPromptInput
        ref={criteriaRef}
        rows={6}
        value={node.decisionCriteria}
        disabled={readonly}
        tokenDefinitions={criteriaTokenDefinitions}
        skills={skills}
        availableCommands={capabilities?.availableCommands}
        onChange={(next) => props.onEditNode(node.id, { decisionCriteria: next })}
      />
      <SlashCommandWarnings prompt={node.decisionCriteria} skills={skills} availableCommands={capabilities?.availableCommands} />
      <AcpControls
        readonly={readonly}
        capabilities={capabilities}
        refresh={refresh}
        refreshing={refreshing}
        configOptions={node.configOptions}
        allowMode={false}
        onChangeConfigOption={(configId, value) => {
          const next = { ...(node.configOptions ?? {}) };
          if (value === undefined) delete next[configId];
          else next[configId] = value;
          props.onEditNode(node.id, {
            configOptions: Object.keys(next).length > 0 ? next : undefined,
          });
        }}
      />
      <div className="section-title">{t('node.humanCheckpoint')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={node.pauseAfterRun === true}
          disabled={readonly}
          onChange={(event) => props.onEditNode(node.id, { pauseAfterRun: event.target.checked || undefined })}
        />
        {t('node.pauseAfter')}
      </label>
      <div className="code-hint">{t('node.inputEdgesHint')}</div>
      <div className="section-title">{t('node.branches')}</div>
      {node.branches.map((branch) => (
        <div key={branch.id} className="output-card" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: branchAccent(branch) }} />
            <input className="input" value={branch.label} disabled={readonly} onChange={(event) => props.onEditBranch(node.id, branch.id, { label: event.target.value })} />
            {!readonly && <button className="icon-btn" disabled={node.branches.length <= 1} title={node.branches.length <= 1 ? t('node.deleteBranchRequired') : t('node.deleteBranch')} onClick={() => props.onDeleteBranch(node.id, branch.id)}><Icon name="trash" size={12} /></button>}
          </div>
          <input className="input" value={branch.description ?? ''} disabled={readonly} placeholder={t('node.branchDescriptionPlaceholder')} onChange={(event) => props.onEditBranch(node.id, branch.id, { description: event.target.value || undefined })} />
          {workflowVersion === 2 && (
            <div className="branch-max-row">
              <label>{t('node.branchMaxTraversals')}</label>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                value={branch.maxTraversals ?? ''}
                disabled={readonly}
                placeholder="∞"
                onChange={(event) => {
                  const rawValue = event.target.value;
                  const maxTraversals = rawValue
                    ? Math.max(1, Number.parseInt(rawValue, 10) || 1)
                    : undefined;
                  props.onEditBranch(node.id, branch.id, { maxTraversals });
                }}
              />
            </div>
          )}
        </div>
      ))}
      {!readonly && <button className="btn sm ghost" onClick={() => props.onAddBranch(node.id)}><Icon name="plus" size={12} />{t('node.addBranch')}</button>}
    </RightPanel>
  );
}

function StartPanelContent(props: NodePanelProps & { node: Extract<WorkflowNode, { kind: 'start' }> & { runState?: RunState }; readonly: boolean }) {
  const { t } = useI18n();
  const { node, run, nodes, readonly } = props;
  return (
    <RightPanel label={<><Icon name="play-circle" size={11} />{t('node.start')}</>} title={<PanelNodeTitle node={node} />} onClose={props.onClose}>
      <EditImpactNote label={props.editImpactLabel} />
      {run && <NodeRunStatusBadge status={node.runState} />}
      <div className="code-hint">{t('node.startHint')}</div>
      <NodeLockToggle node={node} readonly={readonly} onEditNode={props.onEditNode} />
      <NodeIdentityFields node={node} nodes={nodes} readonly={readonly} identityReadonly={props.identityReadonly} onEditNode={props.onEditNode} onRenameNode={props.onRenameNode} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
    </RightPanel>
  );
}

function InputPanelContent(props: NodePanelProps & { node: InputNode & { runState?: RunState }; readonly: boolean }) {
  const { t } = useI18n();
  const { node, run, readonly, nodes, edges } = props;
  const rawName = node.variableName.startsWith('specflow_') ? node.variableName.slice(9) : node.variableName;
  const stepNodes = nodes.filter((candidate): candidate is StepNode => candidate.kind === 'step');
  return (
    <RightPanel label={<><Icon name="tag" size={11} />{t('node.runInputLabel', { alias: node.alias })}</>} title={<PanelNodeTitle node={node} />} onClose={props.onClose}>
      <EditImpactNote label={props.editImpactLabel} />
      {run && <NodeRunStatusBadge status={node.runState} />}
      <NodeLockToggle node={node} readonly={readonly} onEditNode={props.onEditNode} />
      <NodeIdentityFields node={node} nodes={nodes} readonly={readonly} identityReadonly={props.identityReadonly} onEditNode={props.onEditNode} onRenameNode={props.onRenameNode} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
      <div className="section-title">{t('node.variableName')}</div>
      <input className="input" value={rawName} disabled={readonly} onChange={(event) => {
        const value = event.target.value.replace(/[^A-Za-z0-9_]/g, '');
        if (value) props.onEditNode(node.id, { variableName: `specflow_${value}` });
      }} />
      <div className="section-title">{t('node.inputRequired')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={node.required !== false}
          disabled={readonly}
          onChange={(event) => props.onEditNode(node.id, { required: event.target.checked ? undefined : false })}
        />
        {t('common.required')}
      </label>
      <div className="code-hint">{t('node.inputOptionalHint')}</div>
      <div className="section-title">{t('node.defaultValue')}</div>
      <input className="input" value={node.defaultValue ?? ''} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { defaultValue: event.target.value || undefined })} />
      <div className="section-title">{t('node.description')}</div>
      <input className="input" value={node.description ?? ''} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { description: event.target.value || undefined })} />
      <div className="section-title">{t('node.inputTargets')}</div>
      <div className="input-target-list">
        {stepNodes.length === 0 && <div className="code-hint">{t('node.noStepTargets')}</div>}
        {stepNodes.map((step) => {
          const existingEdge = edges.find((edge) => edge.from === node.id && edge.to === step.id);
          return (
            <label key={step.id} className="toggle-row input-target-row">
              <input
                type="checkbox"
                checked={Boolean(existingEdge)}
                disabled={readonly}
                onChange={(event) => {
                  if (event.target.checked) {
                    props.onAddEdge({ id: edgeKey({ from: node.id, to: step.id }), from: node.id, to: step.id });
                  } else if (existingEdge) {
                    props.onDeleteEdge(existingEdge.id);
                  }
                }}
              />
              <span className="node-ref">{step.alias}</span>
              <span>{nodeDisplayTitle(step)}</span>
            </label>
          );
        })}
      </div>
    </RightPanel>
  );
}

function EndPanelContent({ node, run, nodes, readonly, identityReadonly, editImpactLabel, onClose, onEditNode, onRenameNode }: { node: Extract<WorkflowNode, { kind: 'end' }> & { runState?: RunState }; run?: Run; nodes: WorkflowNode[]; readonly: boolean; identityReadonly?: boolean; editImpactLabel?: string; onClose: () => void; onEditNode: (id: string, patch: Record<string, unknown>) => void; onRenameNode: (oldId: string, newId: string) => void }) {
  const { t } = useI18n();
  return (
    <RightPanel label={<><Icon name="check" size={11} />{t('node.end')}</>} title={<PanelNodeTitle node={node} />} onClose={onClose}>
      <EditImpactNote label={editImpactLabel} />
      {run && <NodeRunStatusBadge status={node.runState} />}
      <div className="code-hint">{t('node.endHint')}</div>
      <NodeLockToggle node={node} readonly={readonly} onEditNode={onEditNode} />
      <NodeIdentityFields node={node} nodes={nodes} readonly={readonly} identityReadonly={identityReadonly} onEditNode={onEditNode} onRenameNode={onRenameNode} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => onEditNode(node.id, { alias: event.target.value })} />
    </RightPanel>
  );
}

function NodeIdentityFields({
  node,
  nodes,
  readonly,
  identityReadonly,
  onEditNode,
  onRenameNode,
}: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  readonly: boolean;
  identityReadonly?: boolean;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onRenameNode: (oldId: string, newId: string) => void;
}) {
  const { t } = useI18n();
  const [draftId, setDraftId] = useState(node.id);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraftId(node.id);
    setError('');
  }, [node.id]);
  const commit = (value = draftId) => {
    const nextId = value.trim();
    if (nextId === node.id) {
      setDraftId(node.id);
      setError('');
      return;
    }
    if (!isSymbolKey(nextId)) {
      setError(t('node.keyInvalid'));
      return;
    }
    if (nodes.some((candidate) => candidate.id === nextId && candidate.id !== node.id)) {
      setError(t('node.keyDuplicate'));
      return;
    }
    setError('');
    onRenameNode(node.id, nextId);
  };
  const updateTitle = (value: string) => onEditNode(node.id, { title: value });
  return (
    <>
      <div className="section-title">{t('node.key')}</div>
      <input
        className={`input${error ? ' invalid' : ''}`}
        value={draftId}
        disabled={identityReadonly ?? readonly}
        onChange={(event) => {
          setDraftId(event.target.value);
          if (error) setError('');
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            setDraftId(node.id);
            setError('');
            event.currentTarget.blur();
          }
        }}
      />
      {error && <div className="field-error">{error}</div>}
      <div className="section-title">{t('node.titleOptional')}</div>
      <input
        className="input"
        value={node.title}
        disabled={readonly}
        placeholder={nodeTitleFallback(node.id)}
        onInput={(event) => updateTitle(event.currentTarget.value)}
        onChange={(event) => updateTitle(event.currentTarget.value)}
      />
    </>
  );
}

function NodeLogs({ events }: { events: TimelineEvent[] }) {
  return <div className="log-block"><SessionTimeline events={events} /></div>;
}

// ── ACP capability-driven controls (mode / model / effort / other) ────────────

function useAgentCapabilities(agentServerId: string | undefined): {
  capabilities: AgentServerCapabilities | undefined;
  refreshing: boolean;
  refresh: () => Promise<void>;
} {
  const [capabilities, setCapabilities] = useState<AgentServerCapabilities | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!agentServerId) {
      setCapabilities(undefined);
      return () => { cancelled = true; };
    }
    fetchAgentServerCapabilities(agentServerId)
      .then((value) => { if (!cancelled) setCapabilities(value); })
      .catch(() => { if (!cancelled) setCapabilities(undefined); });
    return () => { cancelled = true; };
  }, [agentServerId]);
  const refresh = async () => {
    if (!agentServerId) return;
    setRefreshing(true);
    try {
      const next = await refreshAgentServerCapabilities(agentServerId);
      setCapabilities(next);
    } finally {
      setRefreshing(false);
    }
  };
  return { capabilities, refreshing, refresh };
}

function useSkills(): SkillSummary[] {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchSkills()
      .then((value) => { if (!cancelled) setSkills(value); })
      .catch(() => { if (!cancelled) setSkills([]); });
    return () => { cancelled = true; };
  }, []);
  return skills;
}

interface AcpControlsProps {
  readonly: boolean;
  capabilities: AgentServerCapabilities | undefined;
  refresh: () => Promise<void>;
  refreshing: boolean;
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
  allowMode: boolean;
  onChangeMode?: (modeId: string | undefined) => void;
  onChangeConfigOption: (configId: string, value: string | boolean | undefined) => void;
}

function AcpControls(props: AcpControlsProps) {
  const { t } = useI18n();
  const { capabilities, configOptions, readonly } = props;
  const modes = capabilities?.modes?.availableModes ?? [];
  const options = capabilities?.configOptions ?? [];
  const duplicateModeOption = findDuplicateModeOption(modes, options);
  const hasMode = props.allowMode && modes.length > 0;
  const visibleOptions = duplicateModeOption
    ? options.filter((option) => option !== duplicateModeOption)
    : options;
  const hasConfig = visibleOptions.length > 0;
  if (!capabilities) {
    return (
      <div className="output-card" style={{ marginTop: 6 }}>
        <div className="code-hint">
          {t('node.acpProbeHint')}
        </div>
        <button className="btn sm ghost" disabled={props.refreshing} onClick={() => void props.refresh()}>
          {props.refreshing ? t('node.probing') : t('node.probeCapabilities')}
        </button>
      </div>
    );
  }
  if (!hasMode && !hasConfig) {
    // Cached, but agent didn't advertise any per-session knobs — leave the
    // section hidden so simple agents stay clutter-free.
    return null;
  }
  // configOptions sorted: model → thought_level → mode → other → unknown
  const categoryOrder: Record<string, number> = { model: 0, thought_level: 1, mode: 2, other: 3 };
  const sortedOptions = [...visibleOptions].sort((leftOption, rightOption) => {
    const leftCategoryOrder = leftOption.category ? categoryOrder[leftOption.category] ?? 9 : 9;
    const rightCategoryOrder = rightOption.category ? categoryOrder[rightOption.category] ?? 9 : 9;
    return leftCategoryOrder - rightCategoryOrder;
  });
  return (
    <>
      <div className="section-title">{t('node.acpOverrides')}</div>
      {hasMode && (
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>
            {duplicateModeOption?.name || t('node.mode')}
          </label>
          <select
            className="input"
            value={props.modeId ?? ''}
            disabled={readonly}
            onChange={(event) => props.onChangeMode?.(event.target.value || undefined)}
          >
            <option value="">{t('node.inheritSessionMode')}</option>
            {modes.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.name || mode.id}</option>
            ))}
          </select>
          {duplicateModeOption?.description && <div className="code-hint">{duplicateModeOption.description}</div>}
        </div>
      )}
      {sortedOptions.map((option) => (
        <ConfigOptionControl
          key={option.id}
          option={option}
          value={configOptions?.[option.id]}
          readonly={readonly}
          onChange={(value) => props.onChangeConfigOption(option.id, value)}
        />
      ))}
      <div className="code-hint">
        {t('node.acpOverridesHint')}
        <button className="btn sm ghost" style={{ marginLeft: 6 }} disabled={props.refreshing} onClick={() => void props.refresh()}>
          {props.refreshing ? t('node.refreshing') : t('node.refresh')}
        </button>
      </div>
    </>
  );
}

type ConfigOption = NonNullable<AgentServerCapabilities['configOptions']>[number];

function findDuplicateModeOption(
  modes: Array<{ id: string }>,
  options: ConfigOption[],
): ConfigOption | undefined {
  if (modes.length === 0) return undefined;
  const modeIds = new Set(modes.map((mode) => mode.id));
  for (const option of options) {
    if (option.type !== 'select') continue;
    if (option.id !== 'mode' && option.category !== 'mode') continue;
    const values = selectOptionValues(option);
    if (values.size !== modeIds.size) continue;
    if ([...modeIds].every((id) => values.has(id))) return option;
  }
  return undefined;
}

function selectOptionValues(option: ConfigOption): Set<string> {
  const values = new Set<string>();
  if (!Array.isArray(option.options)) return values;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      for (const child of entry.options) values.add(child.value);
    } else if ('value' in entry) {
      values.add(entry.value);
    }
  }
  return values;
}

function ConfigOptionControl(props: {
  option: ConfigOption;
  value: string | boolean | undefined;
  readonly: boolean;
  onChange: (value: string | boolean | undefined) => void;
}) {
  const { t } = useI18n();
  const { option } = props;
  if (option.type === 'boolean') {
    const checked = typeof props.value === 'boolean' ? props.value : option.currentValue === true;
    return (
      <div style={{ marginBottom: 6 }}>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={checked}
            disabled={props.readonly}
            onChange={(event) => props.onChange(event.target.checked)}
          />
          {option.name || option.id}
        </label>
        {option.description && <div className="code-hint">{option.description}</div>}
      </div>
    );
  }
  const value = typeof props.value === 'string' ? props.value : '';
  // Options may be flat or grouped; flatten for the dropdown but show group as optgroup.
  const groups: Array<{ name: string; options: Array<{ value: string; name: string }> }> = [];
  if (Array.isArray(option.options)) {
    for (const entry of option.options) {
      if ('group' in entry && Array.isArray(entry.options)) {
        groups.push({ name: entry.name || entry.group, options: entry.options });
      } else if ('value' in entry) {
        if (!groups.length || groups[groups.length - 1].name !== '__flat__') {
          groups.push({ name: '__flat__', options: [] });
        }
        groups[groups.length - 1].options.push(entry);
      }
    }
  }
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>
        {option.name || option.id}
        {option.category && option.category !== 'other' && <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>· {option.category}</span>}
      </label>
      <select
        className="input"
        value={value}
        disabled={props.readonly}
        onChange={(event) => props.onChange(event.target.value || undefined)}
      >
        <option value="">{t('node.inheritAgentDefault')}</option>
        {groups.map((group) => group.name === '__flat__'
          ? group.options.map((option) => <option key={option.value} value={option.value}>{option.name || option.value}</option>)
          : (
            <optgroup key={group.name} label={group.name}>
              {group.options.map((option) => <option key={option.value} value={option.value}>{option.name || option.value}</option>)}
            </optgroup>
          ))}
      </select>
      {option.description && <div className="code-hint">{option.description}</div>}
    </div>
  );
}

// ── Slash command warning underneath a prompt ───────────────────────────────

function SlashCommandWarnings(props: {
  prompt: string;
  skills: SkillSummary[];
  availableCommands: AgentServerCapabilities['availableCommands'] | undefined;
}) {
  const { t } = useI18n();
  const { prompt, skills, availableCommands } = props;
  // Lightweight client-side parse: line-leading `/` followed by [a-z0-9_:.-]+.
  // Mirrors the server's slash-parser logic well enough to surface warnings.
  const slashTokens = parseSlashTokens(prompt);
  if (slashTokens.length === 0) return null;
  const knownSkill = new Set(skills.map((skill) => skill.name));
  const knownCommand = new Set((availableCommands ?? []).flatMap((command) => command.name.startsWith('$')
    ? [command.name, command.name.slice(1)]
    : [command.name]
  ));
  const issues = slashTokens.filter((token) => !isResolvable(token, knownSkill, knownCommand));
  if (issues.length === 0) return null;
  return (
    <div className="code-hint" style={{ color: 'var(--accent-red, #d33)' }}>
      {t('node.slashWarning', { commands: issues.map((token) => `"/${token.display}"`).join(', ') })}
    </div>
  );
}

interface SlashToken { display: string; bare: string; scope?: string }

function parseSlashTokens(text: string): SlashToken[] {
  const output: SlashToken[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.trimStart().match(/^\/([A-Za-z0-9_:.-]+)/);
    if (!match) continue;
    const rawValue = match[1];
    if (rawValue.includes('.')) {
      // MCP-style: server.prompt — skip in this warning (already unsupported).
      continue;
    }
    if (rawValue.includes(':')) {
      const lastColon = rawValue.lastIndexOf(':');
      output.push({ display: rawValue, scope: rawValue.slice(0, lastColon), bare: rawValue.slice(lastColon + 1) });
    } else {
      output.push({ display: rawValue, bare: rawValue });
    }
  }
  return output;
}

function isResolvable(token: SlashToken, skills: Set<string>, commands: Set<string>): boolean {
  if (skills.has(token.bare)) return true;
  if (!token.scope && commands.has(token.bare)) return true;
  return false;
}
