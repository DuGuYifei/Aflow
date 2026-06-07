import { useEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  fetchAgentServerCapabilities,
  fetchAgentServers,
  fetchSkills,
  refreshAgentServerCapabilities,
  type AgentServerCapabilities,
  type AgentServerEntry,
  type SkillSummary,
} from '../api';
import { AgentServerManager } from '../components/agent-server-manager';
import { Icon } from '../components/icon';
import {
  RichPromptInput,
  type RichPromptInputHandle,
  designCommentTokenDefinition,
  designComponentTokenDefinition,
} from '../components/rich-prompt-input';
import { useI18n } from '../i18n';
import type { Theme } from '../types';
import {
  DesignApiError,
  branchDesignProjectVersion,
  createDesignProject,
  fetchDesignProjectVersion,
  fetchDesignSession,
  fetchDesignSessions,
  fetchDesignProject,
  fetchDesignProjectFileText,
  fetchDesignProjects,
  fetchDesignReferences,
  importDesignReference,
  recordDesignProjectVersion,
  streamInitializeDesignSession,
  streamDesignMessage,
  uploadDesignImages,
} from './api';
import { DesignCanvas } from './design-canvas';
import { reconcileDesignConfigOptions } from './design-config';
import { DesignAcpControls, DesignSlashWarnings } from './design-controls';
import type {
  DesignArtifact,
  DesignChatMessage,
  DesignComponentNode,
  DesignLogEntry,
  DesignMessageAttachment,
  DesignProjectSummary,
  DesignReferenceSummary,
  DesignSession,
  DesignSessionSummary,
  DesignVersionCommit,
  DesignVersionState,
} from './types';

type ImportMode = 'git' | 'copy';
type DesignArtifactTab = 'html' | 'wireframe';
type DesignRightPanelMode = 'properties' | 'description' | 'tree';
type DesignInspectorTab = 'properties' | 'hierarchy';
type DesignInitializingStep = 'idle' | 'connecting' | 'negotiating' | 'ready';
type VersionCommitIntent =
  | { type: 'record' }
  | { type: 'branch-after-record'; commitHash: string; branchName?: string };
type VersionBranchTarget = {
  commitHash: string;
  branchName?: string;
};
type DesignThreadItem =
  | { type: 'message'; message: DesignChatMessage }
  | { type: 'activity'; entry: DesignLogEntry; active: boolean };
type DesignToast = {
  id: number;
  type: 'success' | 'error';
  title: string;
  message: string;
};

const DESIGN_CHAT_WIDTH_KEY = 'sf-design-chat-width';
const DESIGN_CHAT_MIN_WIDTH = 300;
const DESIGN_CHAT_MAX_WIDTH = 620;
const DESIGN_CHAT_DEFAULT_WIDTH = 390;
const DESIGN_CHAT_COMPACT_WIDTH = 380;

