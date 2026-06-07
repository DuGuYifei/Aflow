import type {
  DesignLogEntry,
  DesignMessageAttachment,
  DesignRecordVersionInput,
  DesignInitializeSessionInput,
  DesignProjectDetail,
  DesignProjectSummary,
  DesignReferenceSummary,
  DesignSession,
  DesignSessionSummary,
  DesignVersionState,
} from './types';

export interface DesignApiErrorPayload {
  error: string;
  code?: string;
  retryable?: boolean;
  status?: number;
}

export class DesignApiError extends Error {
  payload: DesignApiErrorPayload;

  constructor(payload: DesignApiErrorPayload) {
    super(payload.error);
    this.name = 'DesignApiError';
    this.payload = payload;
  }
}

export interface DesignSendMessageInput {
  sessionId?: string;
  projectName: string;
  agentServerId: string;
  message: string;
  attachments?: DesignMessageAttachment[];
  referenceName?: string;
  referenceInterfaceDescription?: string;
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
}

export async function uploadDesignImages(projectName: string, files: File[]): Promise<DesignMessageAttachment[]> {
  const body = new FormData();
  for (const file of files) body.append('files', file, file.name);
  const response = await fetch(`/api/design/projects/${encodeURIComponent(projectName)}/tmp/images`, {
    method: 'POST',
    body,
  });
  if (!response.ok) throw await apiError(response, 'Failed to upload design images');
  return response.json();
}

export interface DesignMessageStreamHandlers {
  signal?: AbortSignal;
  onLog?: (entry: DesignLogEntry) => void;
  onReady?: () => void;
}

export async function fetchDesignReferences(): Promise<DesignReferenceSummary[]> {
  const response = await fetch('/api/design/references');
  if (!response.ok) throw await apiError(response, 'Failed to fetch design references');
  return response.json();
}

export async function importDesignReference(input:
  | { type: 'git'; name: string; url: string; branch?: string }
  | { type: 'copy'; name: string; sourcePath: string }
): Promise<DesignReferenceSummary> {
  const response = await fetch('/api/design/references/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Failed to import design reference');
  return response.json();
}

export async function fetchDesignProjects(): Promise<DesignProjectSummary[]> {
  const response = await fetch('/api/design/projects');
  if (!response.ok) throw await apiError(response, 'Failed to fetch design projects');
  return response.json();
}

