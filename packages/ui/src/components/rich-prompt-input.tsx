import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { AgentServerCapabilities, SkillSummary } from '../api';

export interface RichPromptInputHandle {
  focus: () => void;
  insertSerialized: (serialized: string) => void;
  setSelectionToEnd: () => void;
}

export interface RichPromptToken {
  kind: string;
  id: string;
  label: string;
  detail?: string;
  title?: string;
  serialized: string;
}

export interface RichPromptTokenMatch {
  index: number;
  end: number;
  token: RichPromptToken;
}

export interface RichPromptTokenDefinition {
  match: (value: string, start: number) => RichPromptTokenMatch | null;
}

interface RichPromptSegment {
  type: 'text' | 'token';
  text?: string;
  token?: RichPromptToken;
}

interface SlashCandidate {
  name: string;
  kind: 'skill' | 'command';
  label: string;
  detail: string;
}

interface ActiveSlashQuery {
  slashIdx: number;
  queryStart: number;
  query: string;
}

export const RichPromptInput = forwardRef<RichPromptInputHandle, {
  value: string;
  rows: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  tokenDefinitions?: RichPromptTokenDefinition[];
  skills?: SkillSummary[];
  availableCommands?: AgentServerCapabilities['availableCommands'];
  onChange: (next: string) => void;
  onSubmit?: () => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}>(function RichPromptInput(props, forwardedRef) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastRenderedValueRef = useRef<string | undefined>(undefined);
  const tokenDefinitions = useMemo(() => props.tokenDefinitions ?? [], [props.tokenDefinitions]);
  const [active, setActive] = useState<ActiveSlashQuery | null>(null);
  const [highlight, setHighlight] = useState(0);
  const candidates = active ? buildCandidates(props.skills ?? [], props.availableCommands, active.query) : [];

  const setEditorValue = (value: string, caret?: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    renderEditorValue(editor, value, tokenDefinitions, Boolean(props.disabled));
    lastRenderedValueRef.current = value;
    if (caret !== undefined) {
      requestAnimationFrame(() => setSerializedCaretOffset(editor, caret));
    }
  };

  const syncFromDom = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = serializeEditor(editor);
    lastRenderedValueRef.current = next;
    props.onChange(next);
    requestAnimationFrame(syncSlashState);
  };

  const syncSlashState = () => {
    const editor = editorRef.current;
    if (!editor || props.disabled) {
      setActive(null);
      return;
    }
    const caret = getSerializedCaretOffset(editor);
    setActive(findActiveSlashQuery(serializeEditor(editor), caret));
    setHighlight(0);
  };

  const insertSerialized = (serialized: string) => {
    const editor = editorRef.current;
    if (!editor || props.disabled) return;
    insertValueAtSelection(editor, serialized, tokenDefinitions, Boolean(props.disabled));
    syncFromDom();
    requestAnimationFrame(() => editor.focus());
  };

  useImperativeHandle(forwardedRef, () => ({
    focus: () => editorRef.current?.focus(),
    insertSerialized,
    setSelectionToEnd: () => {
      const editor = editorRef.current;
      if (!editor) return;
      setSerializedCaretOffset(editor, serializeEditor(editor).length);
      editor.focus();
    },
  }), [props.disabled, tokenDefinitions]);

  useEffect(() => {
    if (props.value === lastRenderedValueRef.current) return;
    setEditorValue(props.value);
  }, [props.value, props.disabled, tokenDefinitions]);

  const accept = (candidate: SlashCandidate) => {
    const editor = editorRef.current;
    if (!editor || !active) return;
    const value = serializeEditor(editor);
    const caret = getSerializedCaretOffset(editor);
    const insert = `/${candidate.name} `;
    const next = value.slice(0, active.slashIdx) + insert + value.slice(caret);
    const nextCaret = active.slashIdx + insert.length;
    setActive(null);
    setEditorValue(next, nextCaret);
    lastRenderedValueRef.current = next;
    props.onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      props.onSubmit?.();
      return;
    }
    if (!active || candidates.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((value) => (value + 1) % candidates.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((value) => (value - 1 + candidates.length) % candidates.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      accept(candidates[Math.min(highlight, candidates.length - 1)]!);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setActive(null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    props.onPaste?.(event);
    if (event.defaultPrevented) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    insertSerialized(text);
  };

  return (
    <div className={`rich-prompt-wrap${props.className ? ` ${props.className}` : ''}`}>
      <textarea
        className="textarea rich-prompt-shadow-textarea"
        value={props.value}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <div
        ref={editorRef}
        className="rich-prompt-input"
        contentEditable={!props.disabled}
        role="textbox"
        aria-multiline="true"
        aria-disabled={props.disabled ? 'true' : undefined}
        data-placeholder={props.placeholder ?? ''}
        data-empty={props.value ? undefined : 'true'}
        style={{ minHeight: `${Math.max(1, props.rows) * 22 + 18}px` }}
        suppressContentEditableWarning
        onInput={syncFromDom}
        onKeyDown={onKeyDown}
        onKeyUp={syncSlashState}
        onClick={syncSlashState}
        onPaste={onPaste}
        onDrop={props.onDrop}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement | null;
          const remove = target?.closest('[data-rich-prompt-token-remove]');
          if (!remove) return;
          event.preventDefault();
          const token = remove.closest('[data-rich-prompt-token]');
          token?.remove();
          syncFromDom();
          requestAnimationFrame(() => editorRef.current?.focus());
        }}
        onBlur={() => requestAnimationFrame(() => setActive(null))}
      />
      {active && candidates.length > 0 && (
        <div className="rich-prompt-slash-popup">
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.kind}:${candidate.name}`}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                accept(candidate);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={index === highlight ? 'active' : ''}
            >
              <span className="rich-prompt-slash-name">/{candidate.name}</span>
              <span className="rich-prompt-slash-kind">{candidate.label}</span>
              {candidate.detail && <span className="rich-prompt-slash-detail">{candidate.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export function variableTokenDefinition(variables: Array<{ token: string; hint?: string }>): RichPromptTokenDefinition {
  const known = new Map(variables.map((variable) => [variable.token, variable.hint]));
  return {
    match(value, start) {
      const regex = /<([^>\s]+)>/g;
      regex.lastIndex = start;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(value)) !== null) {
        const token = match[1]!;
        if (!known.has(token)) continue;
        const serialized = match[0];
        return {
          index: match.index,
          end: match.index + serialized.length,
          token: {
            kind: 'variable',
            id: token,
            label: displayPromptVariableName(token),
            title: known.get(token),
            serialized,
          },
        };
      }
      return null;
    },
  };
}

export function designComponentTokenDefinition(): RichPromptTokenDefinition {
  return regexTokenDefinition(
    /<specflow_component\s+id="([^"]+)"(?:\s+name="([^"]*)")?\s*\/>/g,
    (match, serialized) => {
      const id = unescapePromptAttr(match[1] ?? '');
      const name = unescapePromptAttr(match[2] ?? id);
      return {
        kind: 'component',
        id,
        label: name || id,
        title: id,
        serialized,
      };
    },
  );
}

export function designCommentTokenDefinition(): RichPromptTokenDefinition {
  return regexTokenDefinition(
    /<specflow_comment\s+componentId="([^"]+)"\s+componentName="([^"]*)">([\s\S]*?)<\/specflow_comment>/g,
    (match, serialized) => {
      const id = unescapePromptAttr(match[1] ?? '');
      const name = unescapePromptAttr(match[2] ?? id);
      const comment = (match[3] ?? '').trim();
      return {
        kind: 'comment',
        id,
        label: name || id,
        detail: comment,
        title: comment,
        serialized,
      };
    },
  );
}

export function displayPromptVariableName(token: string): string {
  return token.startsWith('specflow_') ? token.slice('specflow_'.length) : token;
}

function regexTokenDefinition(
  regex: RegExp,
  build: (match: RegExpExecArray, serialized: string) => Omit<RichPromptToken, 'serialized'>,
): RichPromptTokenDefinition {
  return {
    match(value, start) {
      regex.lastIndex = start;
      const match = regex.exec(value);
      if (!match) return null;
      const serialized = match[0];
      return {
        index: match.index,
        end: match.index + serialized.length,
        token: { ...build(match, serialized), serialized },
      };
    },
  };
}

function parseRichPromptSegments(value: string, definitions: RichPromptTokenDefinition[]): RichPromptSegment[] {
  const segments: RichPromptSegment[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    let best: RichPromptTokenMatch | null = null;
    for (const definition of definitions) {
      const match = definition.match(value, cursor);
      if (!match || match.end <= match.index) continue;
      if (!best || match.index < best.index || (match.index === best.index && match.end > best.end)) best = match;
    }
    if (!best) {
      segments.push({ type: 'text', text: value.slice(cursor) });
      break;
    }
    if (best.index > cursor) segments.push({ type: 'text', text: value.slice(cursor, best.index) });
    segments.push({ type: 'token', token: best.token });
    cursor = best.end;
  }
  if (segments.length === 0) segments.push({ type: 'text', text: '' });
  return segments;
}

function renderEditorValue(
  editor: HTMLDivElement,
  value: string,
  definitions: RichPromptTokenDefinition[],
  disabled: boolean,
): void {
  const fragment = editor.ownerDocument.createDocumentFragment();
  for (const segment of parseRichPromptSegments(value, definitions)) {
    if (segment.type === 'text') {
      fragment.appendChild(editor.ownerDocument.createTextNode(segment.text ?? ''));
      continue;
    }
    if (segment.token) fragment.appendChild(createTokenElement(editor.ownerDocument, segment.token, disabled));
  }
  editor.replaceChildren(fragment);
}

function createTokenElement(document: Document, token: RichPromptToken, disabled: boolean): HTMLElement {
  const element = document.createElement('span');
  element.className = `rich-prompt-token ${token.kind}`;
  element.contentEditable = 'false';
  element.dataset.richPromptToken = 'true';
  element.dataset.richPromptSerialized = token.serialized;
  element.title = token.title ?? token.detail ?? token.serialized;

  const label = document.createElement('span');
  label.className = 'rich-prompt-token-label';
  label.textContent = token.kind === 'comment' ? `Comment: ${token.label}` : token.label;
  element.appendChild(label);

  if (token.detail) {
    const detail = document.createElement('span');
    detail.className = 'rich-prompt-token-detail';
    detail.textContent = token.detail;
    element.appendChild(detail);
  }

  if (!disabled) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'rich-prompt-token-remove';
    remove.dataset.richPromptTokenRemove = 'true';
    remove.setAttribute('aria-label', 'Remove token');
    remove.textContent = 'x';
    element.appendChild(remove);
  }
  return element;
}

function serializeEditor(editor: HTMLElement): string {
  return serializeNodes(Array.from(editor.childNodes));
}

function serializeNodes(nodes: ChildNode[]): string {
  let output = '';
  for (const node of nodes) {
    if (node.nodeType === 3) {
      output += node.textContent ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as HTMLElement;
    const serialized = element.dataset.richPromptSerialized;
    if (serialized !== undefined) {
      output += serialized;
      continue;
    }
    if (element.tagName === 'BR') {
      output += '\n';
      continue;
    }
    output += serializeNodes(Array.from(element.childNodes));
    if (element.tagName === 'DIV' || element.tagName === 'P') output += '\n';
  }
  return output.replace(/\u00a0/g, ' ');
}

function insertValueAtSelection(
  editor: HTMLDivElement,
  serialized: string,
  definitions: RichPromptTokenDefinition[],
  disabled: boolean,
): void {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  const range = selection && selection.anchorNode && selection.rangeCount > 0 && editor.contains(selection.anchorNode)
    ? selection.getRangeAt(0)
    : undefined;
  const targetRange = range ?? editor.ownerDocument.createRange();
  if (!range) {
    targetRange.selectNodeContents(editor);
    targetRange.collapse(false);
  }
  targetRange.deleteContents();
  const fragment = editor.ownerDocument.createDocumentFragment();
  for (const segment of parseRichPromptSegments(serialized, definitions)) {
    if (segment.type === 'text') fragment.appendChild(editor.ownerDocument.createTextNode(segment.text ?? ''));
    else if (segment.token) fragment.appendChild(createTokenElement(editor.ownerDocument, segment.token, disabled));
  }
  const lastChild = fragment.lastChild;
  targetRange.insertNode(fragment);
  if (lastChild) {
    const nextRange = editor.ownerDocument.createRange();
    nextRange.setStartAfter(lastChild);
    nextRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
  }
}

function getSerializedCaretOffset(editor: HTMLElement): number {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection || !selection.anchorNode || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) return serializeEditor(editor).length;
  return offsetWithin(editor, selection.anchorNode, selection.anchorOffset).offset;
}

function offsetWithin(root: Node, target: Node, targetOffset: number): { offset: number; found: boolean } {
  let offset = 0;
  const walk = (node: Node): boolean => {
    if (node === target) {
      if (node.nodeType === 3) offset += targetOffset;
      else offset += serializeNodes(Array.from(node.childNodes).slice(0, targetOffset)).length;
      return true;
    }
    if (node.nodeType === 3) {
      offset += node.textContent?.length ?? 0;
      return false;
    }
    if (node.nodeType === 1 && (node as HTMLElement).dataset.richPromptSerialized !== undefined) {
      offset += (node as HTMLElement).dataset.richPromptSerialized!.length;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };
  return { offset, found: walk(root) };
}

function setSerializedCaretOffset(editor: HTMLElement, targetOffset: number): void {
  const document = editor.ownerDocument;
  const selection = document.defaultView?.getSelection();
  if (!selection) return;
  let offset = 0;
  let placed = false;
  const range = document.createRange();

  const walk = (node: Node): boolean => {
    if (node.nodeType === 3) {
      const length = node.textContent?.length ?? 0;
      if (targetOffset <= offset + length) {
        range.setStart(node, Math.max(0, targetOffset - offset));
        placed = true;
        return true;
      }
      offset += length;
      return false;
    }
    if (node.nodeType === 1 && (node as HTMLElement).dataset.richPromptSerialized !== undefined) {
      const length = (node as HTMLElement).dataset.richPromptSerialized!.length;
      if (targetOffset <= offset + length) {
        range.setStartAfter(node);
        placed = true;
        return true;
      }
      offset += length;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  };

  walk(editor);
  if (!placed) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
}

function findActiveSlashQuery(text: string, caret: number): ActiveSlashQuery | null {
  let queryStart = caret;
  while (queryStart > 0 && /[A-Za-z0-9_:.-]/.test(text[queryStart - 1])) queryStart -= 1;
  const slashIdx = queryStart - 1;
  if (slashIdx < 0 || text[slashIdx] !== '/') return null;
  const lineStart = text.lastIndexOf('\n', slashIdx - 1) + 1;
  if (text.slice(lineStart, slashIdx).trim() !== '') return null;
  return { slashIdx, queryStart, query: text.slice(queryStart, caret) };
}

function buildCandidates(
  skills: SkillSummary[],
  commands: AgentServerCapabilities['availableCommands'] | undefined,
  query: string,
): SlashCandidate[] {
  const lowercaseQuery = query.toLowerCase();
  const skillItems: SlashCandidate[] = skills
    .filter((skill) => skill.name.toLowerCase().startsWith(lowercaseQuery))
    .map((skill) => ({ name: skill.name, kind: 'skill', label: `skill · ${skill.source}`, detail: skill.description }));
  const commandItems: SlashCandidate[] = (commands ?? [])
    .filter((command) => command.name.toLowerCase().startsWith(lowercaseQuery) && !skillItems.some((skill) => skill.name === command.name))
    .map((command) => ({ name: command.name, kind: 'command', label: 'command', detail: command.description ?? command.inputHint ?? '' }));
  return [...skillItems, ...commandItems].slice(0, 8);
}

function unescapePromptAttr(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