export function DesignApp() {
  const { language, setLanguage, t } = useI18n();
  const [projects, setProjects] = useState<DesignProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<DesignProjectSummary | undefined>();
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projectArtifact, setProjectArtifact] = useState<DesignArtifact | undefined>();
  const [references, setReferences] = useState<DesignReferenceSummary[]>([]);
  const [sessions, setSessions] = useState<DesignSessionSummary[]>([]);
  const [agentServers, setAgentServers] = useState<AgentServerEntry[]>([]);
  const [capabilities, setCapabilities] = useState<AgentServerCapabilities | undefined>();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceImportOpen, setReferenceImportOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState('');
  const [referenceInterfaceDescription, setReferenceInterfaceDescription] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('git');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [branch, setBranch] = useState('');
  const [agentServerId, setAgentServerId] = useState('');
  const [modeId, setModeId] = useState('');
  const [configOptions, setConfigOptions] = useState<Record<string, string | boolean>>({});
  const [startAgentServerId, setStartAgentServerId] = useState('');
  const [startCapabilities, setStartCapabilities] = useState<AgentServerCapabilities | undefined>();
  const [startModeId, setStartModeId] = useState('');
  const [startConfigOptions, setStartConfigOptions] = useState<Record<string, string | boolean>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatAttachments, setChatAttachments] = useState<DesignMessageAttachment[]>([]);
  const [componentCommentOpen, setComponentCommentOpen] = useState(false);
  const [componentComment, setComponentComment] = useState('');
  const [componentStyleDrafts, setComponentStyleDrafts] = useState<Record<string, Record<string, string>>>({});
  const [session, setSession] = useState<DesignSession | undefined>();
  const [liveLogs, setLiveLogs] = useState<DesignLogEntry[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<DesignChatMessage | undefined>();
  const [activeTab, setActiveTab] = useState<DesignArtifactTab>('html');
  const [selectedComponentId, setSelectedComponentId] = useState('');
  const [inlineSelectedComponent, setInlineSelectedComponent] = useState<DesignComponentNode | undefined>();
  const [inlineHierarchyPath, setInlineHierarchyPath] = useState<DesignComponentNode[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<DesignToast | undefined>();
  const [theme, setTheme] = useState<Theme>('light');
  const [agentServerManagerOpen, setAgentServerManagerOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState(true);
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const [initializingStep, setInitializingStep] = useState<DesignInitializingStep>('idle');
  const [rightPanelMode, setRightPanelMode] = useState<DesignRightPanelMode>('properties');
  const [inspectorTab, setInspectorTab] = useState<DesignInspectorTab>('properties');
  const [panelFrameId, setPanelFrameId] = useState('');
  const [descriptionText, setDescriptionText] = useState('');
  const [descriptionBusy, setDescriptionBusy] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionState, setVersionState] = useState<DesignVersionState | undefined>();
  const [selectedVersionHash, setSelectedVersionHash] = useState('');
  const [versionCommitOpen, setVersionCommitOpen] = useState(false);
  const [versionAuthorName, setVersionAuthorName] = useState('');
  const [versionAuthorEmail, setVersionAuthorEmail] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [versionBranchTarget, setVersionBranchTarget] = useState<VersionBranchTarget | undefined>();
  const [versionCommitIntent, setVersionCommitIntent] = useState<VersionCommitIntent>({ type: 'record' });
  const [versionPanelError, setVersionPanelError] = useState('');
  const [chatPanelWidth, setChatPanelWidth] = useState(readChatPanelWidth);
  const chatInputRef = useRef<RichPromptInputHandle>(null);
  const messageAbortRef = useRef<AbortController | null>(null);
  const artifact = session?.latestArtifact ?? projectArtifact;
  const chatPanelCompact = chatPanelWidth <= DESIGN_CHAT_COMPACT_WIDTH;
  const liveConfigSeedRef = useRef<{
    agentServerId: string;
    capabilities: AgentServerCapabilities | undefined;
    modeId: string;
    configOptions: Record<string, string | boolean>;
  } | null>(null);

  const selectedSummary = useMemo(
    () => references.find((reference) => reference.name === selectedReference),
    [references, selectedReference],
  );
  const designPromptTokenDefinitions = useMemo(
    () => [designComponentTokenDefinition(), designCommentTokenDefinition()],
    [],
  );
  const treeSelectedComponent = findComponentNode(artifact?.componentTree, selectedComponentId);
  const selectedComponent = inlineSelectedComponent?.id === selectedComponentId ? inlineSelectedComponent : treeSelectedComponent;

  const showToast = (input: Omit<DesignToast, 'id'>) => {
    setToast({ ...input, id: Date.now() });
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(undefined), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    refreshAgentServers()
      .catch((loadError) => showToast({ type: 'error', title: t('design.toast.agentLoadFailed'), message: errorMessage(loadError) }));
    fetchSkills().then(setSkills).catch(() => setSkills([]));
    refreshProjects().catch((loadError) => showToast({ type: 'error', title: t('design.toast.projectsLoadFailed'), message: errorMessage(loadError) }));
  }, []);

  useEffect(() => {
    return () => {
      messageAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (busy !== 'initialize') return undefined;
    const negotiating = window.setTimeout(() => setInitializingStep('negotiating'), 450);
    return () => window.clearTimeout(negotiating);
  }, [busy]);

  useEffect(() => {
    if (!selectedProject) return;
    refreshSessions(selectedProject.name)
      .catch((loadError) => showToast({ type: 'error', title: t('design.toast.sessionsLoadFailed'), message: errorMessage(loadError) }));
    fetchDesignProject(selectedProject.name)
      .then((project) => setProjectArtifact(project.artifact))
      .catch((loadError) => showToast({ type: 'error', title: t('design.toast.projectLoadFailed'), message: errorMessage(loadError) }));
  }, [selectedProject?.name]);

  useEffect(() => {
    let cancelled = false;
    const seed = liveConfigSeedRef.current?.agentServerId === agentServerId
      ? liveConfigSeedRef.current
      : undefined;
    if (seed) {
      liveConfigSeedRef.current = null;
      setCapabilities(seed.capabilities);
      setModeId(seed.modeId);
      setConfigOptions(seed.configOptions);
    } else {
      setCapabilities(undefined);
      setModeId('');
      setConfigOptions({});
    }
    if (!agentServerId) return () => { cancelled = true; };
    fetchAgentServerCapabilities(agentServerId)
      .then((value) => {
        if (cancelled) return;
        setCapabilities(value);
        setConfigOptions((current) => reconcileDesignConfigOptions(value, current));
      })
      .catch(() => { if (!cancelled) setCapabilities(undefined); });
    return () => { cancelled = true; };
  }, [agentServerId]);

  useEffect(() => {
    let cancelled = false;
    setStartCapabilities(undefined);
    setStartModeId('');
    setStartConfigOptions({});
    if (!startAgentServerId) return () => { cancelled = true; };
    fetchAgentServerCapabilities(startAgentServerId)
      .then((value) => {
        if (cancelled) return;
        setStartCapabilities(value);
        setStartConfigOptions((current) => reconcileDesignConfigOptions(value, current));
      })
      .catch(() => { if (!cancelled) setStartCapabilities(undefined); });
    return () => { cancelled = true; };
  }, [startAgentServerId]);

  useEffect(() => {
    setSelectedComponentId('');
    if (!artifact) return;
    if (artifactHasView(artifact, activeTab)) return;
    const nextTab = (['html', 'wireframe'] as DesignArtifactTab[])
      .find((tab) => artifactHasView(artifact, tab));
    if (nextTab) setActiveTab(nextTab);
  }, [artifact?.id, activeTab]);

  const refreshReferences = async () => {
    const next = await fetchDesignReferences();
    setReferences(next);
    setSelectedReference((current) => current && next.some((reference) => reference.name === current)
      ? current
      : '');
    setError('');
    return next;
  };

  const refreshAgentServers = async () => {
    const next = await fetchAgentServers();
    setAgentServers(next);
    setAgentServerId((current) => current || next[0]?.id || '');
    setStartAgentServerId((current) => current || next[0]?.id || '');
    return next;
  };

  const refreshProjects = async () => {
    const next = await fetchDesignProjects();
    setProjects(next);
    return next;
  };

  const refreshSessions = async (projectName = selectedProject?.name) => {
    const next = await fetchDesignSessions(projectName);
    setSessions(next);
    return next;
  };

  const refreshVersionState = async (projectName = selectedProject?.name) => {
    if (!projectName) return undefined;
    const next = await fetchDesignProjectVersion(projectName);
    setVersionState(next);
    setSelectedVersionHash((current) => current && next.commits.some((commit) => commit.hash === current)
      ? current
      : next.currentHead ?? next.commits[0]?.hash ?? '');
    return next;
  };

  const openVersionModal = async () => {
    if (!selectedProject || busy) return;
    setVersionModalOpen(true);
    setVersionCommitOpen(false);
    setVersionBranchTarget(undefined);
    setVersionCommitIntent({ type: 'record' });
    setVersionPanelError('');
    setBusy('version');
    setError('');
    try {
      const next = await refreshVersionState(selectedProject.name);
      const cached = next?.settings.versionControl;
      setVersionAuthorName(cached?.authorName ?? '');
      setVersionAuthorEmail(cached?.authorEmail ?? '');
      setVersionNote('');
    } catch (versionError) {
      const message = errorMessage(versionError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.versionLoadFailed'), message });
    } finally {
      setBusy('');
    }
  };

  const reloadVersionModal = async () => {
    if (!selectedProject || busy) return;
    setBusy('version');
    setError('');
    setVersionPanelError('');
    try {
      await refreshVersionState(selectedProject.name);
    } catch (versionError) {
      const message = errorMessage(versionError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.versionLoadFailed'), message });
    } finally {
      setBusy('');
    }
  };

  const openVersionCommitForm = () => {
    const cached = versionState?.settings.versionControl;
    setVersionAuthorName((current) => current || cached?.authorName || '');
    setVersionAuthorEmail((current) => current || cached?.authorEmail || '');
    setVersionNote('');
    setVersionCommitOpen(true);
    setVersionBranchTarget(undefined);
    setVersionCommitIntent({ type: 'record' });
    setVersionPanelError('');
  };

  const cancelVersionCommitForm = () => {
    setVersionCommitOpen(false);
    setVersionNote('');
    setVersionCommitIntent({ type: 'record' });
    setVersionPanelError('');
  };

  const requestVersionBranch = (commitHash: string) => {
    if (!versionState || commitHash === versionState.currentHead) return;
    const branchName = preferredBranchName(versionState, commitHash);
    setVersionPanelError('');
    if (versionState.dirty) {
      const cached = versionState.settings.versionControl;
      setVersionAuthorName((current) => current || cached?.authorName || '');
      setVersionAuthorEmail((current) => current || cached?.authorEmail || '');
      setVersionNote('');
      setVersionCommitIntent({ type: 'branch-after-record', commitHash, ...(branchName ? { branchName } : {}) });
      setVersionCommitOpen(true);
      setVersionBranchTarget(undefined);
      return;
    }
    setVersionCommitIntent({ type: 'record' });
    setVersionCommitOpen(false);
    setVersionBranchTarget({ commitHash, ...(branchName ? { branchName } : {}) });
  };

  const changeVersionBranchTarget = (target: VersionBranchTarget) => {
    setVersionBranchTarget(target);
    setVersionCommitIntent((current) => current.type === 'branch-after-record' && current.commitHash === target.commitHash
      ? { type: 'branch-after-record', commitHash: target.commitHash, ...(target.branchName ? { branchName: target.branchName } : {}) }
      : current);
  };

  const submitVersionCommit = async () => {
    if (!selectedProject || busy) return;
    const intent = versionCommitIntent;
    setBusy('version');
    setError('');
    setVersionPanelError('');
    try {
      const next = await recordDesignProjectVersion(selectedProject.name, {
        authorName: versionAuthorName,
        authorEmail: versionAuthorEmail,
        ...(versionNote.trim() ? { note: versionNote.trim() } : {}),
      });
      if (intent.type === 'branch-after-record') {
        setVersionState(next);
        setSelectedVersionHash(next.currentHead ?? next.commits[0]?.hash ?? '');
        const targetBranchName = intent.branchName ?? preferredBranchName(next, intent.commitHash);
        const branched = await branchDesignProjectVersion(selectedProject.name, intent.commitHash, targetBranchName);
        setVersionState(branched);
        setSelectedVersionHash(branched.currentHead ?? intent.commitHash);
        setVersionBranchTarget(undefined);
        const detail = await fetchDesignProject(selectedProject.name);
        setProjectArtifact(detail.artifact);
        showToast({ type: 'success', title: t('design.toast.versionRecordedAndBranched'), message: branched.currentBranch ?? intent.commitHash.slice(0, 8) });
      } else {
        setVersionState(next);
        setSelectedVersionHash(next.currentHead ?? next.commits[0]?.hash ?? '');
        showToast({ type: 'success', title: t('design.toast.versionRecorded'), message: next.currentHead?.slice(0, 8) ?? selectedProject.name });
      }
      setVersionCommitOpen(false);
      setVersionNote('');
      setVersionCommitIntent({ type: 'record' });
    } catch (versionError) {
      const message = errorMessage(versionError);
      setVersionPanelError(message);
      showToast({
        type: 'error',
        title: versionCommitIntent.type === 'branch-after-record' ? t('design.toast.versionBranchFailed') : t('design.toast.versionRecordFailed'),
        message,
      });
    } finally {
      setBusy('');
    }
  };

  const submitVersionBranch = async (target: VersionBranchTarget) => {
    if (!selectedProject || busy) return;
    setBusy('version');
    setError('');
    setVersionPanelError('');
    try {
      const next = await branchDesignProjectVersion(selectedProject.name, target.commitHash, target.branchName);
      setVersionState(next);
      setSelectedVersionHash(next.currentHead ?? target.commitHash);
      setVersionBranchTarget(undefined);
      const detail = await fetchDesignProject(selectedProject.name);
      setProjectArtifact(detail.artifact);
      showToast({ type: 'success', title: t('design.toast.versionBranched'), message: next.currentBranch ?? target.commitHash.slice(0, 8) });
    } catch (versionError) {
      const message = errorMessage(versionError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.versionBranchFailed'), message });
    } finally {
      setBusy('');
    }
  };

  const openProject = (project: DesignProjectSummary) => {
    setSelectedProject(project);
    setProjectArtifact(undefined);
    setSession(undefined);
    setLiveLogs([]);
    setPendingUserMessage(undefined);
    setHistoryMode(true);
    setSelectedComponentId('');
    setComponentStyleDrafts({});
    setRightPanelMode('properties');
    setPanelFrameId('');
    setDescriptionText('');
    setChatInput('');
    setChatAttachments([]);
    setReferenceOpen(false);
    setReferenceImportOpen(false);
    setVersionModalOpen(false);
    setVersionState(undefined);
    setSelectedVersionHash('');
    setVersionCommitOpen(false);
    setVersionBranchTarget(undefined);
    setVersionCommitIntent({ type: 'record' });
    setVersionPanelError('');
  };

  const closeProject = () => {
    setSelectedProject(undefined);
    setProjectArtifact(undefined);
    setSession(undefined);
    setLiveLogs([]);
    setPendingUserMessage(undefined);
    setHistoryMode(true);
    setSelectedComponentId('');
    setComponentStyleDrafts({});
    setRightPanelMode('properties');
    setPanelFrameId('');
    setDescriptionText('');
    setChatInput('');
    setChatAttachments([]);
    setReferenceOpen(false);
    setReferenceImportOpen(false);
    setVersionModalOpen(false);
    setVersionState(undefined);
    setSelectedVersionHash('');
    setVersionCommitOpen(false);
    setVersionBranchTarget(undefined);
    setVersionCommitIntent({ type: 'record' });
    setVersionPanelError('');
  };

  const submitCreateProject = async () => {
    const name = projectNameInput.trim();
    if (!name || busy) return;
    setBusy('project');
    setError('');
    try {
      const project = await createDesignProject(name);
      await refreshProjects();
      setProjectNameInput('');
      openProject(project);
      showToast({ type: 'success', title: t('design.toast.projectCreated'), message: project.name });
    } catch (createError) {
      const message = errorMessage(createError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.projectCreateFailed'), message });
    } finally {
      setBusy('');
    }
  };

  const refreshCapabilities = async () => {
    if (!agentServerId) return;
    setBusy('capabilities');
    try {
      const next = await refreshAgentServerCapabilities(agentServerId);
      setCapabilities(next);
      setConfigOptions((current) => reconcileDesignConfigOptions(next, current));
    } finally {
      setBusy('');
    }
  };

  const refreshStartCapabilities = async () => {
    if (!startAgentServerId) return;
    setBusy('capabilities');
    try {
      const next = await refreshAgentServerCapabilities(startAgentServerId);
      setStartCapabilities(next);
      setStartConfigOptions((current) => reconcileDesignConfigOptions(next, current));
    } finally {
      setBusy('');
    }
  };

  const openStartSessionDialog = () => {
    if (!selectedProject) return;
    setStartAgentServerId(agentServerId || agentServers[0]?.id || '');
    setStartModeId(modeId);
    setStartConfigOptions(configOptions);
    setStartSessionOpen(true);
    setError('');
  };

  const resetChatStateForNewSession = () => {
    setSession(undefined);
    setLiveLogs([]);
    setPendingUserMessage(undefined);
    setSelectedComponentId('');
    setComponentStyleDrafts({});
    setRightPanelMode('properties');
    setPanelFrameId('');
    setDescriptionText('');
    setChatInput('');
    setChatAttachments([]);
    setReferenceOpen(false);
    setSelectedReference('');
    setReferenceInterfaceDescription('');
    setReferenceImportOpen(false);
  };

  const startNewSession = async () => {
    const agent = startAgentServerId.trim();
    if (!selectedProject || busy) return;
    if (!agent) {
      showToast({ type: 'error', title: t('design.toast.messageBlocked'), message: t('design.agentRequired') });
      return;
    }
    const requestConfigOptions = reconcileDesignConfigOptions(startCapabilities, startConfigOptions);
    setStartConfigOptions(requestConfigOptions);
    const controller = new AbortController();
    messageAbortRef.current?.abort();
    messageAbortRef.current = controller;
    resetChatStateForNewSession();
    setBusy('initialize');
    setInitializingStep('connecting');
    setHistoryMode(false);
    setStartSessionOpen(false);
    setError('');
    try {
      const nextSession = await streamInitializeDesignSession({
        projectName: selectedProject.name,
        agentServerId: agent,
        ...(startModeId ? { modeId: startModeId } : {}),
        ...(Object.keys(requestConfigOptions).length > 0 ? { configOptions: requestConfigOptions } : {}),
      }, {
        signal: controller.signal,
        onReady: () => setInitializingStep('connecting'),
        onLog: () => setInitializingStep('negotiating'),
      });
      setInitializingStep('ready');
      liveConfigSeedRef.current = {
        agentServerId: agent,
        capabilities: startCapabilities,
        modeId: startModeId,
        configOptions: requestConfigOptions,
      };
      setAgentServerId(agent);
      setCapabilities(startCapabilities);
      setModeId(startModeId);
      setConfigOptions(requestConfigOptions);
      setSession(nextSession);
      setLiveLogs(nextSession.logs ?? []);
      setProjectArtifact(nextSession.latestArtifact);
      await refreshSessions(selectedProject.name);
      showToast({ type: 'success', title: t('design.toast.sessionStarted'), message: t('design.chat.ready') });
      window.setTimeout(() => setInitializingStep('idle'), 360);
    } catch (startError) {
      if ((startError as { name?: string }).name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      const message = errorMessage(startError);
      setError(message);
      setHistoryMode(true);
      showToast({ type: 'error', title: t('design.toast.sessionStartFailed'), message });
    } finally {
      if (messageAbortRef.current === controller) messageAbortRef.current = null;
      if (!controller.signal.aborted) setBusy('');
    }
  };

  const backToHistory = () => {
    setHistoryMode(true);
    setSession(undefined);
    setLiveLogs([]);
    setPendingUserMessage(undefined);
    setSelectedComponentId('');
    setRightPanelMode('properties');
    setPanelFrameId('');
    setDescriptionText('');
    setChatAttachments([]);
    setReferenceImportOpen(false);
    setInitializingStep('idle');
  };

  const loadSession = async (id: string) => {
    if (busy) return;
    setBusy('session');
    setError('');
    try {
      const next = await fetchDesignSession(id);
      setSession(next);
      setLiveLogs(next.logs ?? []);
      setPendingUserMessage(undefined);
      setSelectedProject(next.project);
      setHistoryMode(false);
      setSelectedComponentId('');
      setComponentStyleDrafts({});
      setRightPanelMode('properties');
      setPanelFrameId('');
      setDescriptionText('');
      setChatAttachments([]);
      if (next.agentServerId) setAgentServerId(next.agentServerId);
      if (next.reference?.name) {
        setSelectedReference(next.reference.name);
      setReferenceInterfaceDescription(next.reference.interfaceDescription ?? '');
      }
      setInitializingStep('idle');
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.sessionLoadFailed'), message });
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    refreshReferences().catch((loadError) => {
      const message = errorMessage(loadError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.referencesLoadFailed'), message });
    });
  }, []);

  const submitImport = async () => {
    const trimmedSource = source.trim();
    if (!trimmedSource || busy) return;
    setBusy('import');
    setError('');
    try {
      const imported = await importDesignReference(importMode === 'git'
        ? { type: 'git', name: name.trim(), url: trimmedSource, ...(branch.trim() ? { branch: branch.trim() } : {}) }
        : { type: 'copy', name: name.trim(), sourcePath: trimmedSource });
      await refreshReferences();
      setSelectedReference(imported.name);
      setReferenceInterfaceDescription('');
      setName('');
      setSource('');
      setBranch('');
      setReferenceImportOpen(false);
      showToast({ type: 'success', title: t('design.toast.referenceImported'), message: imported.name });
    } catch (importError) {
      const message = errorMessage(importError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.importFailed'), message });
    } finally {
      setBusy('');
    }
  };

  const addChatImageFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    if (!selectedProject) {
      showToast({ type: 'error', title: t('design.toast.messageBlocked'), message: t('design.project.required') });
      return;
    }
    try {
      const uploaded = await uploadDesignImages(selectedProject.name, images);
      setChatAttachments((current) => [...current, ...uploaded]);
    } catch (uploadError) {
      const message = errorMessage(uploadError);
      setError(message);
      showToast({ type: 'error', title: t('design.toast.imageUploadFailed'), message });
    }
  };

  const handleChatPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    void addChatImageFiles(files);
  };

  const handleChatDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    void addChatImageFiles(files);
  };

  const submitMessage = async () => {
    const composedMessage = composeChatInput(chatInput, artifact?.componentTree, componentStyleDrafts).trim();
    const message = composedMessage || (chatAttachments.length ? t('design.chat.imageOnlyMessage') : '');
    const agent = agentServerId.trim();
    if ((!message && chatAttachments.length === 0) || busy) return;
    if (!selectedProject) {
      showToast({ type: 'error', title: t('design.toast.messageBlocked'), message: t('design.project.required') });
      return;
    }
    if (!agent) {
      showToast({ type: 'error', title: t('design.toast.messageBlocked'), message: t('design.agentRequired') });
      return;
    }
    const requestConfigOptions = reconcileDesignConfigOptions(capabilities, configOptions);
    setConfigOptions(requestConfigOptions);
    setBusy('message');
    setError('');
    const pendingMessage: DesignChatMessage = {
      id: `pending-${Date.now()}`,
      role: 'user',
      text: message,
      at: new Date().toISOString(),
      ...(chatAttachments.length ? { attachments: chatAttachments } : {}),
    };
    const controller = new AbortController();
    messageAbortRef.current?.abort();
    messageAbortRef.current = controller;
    setPendingUserMessage(pendingMessage);
    setLiveLogs(session?.logs ?? []);
    try {
      const nextSession = await streamDesignMessage({
        sessionId: session?.id,
        projectName: selectedProject.name,
        agentServerId: agent,
        message,
        ...(chatAttachments.length ? { attachments: chatAttachments } : {}),
        ...(selectedReference ? { referenceName: selectedReference } : {}),
        ...(selectedReference && referenceInterfaceDescription.trim()
          ? { referenceInterfaceDescription: referenceInterfaceDescription.trim() }
          : {}),
        ...(modeId ? { modeId } : {}),
        ...(Object.keys(requestConfigOptions).length > 0 ? { configOptions: requestConfigOptions } : {}),
      }, {
        signal: controller.signal,
        onLog: (entry) => {
          setLiveLogs((current) => current.some((item) => item.id === entry.id) ? current : [...current, entry]);
        },
      });
      setSession(nextSession);
      setLiveLogs(nextSession.logs ?? []);
      setProjectArtifact(nextSession.latestArtifact);
      setHistoryMode(false);
      setPendingUserMessage(undefined);
      setChatInput('');
      setChatAttachments([]);
      await refreshSessions(selectedProject.name);
      showToast({ type: 'success', title: t('design.toast.messageSent'), message: t('design.toast.agentResponded') });
    } catch (sendError) {
      if ((sendError as { name?: string }).name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      const payload = sendError instanceof DesignApiError ? sendError.payload : undefined;
      const messageText = payload?.error ?? errorMessage(sendError);
      setError(messageText);
      showToast({ type: 'error', title: t('design.toast.messageFailed'), message: messageText });
    } finally {
      if (messageAbortRef.current === controller) messageAbortRef.current = null;
      if (!controller.signal.aborted) setPendingUserMessage(undefined);
      setBusy('');
    }
  };

  const visibleLogs = visibleSessionLogs(liveLogs, session?.logs);
  const threadItems = designThreadItems(visibleLogs, pendingUserMessage, busy === 'message');
  const activeFrame = artifact?.frames?.find((frame) => frame.id === panelFrameId);
  const selectedStyleDraft = selectedComponentId ? componentStyleDrafts[selectedComponentId] ?? {} : {};
  const addComponentToken = (component: DesignComponentNode) => {
    const marker = `<specflow_component id="${escapePromptAttr(component.id)}" name="${escapePromptAttr(component.name)}" />`;
    chatInputRef.current?.insertSerialized(marker);
  };
  const resetComponentComment = () => {
    setComponentCommentOpen(false);
    setComponentComment('');
  };
  const queueComponentComment = (component: DesignComponentNode, comment: string) => {
    const marker = [
      `<specflow_comment componentId="${escapePromptAttr(component.id)}" componentName="${escapePromptAttr(component.name)}">`,
      comment,
      '</specflow_comment>',
    ].join('\n');
    chatInputRef.current?.insertSerialized(marker);
    resetComponentComment();
  };
  const queueSelectedComment = () => {
    if (!selectedComponent || !componentComment.trim()) return;
    queueComponentComment(selectedComponent, componentComment.trim());
  };
  const updateSelectedStyle = (property: string, value: string) => {
    if (!selectedComponentId) return;
    setComponentStyleDrafts((current) => ({
      ...current,
      [selectedComponentId]: {
        ...(current[selectedComponentId] ?? {}),
        [property]: value,
      },
    }));
  };
  const openCanvasPanel = async (target: DesignRightPanelMode, frame: NonNullable<DesignArtifact['frames']>[number]) => {
    setRightPanelMode(target);
    setPanelFrameId(frame.id);
    if (target !== 'description') return;
    setDescriptionText('');
    if (!artifact || !frame.descriptionPath) return;
    setDescriptionBusy(true);
    try {
      setDescriptionText(await fetchDesignProjectFileText(artifact.projectName, frame.descriptionPath));
    } catch (loadError) {
      const message = errorMessage(loadError);
      setDescriptionText(message);
      showToast({ type: 'error', title: t('design.toast.descriptionLoadFailed'), message });
    } finally {
      setDescriptionBusy(false);
    }
  };
  const startChatResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatPanelWidth;
    document.body.classList.add('design-resizing-chat');
    const onMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(DESIGN_CHAT_MAX_WIDTH, Math.max(DESIGN_CHAT_MIN_WIDTH, window.innerWidth - 620));
      setChatPanelWidth(clampWidth(startWidth + moveEvent.clientX - startX, DESIGN_CHAT_MIN_WIDTH, maxWidth));
    };
    const onUp = () => {
      document.body.classList.remove('design-resizing-chat');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setChatPanelWidth((current) => {
        try {
          localStorage.setItem(DESIGN_CHAT_WIDTH_KEY, String(current));
        } catch {
          // Ignore storage failures; resizing should still work for this session.
        }
        return current;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="design-app">
      <header className="design-topbar">
        <div className="brand">
          <span className="brand-mark">
            <img src="/favicon.svg" alt="" aria-hidden="true" />
          </span>
          <span>Aflow</span>
        </div>
        <div className="crumbs">
          <span>{t('design.crumb.workspace')}</span><span className="sep">/</span>
          <span className="current">{t('design.crumb.design')}</span>
          {selectedProject && <><span className="sep">/</span><span className="current">{selectedProject.name}</span></>}
        </div>
        <div className="topbar-spacer" />
        {selectedProject && (
          <button className="btn sm ghost design-project-switch" onClick={closeProject} title={t('design.project.switch')}>
            <Icon name="folder" size={12} />{t('design.project.switch')}
          </button>
        )}
        <button className="btn sm agent-update-button" onClick={() => setAgentServerManagerOpen(true)} title={t('topbar.agentsTitle')}>
          <Icon name="settings" size={11} />{t('topbar.agents')}
        </button>
        <div className="language-toggle" aria-label={t('language.label')}>
          <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} title="English">
            {t('language.english')}
          </button>
          <button className={language === 'zh-CN' ? 'active' : ''} onClick={() => setLanguage('zh-CN')} title="简体中文">
            {t('language.chinese')}
          </button>
        </div>
        <div className="theme-toggle">
          <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} title={t('topbar.light')}>
            <Icon name="sun" size={12} />
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} title={t('topbar.dark')}>
            <Icon name="moon" size={12} />
          </button>
        </div>
        {selectedProject && (
          <button className="btn sm ghost" disabled={busy === 'version'} onClick={() => void openVersionModal()} title={t('design.version.title')}>
            {busy === 'version' && versionModalOpen ? <Icon name="loader" size={12} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="history" size={12} />}
            {t('design.version.button')}
          </button>
        )}
        <button className="btn sm primary" disabled title={t('design.comingSoon')}>
          <Icon name="upload" size={12} />{t('design.upload')}
        </button>
      </header>

      {toast && (
        <div className={`app-toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          <Icon name={toast.type === 'error' ? 'alert' : 'check'} size={14} />
          <div className="app-toast-body">
            <div className="app-toast-title">{toast.title}</div>
            <div className="app-toast-message">{toast.message}</div>
          </div>
          <button className="icon-btn app-toast-close" title={t('common.close')} onClick={() => setToast(undefined)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      {!selectedProject ? (
        <main className="design-project-gate">
          <section className="design-project-picker">
            <div className="design-project-picker-head">
              <div>
                <div className="design-panel-title">{t('design.project.title')}</div>
                <div className="design-panel-meta">{t('design.project.meta')}</div>
              </div>
            </div>
            <div className="design-project-create">
              <input
                className="input"
                value={projectNameInput}
                onInput={(event) => setProjectNameInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitCreateProject();
                }}
                placeholder={t('design.project.namePlaceholder')}
              />
              <button className="btn primary" disabled={!projectNameInput.trim() || Boolean(busy)} onClick={() => void submitCreateProject()}>
                {busy === 'project' ? <Icon name="loader" size={12} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="plus" size={12} />}
                {t('design.project.create')}
              </button>
            </div>
            <div className="design-project-list">
              {projects.length === 0 ? (
                <div className="design-session-empty">{t('design.project.empty')}</div>
              ) : projects.map((project) => (
                <button key={project.name} className="design-project-item" onClick={() => openProject(project)}>
                  <span>{project.name}</span>
                  <small>{project.path}</small>
                </button>
              ))}
            </div>
          </section>
        </main>
      ) : (
      <main className="design-shell" style={{ '--design-chat-width': `${chatPanelWidth}px` } as CSSProperties}>
        <section className={`design-chat-panel${chatPanelCompact ? ' compact' : ''}`}>
          <div className="design-panel-head">
            {!historyMode && (
              <button className="icon-btn design-panel-icon" title={t('design.chat.backToHistory')} onClick={backToHistory}>
                <Icon name="arrow-right" size={13} className="design-back-icon" />
              </button>
            )}
            <div>
              <div className="design-panel-title">{historyMode ? t('design.chat.history') : t('design.chat.title')}</div>
              <div className="design-panel-meta">
                {historyMode
                  ? t('design.chat.historyMeta', { count: sessions.length })
                  : session?.acpSessionId ? t('design.chat.acpSession', { id: session.acpSessionId }) : t('design.chat.ready')}
              </div>
            </div>
            <button className="icon-btn design-panel-icon" title={t('design.chat.newSession')} onClick={openStartSessionDialog}>
              <Icon name="edit" size={13} />
            </button>
          </div>

          <div className="design-thread">
            {historyMode ? (
              <div className="design-session-list full">
                {sessions.length === 0 ? (
                  <div className="design-session-empty">{t('design.chat.noHistory')}</div>
                ) : sessions.map((item) => (
                  <button
                    key={item.id}
                    className={`design-session-item${item.id === session?.id ? ' active' : ''}`}
                    disabled={busy === 'session'}
                    onClick={() => void loadSession(item.id)}
                  >
                    <span>{item.title}</span>
                    <small>{item.agentServerId ?? t('design.agentMissing')} · {item.messageCount}</small>
                  </button>
                ))}
              </div>
            ) : busy === 'initialize' || initializingStep !== 'idle' ? (
              <DesignInitializingView step={initializingStep} />
            ) : threadItems.length === 0 ? (
              <div className="design-message system">{t('design.chat.empty')}</div>
            ) : threadItems.map((item) => item.type === 'message' ? (
              <DesignMessageView key={item.message.id} message={item.message} projectName={selectedProject?.name} />
            ) : (
              <DesignActivityLine key={item.entry.id} entry={item.entry} active={item.active} />
            ))}
          </div>

          {historyMode ? (
            <div className="design-history-footer">
              <button className="btn primary design-start-button" disabled={Boolean(busy)} onClick={openStartSessionDialog}>
                <Icon name="play-circle" size={13} />{t('design.chat.startDesign')}
              </button>
            </div>
          ) : busy !== 'initialize' && (
            <>
              <div className="design-reference-strip">
                <button
                  className={`icon-btn design-reference-toggle${referenceOpen ? ' active' : ''}`}
                  title={referenceOpen ? t('design.reference.collapse') : t('design.reference.expand')}
                  onClick={() => setReferenceOpen((open) => !open)}
                >
                  <Icon name="folder" size={13} />
                </button>
                <span className="design-compose-reference-label">
                  {selectedSummary ? selectedSummary.name : t('design.reference.optional')}
                </span>
              </div>

              {referenceOpen && (
                <div className="design-reference-drawer">
                  <div className="design-drawer-head">
                    <div>
                      <div className="design-section-title">{t('design.reference.title')}</div>
                      <div className="design-panel-meta">{t('design.reference.count', { count: references.length })}</div>
                    </div>
                    <div className="design-drawer-actions">
                      <button className="btn sm ghost" onClick={() => setReferenceImportOpen(true)}>
                        <Icon name="plus" size={11} />{t('design.reference.import')}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => refreshReferences()
                          .then((next) => showToast({ type: 'success', title: t('design.toast.referencesRefreshed'), message: t('design.reference.count', { count: next.length }) }))
                          .catch((loadError) => {
                            const message = errorMessage(loadError);
                            setError(message);
                            showToast({ type: 'error', title: t('design.toast.refreshFailed'), message });
                          })}
                        title={t('design.reference.refresh')}
                      >
                        <Icon name="rotate" size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="design-reference-list">
                    {references.map((reference) => (
                      <button
                        key={reference.name}
                        className={`design-reference-item${reference.name === selectedReference ? ' active' : ''}`}
                        onClick={() => {
                          setSelectedReference((current) => current === reference.name ? '' : reference.name);
                          setReferenceInterfaceDescription('');
                        }}
                      >
                        <span className="design-reference-name">{reference.name}</span>
                        <span>{reference.path}</span>
                      </button>
                    ))}
                  </div>

                  {selectedSummary && (
                    <div className="design-reference-context">
                      <div className="design-section-title">{t('design.reference.interfaceDescription')}</div>
                      <textarea
                        className="textarea"
                        rows={4}
                        value={referenceInterfaceDescription}
                        onInput={(event) => setReferenceInterfaceDescription(event.currentTarget.value)}
                        placeholder={t('design.reference.interfacePlaceholder')}
                      />
                      <div className="design-reference-context-path">{selectedSummary.path}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="design-compose">
                {chatAttachments.length > 0 && selectedProject && (
                  <div className="design-attachment-strip">
                    {chatAttachments.map((attachment) => (
                      <div className="design-attachment-thumb" key={attachment.id}>
                        <img src={designProjectFileUrl(selectedProject.name, attachment.path)} alt={attachment.name} />
                        <button
                          type="button"
                          title={t('common.close')}
                          onClick={() => setChatAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                        >
                          <Icon name="x" size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <RichPromptInput
                  ref={chatInputRef}
                  rows={4}
                  value={chatInput}
                  disabled={Boolean(busy)}
                  className="design-rich-prompt"
                  tokenDefinitions={designPromptTokenDefinitions}
                  skills={skills}
                  availableCommands={capabilities?.availableCommands}
                  onChange={setChatInput}
                  onSubmit={submitMessage}
                  onPaste={handleChatPaste}
                  onDrop={handleChatDrop}
                  placeholder={t('design.chat.placeholder')}
                />
                <DesignSlashWarnings prompt={chatInput} skills={skills} availableCommands={capabilities?.availableCommands} />
                <div className="design-compose-footer">
                  <DesignAcpControls
                    className="design-acp-mode-controls"
                    capabilities={capabilities}
                    modeId={modeId}
                    configOptions={configOptions}
                    compact={chatPanelCompact}
                    disabled={!agentServerId || Boolean(busy)}
                    showConfigOptions={false}
                    showRefresh={false}
                    refreshing={busy === 'capabilities'}
                    onRefresh={refreshCapabilities}
                    onChangeMode={(nextModeId) => setModeId(nextModeId ?? '')}
                    onChangeConfigOption={(configId, value) => {
                      setConfigOptions((current) => {
                        const next = { ...current };
                        if (value === undefined) delete next[configId];
                        else next[configId] = value;
                        return next;
                      });
                    }}
                  />
                  <div className="design-compose-spacer" />
                  <DesignAcpControls
                    className="design-acp-config-controls"
                    capabilities={capabilities}
                    modeId={modeId}
                    configOptions={configOptions}
                    compact={chatPanelCompact}
                    disabled={!agentServerId || Boolean(busy)}
                    showMode={false}
                    refreshing={busy === 'capabilities'}
                    onRefresh={refreshCapabilities}
                    onChangeMode={(nextModeId) => setModeId(nextModeId ?? '')}
                    onChangeConfigOption={(configId, value) => {
                      setConfigOptions((current) => {
                        const next = { ...current };
                        if (value === undefined) delete next[configId];
                        else next[configId] = value;
                        return next;
                      });
                    }}
                  />
                  <button className="icon-btn design-send-btn" disabled={(!composeChatInput(chatInput, artifact?.componentTree, componentStyleDrafts).trim() && chatAttachments.length === 0) || Boolean(busy)} onClick={submitMessage} title={t('design.chat.send')}>
                    {busy === 'message' ? <Icon name="loader" size={14} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="arrow-up" size={15} />}
                  </button>
                </div>
              </div>
            </>
          )}
          <button
            className="design-chat-resize-handle"
            type="button"
            aria-label={t('design.chat.resize')}
            title={t('design.chat.resize')}
            onPointerDown={startChatResize}
          />
        </section>

        <section className="design-canvas-panel">
          <DesignCanvas
            artifact={artifact}
            view={activeTab}
            selectedComponentId={selectedComponentId}
            selectedComponent={selectedComponent}
            styleDrafts={componentStyleDrafts}
            onViewChange={setActiveTab}
            onComponentHover={() => undefined}
            onComponentSelect={(id, component) => {
              setSelectedComponentId(id);
              setInlineSelectedComponent(component);
              setInlineHierarchyPath(component ? [component] : []);
              setRightPanelMode('properties');
              setInspectorTab('properties');
              resetComponentComment();
            }}
            onComponentHierarchy={(id, component, path) => {
              if (id !== selectedComponentId) return;
              setInlineSelectedComponent(component);
              setInlineHierarchyPath(path.length ? path : [component]);
            }}
            onOpenPanel={(target, frame) => {
              void openCanvasPanel(target, frame);
            }}
          />
        </section>

        <aside className="design-properties-panel">
          {rightPanelMode !== 'properties' && (
            <div className="design-panel-head">
              <div>
                <div className="design-panel-title">
                  {rightPanelMode === 'description'
                    ? t('design.properties.description')
                    : t('design.properties.componentTree')}
                </div>
                <div className="design-panel-meta">{t('design.properties.meta')}</div>
              </div>
            </div>
          )}
          {rightPanelMode === 'properties' && (
            <div className="design-panel-tabs">
              <button className={inspectorTab === 'properties' ? 'active' : ''} onClick={() => setInspectorTab('properties')}>{t('design.properties.title')}</button>
              <button className={inspectorTab === 'hierarchy' ? 'active' : ''} onClick={() => setInspectorTab('hierarchy')}>{t('design.properties.hierarchy')}</button>
            </div>
          )}
          {rightPanelMode === 'description' ? (
            <div className="design-properties-content">
              <div className="design-description-panel">
                <div className="design-section-title">{activeFrame?.title ?? t('design.properties.description')}</div>
                {descriptionBusy ? (
                  <div className="design-properties-empty">{t('common.loading')}</div>
                ) : descriptionText ? (
                  <pre>{descriptionText}</pre>
                ) : (
                  <div className="design-properties-empty">{t('design.properties.noDescription')}</div>
                )}
              </div>
            </div>
          ) : rightPanelMode === 'tree' ? (
            <div className="design-properties-content">
              <div className="design-section-title">{activeFrame?.title ?? t('design.properties.componentTree')}</div>
              {artifact?.componentTree?.length ? (
                <div className="design-component-tree">
                  {artifact.componentTree.map((node) => (
                    <ComponentTreeNodeView
                      key={node.id}
                      node={node}
                      selectedId={selectedComponentId}
                      onSelect={(node) => {
                        setSelectedComponentId(node.id);
                        setInlineSelectedComponent(node);
                        setRightPanelMode('properties');
                        setInspectorTab('properties');
                        resetComponentComment();
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="design-properties-empty">{t('design.properties.noComponentTree')}</div>
              )}
            </div>
          ) : selectedComponent ? (
            <div className="design-properties-content">
              <div className="design-inspector-stack">
                <div className="design-inspector-card design-component-summary-card">
                  <div className="design-section-title">{t('design.properties.selected')}</div>
                  <div className="design-component-name">{selectedComponent.name}</div>
                  <div className="design-component-meta">{selectedComponent.type ?? selectedComponent.id}</div>
                  <p>{selectedComponent.description ?? t('design.properties.noDescription')}</p>
                  <div className="design-component-actions">
                    <button className="btn sm ghost" type="button" onClick={() => addComponentToken(selectedComponent)}>
                      <Icon name="plus" size={11} />{t('design.properties.addToPrompt')}
                    </button>
                    <button className="btn sm ghost" type="button" onClick={() => setComponentCommentOpen((open) => !open)}>
                      <Icon name="edit" size={11} />{t('design.properties.comment')}
                    </button>
                  </div>
                  {componentCommentOpen && (
                    <div className="design-component-comment-box">
                      <textarea
                        className="textarea"
                        rows={3}
                        value={componentComment}
                        onInput={(event) => setComponentComment(event.currentTarget.value)}
                        placeholder={t('design.properties.commentPlaceholder')}
                        autoFocus
                      />
                      <button type="button" className="btn sm primary" disabled={!componentComment.trim()} onClick={queueSelectedComment}>
                        <Icon name="plus" size={11} />{t('design.properties.queueComment')}
                      </button>
                    </div>
                  )}
                </div>
                {inspectorTab === 'hierarchy' ? (
                  <div className="design-inspector-card design-hierarchy-card">
                    <div className="design-section-title">{t('design.properties.hierarchy')}</div>
                    <FocusedComponentTreeView
                      roots={artifact?.componentTree}
                      selectedComponent={selectedComponent}
                      selectedId={selectedComponentId}
                      path={inlineHierarchyPath}
                      onSelect={(node) => {
                        setSelectedComponentId(node.id);
                        setInlineSelectedComponent(node);
                        setInlineHierarchyPath([node]);
                        setInspectorTab('hierarchy');
                        resetComponentComment();
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <div className="design-inspector-card design-property-group">
                      <div className="design-section-title">{t('design.properties.layoutContext')}</div>
                      <PropertyReadOnly label={t('design.properties.id')} value={selectedComponent.id} />
                      <PropertyReadOnly label={t('design.properties.selector')} value={selectedComponent.selector} />
                      <PropertyReadOnly label={t('design.properties.display')} value={selectedComponent.computedStyle?.display} />
                      <PropertyReadOnly label={t('design.properties.positionStyle')} value={selectedComponent.computedStyle?.position} />
                      <PropertyReadOnly label={t('design.properties.direction')} value={selectedComponent.computedStyle?.flexDirection} />
                      <PropertyReadOnly label={t('design.properties.align')} value={selectedComponent.computedStyle?.alignItems} />
                      <PropertyReadOnly label={t('design.properties.justify')} value={selectedComponent.computedStyle?.justifyContent} />
                      <PropertyReadOnly label={t('design.properties.gap')} value={selectedComponent.computedStyle?.gap} />
                    </div>
                    <div className="design-inspector-card design-style-controls">
                      <div className="design-section-title">{t('design.properties.layout')}</div>
                      <div className="design-property-grid">
                        <PropertyNumberInput label="X" value={selectedStyleDraft.__aflowX ?? formatNumberValue(selectedComponent.bounds?.x)} unit="px" raw onChange={(value) => updateSelectedStyle('__aflowX', value)} />
                        <PropertyNumberInput label="Y" value={selectedStyleDraft.__aflowY ?? formatNumberValue(selectedComponent.bounds?.y)} unit="px" raw onChange={(value) => updateSelectedStyle('__aflowY', value)} />
                        <PropertyNumberInput label="W" value={selectedStyleDraft.width ?? selectedComponent.computedStyle?.width ?? formatNumberValue(selectedComponent.bounds?.width)} unit="px" onChange={(value) => updateSelectedStyle('width', value)} />
                        <PropertyNumberInput label="H" value={selectedStyleDraft.height ?? selectedComponent.computedStyle?.height ?? formatNumberValue(selectedComponent.bounds?.height)} unit="px" onChange={(value) => updateSelectedStyle('height', value)} />
                      </div>
                    </div>
                    <div className="design-inspector-card design-style-controls">
                      <div className="design-section-title">{t('design.properties.appearance')}</div>
                      <PropertyTextInput label={t('design.properties.background')} value={selectedStyleDraft.backgroundColor ?? ''} onChange={(value) => updateSelectedStyle('backgroundColor', value)} placeholder={selectedComponent.computedStyle?.backgroundColor ?? '#ffffff'} />
                      <PropertyTextInput label={t('design.properties.textColor')} value={selectedStyleDraft.color ?? ''} onChange={(value) => updateSelectedStyle('color', value)} placeholder={selectedComponent.computedStyle?.color ?? '#111827'} />
                      <PropertyNumberInput label={t('design.properties.fontSize')} value={selectedStyleDraft.fontSize ?? selectedComponent.computedStyle?.fontSize ?? ''} unit="px" onChange={(value) => updateSelectedStyle('fontSize', value)} />
                      <PropertyNumberInput label={t('design.properties.radius')} value={selectedStyleDraft.borderRadius ?? selectedComponent.computedStyle?.borderRadius ?? ''} unit="px" onChange={(value) => updateSelectedStyle('borderRadius', value)} />
                      <PropertyNumberInput label={t('design.properties.padding')} value={selectedStyleDraft.padding ?? selectedComponent.computedStyle?.padding ?? ''} unit="px" onChange={(value) => updateSelectedStyle('padding', value)} />
                      <PropertyNumberInput label={t('design.properties.opacity')} value={selectedStyleDraft.opacity ?? selectedComponent.computedStyle?.opacity ?? ''} unit="%" onChange={(value) => updateSelectedStyle('opacity', value)} />
                      <PropertyReadOnly label={t('design.properties.fontWeight')} value={selectedComponent.computedStyle?.fontWeight} />
                      <PropertyReadOnly label={t('design.properties.lineHeight')} value={selectedComponent.computedStyle?.lineHeight} />
                      <PropertyReadOnly label={t('design.properties.border')} value={selectedComponent.computedStyle?.border} />
                      <PropertyReadOnly label={t('design.properties.margin')} value={selectedComponent.computedStyle?.margin} />
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="design-properties-empty">
              <Icon name="cursor" size={16} />
              <span>{artifact?.componentTree?.length ? t('design.properties.selectFromPreview') : t('design.properties.empty')}</span>
            </div>
          )}
        </aside>

        {error && <div className="design-error floating">{error}</div>}
      </main>
      )}
      {agentServerManagerOpen && (
        <AgentServerManager
          onClose={() => setAgentServerManagerOpen(false)}
          onChanged={() => {
            refreshAgentServers().catch(console.error);
          }}
        />
      )}
      {startSessionOpen && selectedProject && (
        <StartDesignSessionModal
          projectName={selectedProject.name}
          busy={busy === 'initialize'}
          agentServers={agentServers}
          agentServerId={startAgentServerId}
          capabilities={startCapabilities}
          modeId={startModeId}
          configOptions={startConfigOptions}
          chatPanelCompact={false}
          capabilityRefreshing={busy === 'capabilities'}
          onClose={() => setStartSessionOpen(false)}
          onStart={() => void startNewSession()}
          onAgentChange={setStartAgentServerId}
          onRefreshCapabilities={refreshStartCapabilities}
          onChangeMode={(nextModeId) => setStartModeId(nextModeId ?? '')}
          onChangeConfigOption={(configId, value) => {
            setStartConfigOptions((current) => {
              const next = { ...current };
              if (value === undefined) delete next[configId];
              else next[configId] = value;
              return next;
            });
          }}
        />
      )}
      {versionModalOpen && selectedProject && (
        <DesignVersionModal
          projectName={selectedProject.name}
          state={versionState}
          busy={busy === 'version'}
          selectedHash={selectedVersionHash}
          commitOpen={versionCommitOpen}
          authorName={versionAuthorName}
          authorEmail={versionAuthorEmail}
          note={versionNote}
          branchTarget={versionBranchTarget}
          commitIntent={versionCommitIntent}
          panelError={versionPanelError}
          onClose={() => {
            setVersionModalOpen(false);
            cancelVersionCommitForm();
            setVersionBranchTarget(undefined);
          }}
          onRefresh={() => void reloadVersionModal()}
          onSelect={setSelectedVersionHash}
          onOpenCommit={openVersionCommitForm}
          onCancelCommit={cancelVersionCommitForm}
          onAuthorNameChange={setVersionAuthorName}
          onAuthorEmailChange={setVersionAuthorEmail}
          onNoteChange={setVersionNote}
          onCommit={() => void submitVersionCommit()}
          onRequestBranch={requestVersionBranch}
          onCancelBranch={() => setVersionBranchTarget(undefined)}
          onChangeBranchTarget={changeVersionBranchTarget}
          onConfirmBranch={(target) => void submitVersionBranch(target)}
        />
      )}
      {referenceImportOpen && (
        <div className="run-modal-overlay" onMouseDown={() => setReferenceImportOpen(false)}>
          <div className="run-modal design-reference-import-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="run-modal-head">
              <div>
                <div className="label">{t('design.reference.title')}</div>
                <h2>{t('design.reference.importTitle')}</h2>
              </div>
              <button className="close" onClick={() => setReferenceImportOpen(false)} title={t('common.close')}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="run-modal-body">
              <div className="design-import-box modal">
                <div className="segmented">
                  <button className={importMode === 'git' ? 'active' : ''} onClick={() => setImportMode('git')}>{t('design.reference.git')}</button>
                  <button className={importMode === 'copy' ? 'active' : ''} onClick={() => setImportMode('copy')}>{t('design.reference.copy')}</button>
                </div>
                <input className="input" value={name} onInput={(event) => setName(event.currentTarget.value)} placeholder={t('design.reference.name')} />
                <input
                  className="input"
                  value={source}
                  onInput={(event) => setSource(event.currentTarget.value)}
                  placeholder={importMode === 'git' ? t('design.reference.gitUrl') : t('design.reference.localPath')}
                />
                {importMode === 'git' && (
                  <input className="input" value={branch} onInput={(event) => setBranch(event.currentTarget.value)} placeholder={t('design.reference.branch')} />
                )}
                <button className="btn primary" disabled={!source.trim() || Boolean(busy)} onClick={submitImport}>
                  {busy === 'import' ? <Icon name="loader" size={12} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="plus" size={12} />}
                  {t('design.reference.import')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DesignVersionModal(props: {
  projectName: string;
  state: DesignVersionState | undefined;
  busy: boolean;
  selectedHash: string;
  commitOpen: boolean;
  authorName: string;
  authorEmail: string;
  note: string;
  branchTarget: VersionBranchTarget | undefined;
  commitIntent: VersionCommitIntent;
  panelError: string;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (hash: string) => void;
  onOpenCommit: () => void;
  onCancelCommit: () => void;
  onAuthorNameChange: (value: string) => void;
  onAuthorEmailChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCommit: () => void;
  onRequestBranch: (hash: string) => void;
  onCancelBranch: () => void;
  onChangeBranchTarget: (target: VersionBranchTarget) => void;
  onConfirmBranch: (target: VersionBranchTarget) => void;
}) {
  const { t } = useI18n();
  const state = props.state;
  const commitIntent = props.commitIntent;
  const selectedCommit = state?.commits.find((commit) => commit.hash === props.selectedHash) ?? state?.commits[0];
  const canRecord = Boolean(state?.gitAvailable && (!state.initialized || state.dirty));
  const selectedIsCurrent = Boolean(state?.currentHead && selectedCommit?.hash === state.currentHead);
  const canBranch = Boolean(state?.gitAvailable && state.initialized && selectedCommit && !selectedIsCurrent);
  const recordLabel = state?.initialized ? t('design.version.record') : t('design.version.recordFirst');
  const commitIntentTarget = commitIntent.type === 'branch-after-record'
    ? state?.commits.find((commit) => commit.hash === commitIntent.commitHash)
    : undefined;
  return (
    <div className="run-modal-overlay" onMouseDown={props.onClose}>
      <div className="run-modal design-version-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="run-modal-head design-version-head">
          <div>
            <div className="label">{props.projectName}</div>
            <h2>{t('design.version.title')}</h2>
          </div>
          <div className="design-version-head-actions">
            {state?.gitVersion && <span className="design-version-git">{state.gitVersion}</span>}
            <button className="icon-btn" disabled={props.busy} onClick={props.onRefresh} title={t('common.refresh')}>
              {props.busy ? <Icon name="loader" size={13} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="rotate" size={13} />}
            </button>
            <button className="close" onClick={props.onClose} title={t('common.close')}>
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>

        <div className="run-modal-body design-version-body">
          {!state ? (
            <div className="design-version-empty">{t('common.loading')}</div>
          ) : !state.gitAvailable ? (
            <div className="design-version-git-missing">
              <Icon name="terminal" size={18} />
              <div>
                <div className="design-section-title">{t('design.version.gitMissingTitle')}</div>
                <p>{t('design.version.gitMissing')}</p>
              </div>
            </div>
          ) : (
            <>
              <section className="design-version-tree-panel">
                <div className="design-version-status-row">
                  <span className={`design-version-status ${state.dirty ? 'dirty' : 'clean'}`}>
                    {state.initialized
                      ? state.dirty ? t('design.version.dirty') : t('design.version.clean')
                      : t('design.version.notInitialized')}
                  </span>
                  {state.currentBranch && <span className="design-version-branch-pill">{state.currentBranch}</span>}
                </div>
                {state.commits.length === 0 ? (
                  <div className="design-version-empty">{t('design.version.empty')}</div>
                ) : (
                  <DesignVersionGraph
                    commits={state.commits}
                    selectedHash={selectedCommit?.hash ?? ''}
                    currentHead={state.currentHead}
                    onSelect={props.onSelect}
                  />
                )}
              </section>

              <section className="design-version-detail-panel">
                {selectedCommit ? (
                  <>
                    <div className="design-version-detail-card">
                      <div className="design-section-title">{t('design.version.selected')}</div>
                      <div className="design-version-detail-title">{versionCommitTitle(selectedCommit)}</div>
                      <div className="design-version-detail-grid">
                        <span>{t('design.version.hash')}</span><code>{selectedCommit.shortHash}</code>
                        <span>{t('design.version.utc')}</span><code>{selectedCommit.versionCode ?? selectedCommit.authoredAt}</code>
                        <span>{t('design.version.author')}</span><code>{selectedCommit.authorName} &lt;{selectedCommit.authorEmail}&gt;</code>
                        <span>{t('design.version.parents')}</span><code>{selectedCommit.parentHashes.length ? selectedCommit.parentHashes.map((hash) => hash.slice(0, 8)).join(', ') : t('design.version.none')}</code>
                      </div>
                      {selectedCommit.branches.length > 0 && (
                        <div className="design-version-detail-branches">
                          {selectedCommit.branches.map((branch) => <span key={branch}>{branch}</span>)}
                        </div>
                      )}
                    </div>

                    <div className="design-version-detail-card">
                      <div className="design-section-title">{t('design.version.continue')}</div>
                      {selectedIsCurrent ? (
                        <p className="design-version-muted">{t('design.version.currentVersion')}</p>
                      ) : props.branchTarget?.commitHash === selectedCommit.hash ? (
                        <div className="design-version-confirm">
                          {selectedCommit.branches.length > 0 ? (
                            <>
                              <p>{t('design.version.checkoutConfirm', {
                                branch: props.branchTarget.branchName ?? selectedCommit.branches[0] ?? '',
                                version: versionCommitTitle(selectedCommit),
                              })}</p>
                              {selectedCommit.branches.length > 1 && (
                                <select
                                  className="select-box"
                                  value={props.branchTarget.branchName ?? selectedCommit.branches[0] ?? ''}
                                  disabled={props.busy}
                                  onChange={(event) => props.onChangeBranchTarget({ commitHash: selectedCommit.hash, branchName: event.target.value })}
                                >
                                  {selectedCommit.branches.map((branch) => (
                                    <option key={branch} value={branch}>{branch}</option>
                                  ))}
                                </select>
                              )}
                            </>
                          ) : (
                            <p>{t('design.version.branchConfirm', { version: versionCommitTitle(selectedCommit) })}</p>
                          )}
                          <div>
                            <button className="btn sm" disabled={props.busy} onClick={props.onCancelBranch}>{t('common.cancel')}</button>
                            <button className="btn sm primary" disabled={props.busy} onClick={() => props.onConfirmBranch(props.branchTarget!)}>
                              {props.busy ? <Icon name="loader" size={11} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="route" size={11} />}
                              {selectedCommit.branches.length > 0 ? t('design.version.checkoutConfirmButton') : t('design.version.branchConfirmButton')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {state.dirty && <p className="design-version-muted">{t('design.version.branchDirty')}</p>}
                          <button className="btn sm ghost" disabled={!canBranch || props.busy} onClick={() => props.onRequestBranch(selectedCommit.hash)}>
                            <Icon name="route" size={11} />{t('design.version.branchFrom')}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="design-version-empty">{t('design.version.noSelection')}</div>
                )}
              </section>
            </>
          )}
        </div>

        {props.commitOpen && state?.gitAvailable && (
          <div className="design-version-commit-panel">
            {(props.panelError || commitIntent.type === 'branch-after-record') && (
              <div className={`design-version-commit-message${props.panelError ? ' error' : ' warning'}`}>
                {props.panelError || t('design.version.recordBeforeBranch', {
                  version: commitIntentTarget ? versionCommitTitle(commitIntentTarget) : t('design.version.selected'),
                })}
              </div>
            )}
            {commitIntent.type === 'branch-after-record' && commitIntentTarget && commitIntentTarget.branches.length > 1 && (
              <label className="field design-version-branch-select-field">
                <div className="field-label">{t('design.version.targetBranch')}</div>
                <select
                  className="select-box"
                  value={commitIntent.branchName ?? commitIntentTarget.branches[0] ?? ''}
                  disabled={props.busy}
                  onChange={(event) => props.onChangeBranchTarget({
                    commitHash: commitIntent.commitHash,
                    branchName: event.target.value,
                  })}
                >
                  {commitIntentTarget.branches.map((branch) => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <div className="field-label">{t('design.version.authorName')}</div>
              <input className="input" value={props.authorName} disabled={props.busy} onInput={(event) => props.onAuthorNameChange(event.currentTarget.value)} placeholder="Aflow Designer" />
            </label>
            <label className="field">
              <div className="field-label">{t('design.version.authorEmail')}</div>
              <input className="input" value={props.authorEmail} disabled={props.busy} onInput={(event) => props.onAuthorEmailChange(event.currentTarget.value)} placeholder="designer@example.com" />
            </label>
            <label className="field design-version-note-field">
              <div className="field-label">{t('design.version.note')}</div>
              <input className="input" value={props.note} disabled={props.busy} maxLength={160} onInput={(event) => props.onNoteChange(event.currentTarget.value)} placeholder={t('design.version.notePlaceholder')} />
            </label>
            <button className="btn primary" disabled={props.busy || !props.authorName.trim() || !props.authorEmail.trim()} onClick={props.onCommit}>
              {props.busy ? <Icon name="loader" size={12} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="check" size={12} />}
              {commitIntent.type === 'branch-after-record' ? t('design.version.recordAndContinue') : t('design.version.recordSubmit')}
            </button>
          </div>
        )}

        <div className="run-modal-actions design-version-actions">
          <div className="design-version-action-meta">
            {state?.gitAvailable
              ? state.initialized
                ? commitIntent.type === 'branch-after-record'
                  ? t('design.version.branchAfterRecordHint')
                  : state.dirty ? t('design.version.dirtyHint') : t('design.version.cleanHint')
                : t('design.version.initHint')
              : t('design.version.gitMissingShort')}
          </div>
          <button className="btn" disabled={props.busy} onClick={props.onClose}>{t('common.close')}</button>
          {props.commitOpen ? (
            <button className="btn" disabled={props.busy} onClick={props.onCancelCommit}>
              {t('common.cancel')}
            </button>
          ) : (
            <button className="btn primary" disabled={!canRecord || props.busy} onClick={props.onOpenCommit}>
              <Icon name="history" size={12} />{recordLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type VersionGraphContinuingLane = {
  hash: string;
  fromLane: number;
  toLane: number;
};

type VersionGraphRow = {
  commit: DesignVersionCommit;
  lane: number;
  startsHere: boolean;
  lanesBefore: string[];
  lanesAfter: string[];
  parentLanes: number[];
  continuing: VersionGraphContinuingLane[];
};

const VERSION_GRAPH_LANE_GAP = 14;
const VERSION_GRAPH_LANE_OFFSET = 10;
const VERSION_GRAPH_ROW_HEIGHT = 32;
const VERSION_GRAPH_COLORS = [
  '#45a85a',
  '#5b6ee1',
  '#28a99e',
  '#9b63d9',
  '#d28b32',
  '#d95f8d',
  '#3f8fce',
  '#91a64a',
];

function DesignVersionGraph({
  commits,
  selectedHash,
  currentHead,
  onSelect,
}: {
  commits: DesignVersionCommit[];
  selectedHash: string;
  currentHead?: string;
  onSelect: (hash: string) => void;
}) {
  const rows = useMemo(() => buildVersionGraphRows(commits), [commits]);
  const laneCount = Math.max(1, ...rows.map((row) => Math.max(row.lanesBefore.length, row.lanesAfter.length, row.lane + 1)));
  const graphWidth = VERSION_GRAPH_LANE_OFFSET * 2 + laneCount * VERSION_GRAPH_LANE_GAP;
  return (
    <div className="design-version-tree" style={{ '--version-graph-width': `${graphWidth}px` } as CSSProperties}>
      {rows.map((row) => (
        <button
          key={row.commit.hash}
          type="button"
          className={`design-version-node${row.commit.hash === selectedHash ? ' selected' : ''}${row.commit.hash === currentHead ? ' head' : ''}`}
          onClick={() => onSelect(row.commit.hash)}
          title={row.commit.message}
        >
          <span className="design-version-graph-cell" aria-hidden="true">
            <VersionGraphSvg row={row} laneCount={laneCount} />
          </span>
          <span className="design-version-node-title">
            <span>{versionGraphTitle(row.commit)}</span>
            {row.commit.branches.length > 0 && (
              <span className="design-version-branch-list compact">
                {row.commit.branches.slice(0, 2).map((branch) => <span key={branch}>{branch}</span>)}
                {row.commit.branches.length > 2 && <span>+{row.commit.branches.length - 2}</span>}
              </span>
            )}
          </span>
          <span className="design-version-node-author">{row.commit.authorName || 'unknown'}</span>
          <span className="design-version-node-time">{formatVersionListTime(row.commit.authoredAt)}</span>
        </button>
      ))}
    </div>
  );
}

function VersionGraphSvg({ row, laneCount }: { row: VersionGraphRow; laneCount: number }) {
  const width = VERSION_GRAPH_LANE_OFFSET * 2 + laneCount * VERSION_GRAPH_LANE_GAP;
  const mid = VERSION_GRAPH_ROW_HEIGHT / 2;
  const targetCurveLanes = new Set<number>([
    ...row.parentLanes.filter((lane) => lane !== row.lane),
    ...row.continuing.filter((lane) => lane.fromLane !== lane.toLane).map((lane) => lane.toLane),
  ]);
  return (
    <svg className="design-version-graph-svg" width={width} height={VERSION_GRAPH_ROW_HEIGHT} viewBox={`0 0 ${width} ${VERSION_GRAPH_ROW_HEIGHT}`}>
      {row.lanesBefore.map((hash, lane) => {
        if (row.startsHere && lane === row.lane) return null;
        return <path key={`top-${hash}-${lane}`} d={linePath(laneX(lane), 0, laneX(lane), mid)} stroke={laneColor(lane)} />;
      })}
      {row.lanesAfter.map((hash, lane) => {
        if (targetCurveLanes.has(lane)) return null;
        return <path key={`bottom-${hash}-${lane}`} d={linePath(laneX(lane), mid, laneX(lane), VERSION_GRAPH_ROW_HEIGHT)} stroke={laneColor(lane)} />;
      })}
      {row.continuing.map((lane) => lane.fromLane === lane.toLane ? null : (
        <path
          key={`shift-${lane.hash}-${lane.fromLane}-${lane.toLane}`}
          d={curvePath(laneX(lane.fromLane), mid, laneX(lane.toLane), VERSION_GRAPH_ROW_HEIGHT)}
          stroke={laneColor(lane.toLane)}
        />
      ))}
      {row.parentLanes.map((parentLane) => parentLane === row.lane ? null : (
        <path
          key={`parent-${row.commit.hash}-${parentLane}`}
          d={curvePath(laneX(row.lane), mid, laneX(parentLane), VERSION_GRAPH_ROW_HEIGHT)}
          stroke={laneColor(parentLane)}
        />
      ))}
      <circle
        className="design-version-graph-dot"
        cx={laneX(row.lane)}
        cy={mid}
        r={row.commit.isHead ? 5 : 4.2}
        fill={laneColor(row.lane)}
      />
      {row.commit.isHead && <circle className="design-version-graph-dot-ring" cx={laneX(row.lane)} cy={mid} r={7.2} />}
    </svg>
  );
}

function buildVersionGraphRows(commits: DesignVersionCommit[]): VersionGraphRow[] {
  const knownHashes = new Set(commits.map((commit) => commit.hash));
  let lanes: string[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    const startsHere = lane < 0;
    if (startsHere) {
      lanes = [...lanes, commit.hash];
      lane = lanes.length - 1;
    }
    const lanesBefore = [...lanes];
    const parents = uniqueStrings(commit.parentHashes.filter((hash) => knownHashes.has(hash)));
    let lanesAfter = lanesBefore.filter((hash) => hash !== commit.hash);
    if (parents.length > 0) {
      const [firstParent, ...otherParents] = parents;
      lanesAfter = lanesAfter.filter((hash) => hash !== firstParent);
      lanesAfter.splice(Math.min(lane, lanesAfter.length), 0, firstParent);
      for (const parent of otherParents) {
        if (lanesAfter.includes(parent)) continue;
        const insertAt = Math.min(lane + 1, lanesAfter.length);
        lanesAfter.splice(insertAt, 0, parent);
      }
    }
    const parentLanes = parents
      .map((parent) => lanesAfter.indexOf(parent))
      .filter((parentLane) => parentLane >= 0);
    const continuing = lanesBefore.flatMap((hash, fromLane): VersionGraphContinuingLane[] => {
      if (hash === commit.hash) return [];
      const toLane = lanesAfter.indexOf(hash);
      if (toLane < 0 || toLane === fromLane) return [];
      return [{ hash, fromLane, toLane }];
    });
    const row: VersionGraphRow = {
      commit,
      lane,
      startsHere,
      lanesBefore,
      lanesAfter,
      parentLanes,
      continuing,
    };
    lanes = lanesAfter;
    return row;
  });
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function laneX(lane: number): number {
  return VERSION_GRAPH_LANE_OFFSET + lane * VERSION_GRAPH_LANE_GAP;
}

function laneColor(lane: number): string {
  return VERSION_GRAPH_COLORS[lane % VERSION_GRAPH_COLORS.length]!;
}

function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(5, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

function StartDesignSessionModal(props: {
  projectName: string;
  busy: boolean;
  agentServers: AgentServerEntry[];
  agentServerId: string;
  capabilities: AgentServerCapabilities | undefined;
  modeId: string;
  configOptions: Record<string, string | boolean>;
  chatPanelCompact: boolean;
  capabilityRefreshing: boolean;
  onClose: () => void;
  onStart: () => void;
  onAgentChange: (value: string) => void;
  onRefreshCapabilities: () => Promise<void>;
  onChangeMode: (modeId: string | undefined) => void;
  onChangeConfigOption: (configId: string, value: string | boolean | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="run-modal-overlay" onMouseDown={props.onClose}>
      <div className="run-modal design-start-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="run-modal-head">
          <div>
            <div className="label">{props.projectName}</div>
            <h2>{t('design.start.title')}</h2>
          </div>
          <button className="close" onClick={props.onClose} title={t('common.close')}>
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="run-modal-body design-start-body">
          <label className="field">
            <div className="field-label">{t('design.agentServer')}</div>
            <select className="select-box" value={props.agentServerId} disabled={props.busy} onChange={(event) => props.onAgentChange(event.target.value)}>
              <option value="">{t('design.agentSelect')}</option>
              {props.agentServers.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.id}</option>
              ))}
            </select>
          </label>
          <div className="design-start-acp-row">
            <DesignAcpControls
              capabilities={props.capabilities}
              modeId={props.modeId}
              configOptions={props.configOptions}
              compact={props.chatPanelCompact}
              disabled={!props.agentServerId || props.busy}
              refreshing={props.capabilityRefreshing}
              onRefresh={props.onRefreshCapabilities}
              onChangeMode={props.onChangeMode}
              onChangeConfigOption={props.onChangeConfigOption}
            />
          </div>
        </div>
        <div className="run-modal-actions">
          <button className="btn" disabled={props.busy} onClick={props.onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={props.busy || !props.agentServerId} onClick={props.onStart}>
            {props.busy ? <Icon name="loader" size={12} style={{ animation: 'spin 1.4s linear infinite' }} /> : <Icon name="play-circle" size={12} />}
            {t('design.chat.startDesign')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DesignInitializingView({ step }: { step: DesignInitializingStep }) {
  const { t } = useI18n();
  const activeText = step === 'ready'
    ? t('design.init.ready')
    : step === 'negotiating'
      ? t('design.init.negotiating')
      : t('design.init.connecting');
  return (
    <div className="design-initializing">
      <div className="design-flow-loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="design-initializing-title">{activeText}</div>
      <div className="design-initializing-subtitle">{t('design.init.preparing')}</div>
    </div>
  );
}

function DesignMessageView({ message, projectName }: { message: DesignChatMessage; projectName?: string }) {
  const { t } = useI18n();
  return (
    <div className={`design-message ${message.role}`}>
      {message.role === 'user' && <div className="design-message-role">{t('design.chat.user')}</div>}
      <div className="design-message-body">
        {message.attachments?.length && projectName ? (
          <div className="design-message-attachments">
            {message.attachments.map((attachment) => (
              <img key={attachment.id} src={designProjectFileUrl(projectName, attachment.path)} alt={attachment.name} />
            ))}
          </div>
        ) : null}
        {message.role === 'assistant' ? <MarkdownText text={message.text} /> : message.text}
      </div>
    </div>
  );
}

function DesignActivityLine({ entry, active }: { entry: DesignLogEntry; active: boolean }) {
  const { t } = useI18n();
  return (
    <div className="design-activity-line" aria-label={t('design.logs.title')}>
      <span className={`design-activity-pulse${active ? ' active' : ''}`} />
      <span>{activityText(entry, t)}</span>
      {active && <span className="design-activity-dots" aria-hidden="true"><span /> <span /> <span /></span>}
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="design-markdown">
      {parseMarkdownBlocks(text).map((block, index) => {
        if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
        if (block.type === 'heading') {
          const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return <Heading key={index}>{renderInlineMarkdown(block.text)}</Heading>;
        }
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
            </ul>
          );
        }
        return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

function PropertyTextInput(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="design-property-field">
      <span>{props.label}</span>
      <input
        className="input"
        value={props.value}
        placeholder={props.placeholder}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function PropertyReadOnly(props: {
  label: string;
  value?: string | number;
}) {
  return (
    <div className="design-property-field readonly">
      <span>{props.label}</span>
      <output>{props.value === undefined || props.value === '' ? '-' : props.value}</output>
    </div>
  );
}

function PropertyNumberInput(props: {
  label: string;
  value: string;
  unit: 'px' | '%';
  raw?: boolean;
  onChange: (value: string) => void;
}) {
  const numeric = numericPropertyValue(props.value, props.unit);
  const scrubRef = useRef<{ startX: number; startValue: number } | null>(null);
  const applyNumericValue = (next: number) => {
    props.onChange(props.raw ? String(next) : props.unit === '%' ? String(next / 100) : `${next}px`);
  };
  return (
    <label className="design-property-field number">
      <span
        className="design-property-scrubber"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubRef.current = { startX: event.clientX, startValue: numeric };
        }}
        onPointerMove={(event) => {
          const scrub = scrubRef.current;
          if (!scrub) return;
          const step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          applyNumericValue(Math.round((scrub.startValue + (event.clientX - scrub.startX) * step) * 10) / 10);
        }}
        onPointerUp={(event) => {
          scrubRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          scrubRef.current = null;
        }}
      >
        {props.label}
      </span>
      <input
        type="number"
        className="input"
        value={numeric}
        step={props.unit === '%' ? 1 : 0.5}
        onInput={(event) => {
          const next = Number(event.currentTarget.value);
          if (!Number.isFinite(next)) {
            props.onChange('');
            return;
          }
          applyNumericValue(next);
        }}
      />
      <output>{Math.round(numeric)}{props.unit}</output>
    </label>
  );
}

function numericPropertyValue(value: string, unit: 'px' | '%'): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return unit === '%' && parsed <= 1 ? Math.round(parsed * 100) : parsed;
}

function formatNumberValue(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : '';
}

function designProjectFileUrl(projectName: string, filePath: string): string {
  return `/api/design/projects/${encodeURIComponent(projectName)}/files/${encodeURIComponent(filePath)}`;
}

function activityText(entry: DesignLogEntry, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (entry.kind === 'prompt') return t('design.logs.promptPublic');
  if (entry.kind === 'terminal') return entry.stream === 'stderr' ? t('design.logs.terminalError') : t('design.logs.terminalPublic');
  if (entry.kind === 'lifecycle') return lifecycleText(entry.eventType, t);
  if (entry.kind === 'error') return entry.text ?? t('design.logs.error');
  return entry.title ?? entry.eventType ?? entry.kind;
}

function lifecycleText(type: string | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (type === 'process_started') return t('design.init.connecting');
  if (type === 'initialized') return t('design.init.initialized');
  if (type === 'session_created' || type === 'session_forked') return t('design.init.sessionReady');
  if (type === 'prompt_started') return t('design.init.negotiating');
  if (type === 'prompt_stopped') return t('design.init.ready');
  if (type === 'prompt_failed') return t('design.logs.error');
  return type ?? t('design.logs.terminalPublic');
}

function isHiddenMemoryEntry(entry: DesignLogEntry): boolean {
  return entry.phase === 'memory';
}

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | undefined;
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push({ type: 'code', text: code.join('\n') });
        code = undefined;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const headingMatch = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: headingMatch[1]!.length as 1 | 2 | 3, text: headingMatch[2]!.trim() });
      continue;
    }
    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      list.push(listMatch[1]!.trim());
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code) blocks.push({ type: 'code', text: code.join('\n') });
  flushParagraph();
  flushList();
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text }];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const output: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > index) output.push(text.slice(index, match.index));
    if (match[2]) output.push(<strong key={match.index}>{match[2]}</strong>);
    else if (match[3]) output.push(<code key={match.index}>{match[3]}</code>);
    index = match.index + match[0].length;
  }
  if (index < text.length) output.push(text.slice(index));
  return output;
}

function FocusedComponentTreeView({
  roots,
  selectedComponent,
  selectedId,
  path,
  onSelect,
}: {
  roots: DesignComponentNode[] | undefined;
  selectedComponent: DesignComponentNode;
  selectedId: string;
  path?: DesignComponentNode[];
  onSelect: (node: DesignComponentNode) => void;
}) {
  const rows = focusedComponentTreeRows(roots, selectedComponent, path);
  if (rows.length === 0) {
    return <div className="design-properties-empty">{selectedComponent.name}</div>;
  }
  return (
    <div className="design-hierarchy-tree-box">
      {rows.map(({ node, depth, relation }) => (
        <button
          key={`${relation}-${node.id}`}
          type="button"
          className={`design-tree-node focused${node.id === selectedId ? ' active' : ''}${relation === 'child' ? ' child' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onSelect(node)}
          title={node.selector ?? node.id}
        >
          <span>{node.name}</span>
          <span>{node.type ?? node.id}</span>
        </button>
      ))}
    </div>
  );
}

function ComponentTreeNodeView({
  node,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: DesignComponentNode;
  selectedId: string;
  onSelect: (node: DesignComponentNode) => void;
  depth?: number;
}) {
  return (
    <>
      <button
        type="button"
        className={`design-tree-node${node.id === selectedId ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(node)}
        title={node.selector ?? node.id}
      >
        <span>{node.name}</span>
        <span>{node.type ?? node.id}</span>
      </button>
      {node.children?.map((child) => (
        <ComponentTreeNodeView
          key={child.id}
          node={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function versionCommitTitle(commit: DesignVersionCommit): string {
  return commit.versionCode ?? commit.message ?? commit.shortHash;
}

function preferredBranchName(state: DesignVersionState | undefined, commitHash: string): string | undefined {
  const commit = state?.commits.find((item) => item.hash === commitHash);
  return commit?.branches[0];
}

function versionGraphTitle(commit: DesignVersionCommit): string {
  return commit.note || commit.message || commit.versionCode || commit.shortHash;
}

function formatVersionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace(".000Z", "Z");
}

function formatVersionListTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function artifactHasView(artifact: DesignArtifact | undefined, tab: DesignArtifactTab): boolean {
  if (!artifact) return false;
  return Boolean(artifact.frames?.some((frame) => tab === 'html' ? Boolean(frame.designPath) : Boolean(frame.designPath || frame.wireframePath)));
}

function visibleSessionLogs(liveLogs: DesignLogEntry[], savedLogs: DesignLogEntry[] | undefined): DesignLogEntry[] {
  return liveLogs.length > 0 ? liveLogs : savedLogs ?? [];
}

function designThreadItems(
  logs: DesignLogEntry[],
  pendingUserMessage: DesignChatMessage | undefined,
  busy: boolean,
): DesignThreadItem[] {
  const visibleLogs = logs.filter((entry) => !isHiddenMemoryEntry(entry));
  const latestActivityId = [...visibleLogs].reverse()
    .find((entry) => isActivityEntry(entry))?.id;
  const items: DesignThreadItem[] = [];
  for (const entry of visibleLogs) {
    if ((entry.kind === 'user' || entry.kind === 'assistant') && entry.text?.trim()) {
      items.push({
        type: 'message',
        message: {
          id: entry.id,
          role: entry.kind === 'user' ? 'user' : 'assistant',
          text: entry.text,
          at: entry.at,
        },
      });
    } else if (isActivityEntry(entry)) {
      items.push({ type: 'activity', entry, active: busy && entry.id === latestActivityId });
    }
  }
  if (
    pendingUserMessage
    && !items.some((item) => item.type === 'message' && item.message.role === 'user' && item.message.text === pendingUserMessage.text)
  ) {
    items.push({ type: 'message', message: pendingUserMessage });
  }
  return items;
}

function isActivityEntry(entry: DesignLogEntry): boolean {
  if (entry.kind === 'terminal' || entry.kind === 'error') return true;
  if (entry.kind !== 'lifecycle') return false;
  return entry.eventType === 'prompt_failed' || entry.eventType === 'prompt_cancelled';
}

function findComponentNode(nodes: DesignComponentNode[] | undefined, id: string): DesignComponentNode | undefined {
  if (!nodes || !id) return undefined;
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findComponentNode(node.children, id);
    if (child) return child;
  }
  return undefined;
}

function findComponentPath(nodes: DesignComponentNode[] | undefined, id: string): DesignComponentNode[] | undefined {
  if (!nodes || !id) return undefined;
  for (const node of nodes) {
    if (node.id === id) return [node];
    const childPath = findComponentPath(node.children, id);
    if (childPath) return [node, ...childPath];
  }
  return undefined;
}

function focusedComponentTreeRows(
  roots: DesignComponentNode[] | undefined,
  selectedComponent: DesignComponentNode,
  dynamicPath: DesignComponentNode[] | undefined,
): Array<{ node: DesignComponentNode; depth: number; relation: 'ancestor' | 'selected' | 'child' }> {
  const usableDynamicPath = dynamicPath?.length && dynamicPath[dynamicPath.length - 1]?.id === selectedComponent.id
    ? dynamicPath
    : undefined;
  const staticPath = findComponentPath(roots, selectedComponent.id);
  const path = staticPath?.length ? staticPath : usableDynamicPath;
  if (path?.length) {
    const selectedFromTree = path[path.length - 1]!.id === selectedComponent.id ? selectedComponent : path[path.length - 1]!;
    return [
      ...path.map((node, index) => ({
        node: index === path.length - 1 ? selectedComponent : node,
        depth: index,
        relation: index === path.length - 1 ? 'selected' as const : 'ancestor' as const,
      })),
      ...(selectedFromTree.children ?? []).map((node) => ({
        node,
        depth: path.length,
        relation: 'child' as const,
      })),
    ];
  }
  return [
    { node: selectedComponent, depth: 0, relation: 'selected' },
    ...(selectedComponent.children ?? []).map((node) => ({ node, depth: 1, relation: 'child' as const })),
  ];
}

function componentPromptReference(component: DesignComponentNode): string {
  return [
    `<component id="${escapePromptAttr(component.id)}" name="${escapePromptAttr(component.name)}">`,
    component.description ?? component.type ?? component.id,
    '</component>',
  ].join('\n');
}

function composeChatInput(
  input: string,
  componentTree: DesignComponentNode[] | undefined,
  styleDrafts: Record<string, Record<string, string>>,
): string {
  const expandedInput = expandInlineMarkers(input.trim(), componentTree);
  const styleBlock = styleDraftBlock(styleDrafts, componentTree);
  return [expandedInput, styleBlock].filter(Boolean).join('\n\n');
}

function expandInlineMarkers(input: string, componentTree: DesignComponentNode[] | undefined): string {
  if (!input.includes('<specflow_')) return input;
  return input
    .replace(/<specflow_component\s+id="([^"]+)"(?:\s+name="[^"]*")?\s*\/>/g, (match, id: string) => {
      const component = findComponentNode(componentTree, unescapePromptAttr(id));
      return component ? componentPromptReference(component) : match;
    })
    .replace(
      /<specflow_comment\s+componentId="([^"]+)"\s+componentName="([^"]*)">([\s\S]*?)<\/specflow_comment>/g,
      (_match, id: string, name: string, comment: string) => [
        '<component-comments>',
        `  <comment componentId="${id}" componentName="${name}">`,
        `    ${comment.trim()}`,
        '  </comment>',
        '</component-comments>',
      ].join('\n'),
    );
}

function styleDraftBlock(
  styleDrafts: Record<string, Record<string, string>>,
  componentTree: DesignComponentNode[] | undefined,
): string {
  const entries = Object.entries(styleDrafts)
    .map(([id, styles]) => {
      const styleEntries = Object.entries(styles).filter(([, value]) => value.trim());
      if (styleEntries.length === 0) return undefined;
      const component = findComponentNode(componentTree, id);
      return [
        `  <style componentId="${escapePromptAttr(id)}" componentName="${escapePromptAttr(component?.name ?? id)}">`,
        ...styleEntries.map(([key, value]) => `    ${styleDraftPromptKey(key)}: ${value};`),
        '  </style>',
      ].join('\n');
    })
    .filter((entry): entry is string => Boolean(entry));
  if (entries.length === 0) return '';
  return ['<component-style-drafts>', ...entries, '</component-style-drafts>'].join('\n');
}

function styleDraftPromptKey(key: string): string {
  if (key === '__aflowX') return 'visual-x';
  if (key === '__aflowY') return 'visual-y';
  return key;
}

function escapePromptAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function unescapePromptAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function readChatPanelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(DESIGN_CHAT_WIDTH_KEY));
    if (Number.isFinite(stored)) return clampWidth(stored, DESIGN_CHAT_MIN_WIDTH, DESIGN_CHAT_MAX_WIDTH);
  } catch {
    // Browser storage is optional for the workbench.
  }
  return DESIGN_CHAT_DEFAULT_WIDTH;
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