export async function createDesignProject(name: string): Promise<DesignProjectSummary> {
  const response = await fetch('/api/design/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await apiError(response, 'Failed to create design project');
  return response.json();
}

export async function fetchDesignProject(name: string): Promise<DesignProjectDetail> {
  const response = await fetch(`/api/design/projects/${encodeURIComponent(name)}`);
  if (!response.ok) throw await apiError(response, `Failed to fetch design project ${name}`);
  return response.json();
}

export async function fetchDesignProjectVersion(name: string): Promise<DesignVersionState> {
  const response = await fetch(`/api/design/projects/${encodeURIComponent(name)}/version`);
  if (!response.ok) throw await apiError(response, `Failed to fetch design project versions ${name}`);
  return response.json();
}

export async function recordDesignProjectVersion(name: string, input: DesignRecordVersionInput): Promise<DesignVersionState> {
  const response = await fetch(`/api/design/projects/${encodeURIComponent(name)}/version/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, `Failed to record design project version ${name}`);
  return response.json();
}

export async function branchDesignProjectVersion(name: string, commitHash: string, branchName?: string): Promise<DesignVersionState> {
  const response = await fetch(`/api/design/projects/${encodeURIComponent(name)}/version/branch-from`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commitHash, ...(branchName ? { branchName } : {}) }),
  });
  if (!response.ok) throw await apiError(response, `Failed to branch design project version ${name}`);
  return response.json();
}

export async function fetchDesignSessions(projectName?: string): Promise<DesignSessionSummary[]> {
  const query = projectName ? `?projectName=${encodeURIComponent(projectName)}` : '';
  const response = await fetch(`/api/design/sessions${query}`);
  if (!response.ok) throw await apiError(response, 'Failed to fetch design sessions');
  return response.json();
}

export async function fetchDesignSession(id: string): Promise<DesignSession> {
  const response = await fetch(`/api/design/sessions/${encodeURIComponent(id)}`);
  if (!response.ok) throw await apiError(response, `Failed to fetch design session ${id}`);
  return response.json();
}

export async function fetchDesignProjectFileText(projectName: string, filePath: string): Promise<string> {
  const response = await fetch(`/api/design/projects/${encodeURIComponent(projectName)}/files/${encodeURIComponent(filePath)}`);
  if (!response.ok) throw await apiError(response, `Failed to fetch design file ${filePath}`);
  return response.text();
}

export async function sendDesignMessage(input: DesignSendMessageInput): Promise<DesignSession> {
  const response = await fetch('/api/design/sessions/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Failed to send design message');
  return response.json();
}

export async function initializeDesignSession(input: DesignInitializeSessionInput): Promise<DesignSession> {
  const response = await fetch('/api/design/sessions/initialize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, 'Failed to initialize design session');
  return response.json();
}

export async function streamInitializeDesignSession(
  input: DesignInitializeSessionInput,
  handlers: DesignMessageStreamHandlers = {},
): Promise<DesignSession> {
  return streamDesignSession('/api/design/sessions/initialize?stream=1', input, handlers);
}

export async function streamDesignMessage(
  input: DesignSendMessageInput,
  handlers: DesignMessageStreamHandlers = {},
): Promise<DesignSession> {
  return streamDesignSession('/api/design/sessions/messages?stream=1', input, handlers);
}

async function streamDesignSession(
  url: string,
  input: DesignSendMessageInput | DesignInitializeSessionInput,
  handlers: DesignMessageStreamHandlers = {},
): Promise<DesignSession> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(input),
    signal: handlers.signal,
  });
  if (!response.ok) throw await apiError(response, 'Failed to send design message');
  if (!response.body) throw new DesignApiError({ error: 'Design message stream is not available.', status: response.status });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalSession: DesignSession | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseBuffer(buffer, (event, data) => {
      if (event === 'ready') handlers.onReady?.();
      else if (event === 'log') handlers.onLog?.(data as DesignLogEntry);
      else if (event === 'session') finalSession = data as DesignSession;
      else if (event === 'error') throw new DesignApiError(data as DesignApiErrorPayload);
    });
  }

  buffer += decoder.decode();
  consumeSseBuffer(`${buffer}\n\n`, (event, data) => {
    if (event === 'ready') handlers.onReady?.();
    else if (event === 'log') handlers.onLog?.(data as DesignLogEntry);
    else if (event === 'session') finalSession = data as DesignSession;
    else if (event === 'error') throw new DesignApiError(data as DesignApiErrorPayload);
  });

  if (!finalSession) {
    throw new DesignApiError({ error: 'Design message stream ended before the session was returned.', status: response.status });
  }
  return finalSession;
}

function consumeSseBuffer(buffer: string, onEvent: (event: string, data: unknown) => void): string {
  let remaining = buffer;
  while (true) {
    const index = remaining.indexOf('\n\n');
    if (index < 0) return remaining;
    const packet = remaining.slice(0, index);
    remaining = remaining.slice(index + 2);
    const parsed = parseSsePacket(packet);
    if (parsed) onEvent(parsed.event, parsed.data);
  }
}

function parseSsePacket(packet: string): { event: string; data: unknown } | undefined {
  const normalized = packet.replace(/\r\n/g, '\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of normalized.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (dataLines.length === 0) return undefined;
  const text = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(text) };
  } catch {
    return { event, data: text };
  }
}

async function apiError(response: Response, fallback: string): Promise<DesignApiError> {
  try {
    const body = await response.json() as Partial<DesignApiErrorPayload>;
    return new DesignApiError({
      error: body.error ?? `${fallback}: ${response.status}`,
      code: body.code,
      retryable: body.retryable,
      status: body.status ?? response.status,
    });
  } catch {
    return new DesignApiError({ error: `${fallback}: ${response.status}`, status: response.status });
  }
}
