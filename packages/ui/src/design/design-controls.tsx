import { forwardRef, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentServerCapabilities, SkillSummary } from '../api';
import { Icon } from '../components/icon';
import { useI18n } from '../i18n';

type ConfigOption = NonNullable<AgentServerCapabilities['configOptions']>[number];

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

export const DesignSlashTextarea = forwardRef<HTMLTextAreaElement, {
  value: string;
  rows: number;
  disabled?: boolean;
  placeholder?: string;
  skills: SkillSummary[];
  availableCommands: AgentServerCapabilities['availableCommands'] | undefined;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (event: DragEvent<HTMLTextAreaElement>) => void;
}>(function DesignSlashTextarea(props, forwardedRef) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement, []);
  const [active, setActive] = useState<ActiveSlashQuery | null>(null);
  const [highlight, setHighlight] = useState(0);
  const candidates = active ? buildCandidates(props.skills, props.availableCommands, active.query) : [];

  const sync = () => {
    const element = innerRef.current;
    if (!element || props.disabled) {
      setActive(null);
      return;
    }
    setActive(findActiveSlashQuery(element.value, element.selectionStart ?? 0));
    setHighlight(0);
  };

  const accept = (candidate: SlashCandidate) => {
    const element = innerRef.current;
    if (!element || !active) return;
    const before = element.value.slice(0, active.slashIdx);
    const after = element.value.slice(element.selectionStart ?? active.queryStart);
    const insert = `/${candidate.name} `;
    props.onChange(before + insert + after);
    const caret = before.length + insert.length;
    setActive(null);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="design-slash-wrap">
      <textarea
        ref={innerRef}
        className="textarea"
        rows={props.rows}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={(event) => {
          props.onChange(event.target.value);
          requestAnimationFrame(sync);
        }}
        onKeyUp={sync}
        onClick={sync}
        onKeyDown={onKeyDown}
        onPaste={props.onPaste}
        onDrop={props.onDrop}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onBlur={() => requestAnimationFrame(() => setActive(null))}
      />
      {active && candidates.length > 0 && (
        <div className="design-slash-popup">
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
              <span className="design-slash-name">/{candidate.name}</span>
              <span className="design-slash-kind">{candidate.label}</span>
              {candidate.detail && <span className="design-slash-detail">{candidate.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export function DesignSlashWarnings(props: {
  prompt: string;
  skills: SkillSummary[];
  availableCommands: AgentServerCapabilities['availableCommands'] | undefined;
}) {
  const { t } = useI18n();
  const tokens = parseSlashTokens(props.prompt);
  if (tokens.length === 0) return null;
  const knownSkill = new Set(props.skills.map((skill) => skill.name));
  const knownCommand = new Set((props.availableCommands ?? []).map((command) => command.name));
  const issues = tokens.filter((token) => !isResolvable(token, knownSkill, knownCommand));
  if (issues.length === 0) return null;
  return (
    <div className="design-inline-warning">
      {t('node.slashWarning', { commands: issues.map((token) => `"/${token.display}"`).join(', ') })}
    </div>
  );
}

export function DesignAcpControls(props: {
  capabilities: AgentServerCapabilities | undefined;
  modeId?: string;
  configOptions: Record<string, string | boolean>;
  compact?: boolean;
  className?: string;
  disabled?: boolean;
  showMode?: boolean;
  showConfigOptions?: boolean;
  showRefresh?: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onChangeMode: (modeId: string | undefined) => void;
  onChangeConfigOption: (configId: string, value: string | boolean | undefined) => void;
}) {
  const { t } = useI18n();
  const showMode = props.showMode ?? true;
  const showConfigOptions = props.showConfigOptions ?? true;
  const showRefresh = props.showRefresh ?? true;
  const modes = props.capabilities?.modes?.availableModes ?? [];
  const options = props.capabilities?.configOptions ?? [];
  const duplicateModeOption = findDuplicateModeOption(modes, options);
  const currentMode = modes.find((mode) => mode.id === props.capabilities?.modes?.currentModeId);
  const selectedMode = modes.find((mode) => mode.id === props.modeId);
  const visibleOptions = designConfigOptions(duplicateModeOption
    ? options.filter((option) => option !== duplicateModeOption)
    : options);
  const className = ['design-acp-controls', props.compact ? 'compact' : '', props.className ?? '']
    .filter(Boolean)
    .join(' ');
  if (!props.capabilities) {
    if (!showRefresh) return null;
    return (
      <div className={className}>
        <button className="design-compose-control" disabled={props.refreshing || props.disabled} onClick={() => void props.onRefresh()} title={t('node.probeCapabilities')}>
          <Icon name="rotate" size={11} />
          <span>{props.refreshing ? t('node.refreshing') : t('design.acp.probeShort')}</span>
        </button>
      </div>
    );
  }
  if ((!showMode || modes.length === 0) && (!showConfigOptions || visibleOptions.length === 0)) return null;
  return (
    <div className={className}>
      {showMode && modes.length > 0 && (
        <DesignCompactSelect
          value={props.modeId ?? ''}
          disabled={props.disabled}
          compact={props.compact}
          title={duplicateModeOption?.name || t('node.mode')}
          displayValue={selectedMode?.name || selectedMode?.id || defaultValueLabel(currentMode?.name || currentMode?.id, t)}
          compactValue={selectedMode ? compactSelectLabel(selectedMode.name || selectedMode.id) : compactDefaultLabel(currentMode?.name || currentMode?.id, t)}
          onChange={(value) => props.onChangeMode(value || undefined)}
        >
          <option value="">{defaultValueLabel(currentMode?.name || currentMode?.id, t)}</option>
          {modes.map((mode) => (
            <option key={mode.id} value={mode.id}>{mode.name || mode.id}</option>
          ))}
        </DesignCompactSelect>
      )}
      {showConfigOptions && visibleOptions.map((option) => (
        <ConfigOptionSelect
          key={option.id}
          option={option}
          value={props.configOptions[option.id]}
          compact={props.compact}
          disabled={props.disabled}
          onChange={(value) => props.onChangeConfigOption(option.id, value)}
        />
      ))}
      {showRefresh && <button className="icon-btn design-capability-refresh" disabled={props.refreshing || props.disabled} onClick={() => void props.onRefresh()} title={t('node.refresh')}>
        <Icon name="rotate" size={12} />
      </button>}
    </div>
  );
}

function ConfigOptionSelect(props: {
  option: ConfigOption;
  value: string | boolean | undefined;
  compact?: boolean;
  disabled?: boolean;
  onChange: (value: string | boolean | undefined) => void;
}) {
  const { t } = useI18n();
  if (props.option.type === 'boolean') return null;
  const groups = selectGroups(props.option);
  const value = typeof props.value === 'string' ? props.value : '';
  const selected = findSelectOptionLabel(props.option, value);
  const designDefault = designDefaultOptionLabel(props.option);
  const current = designDefault
    ?? (typeof props.option.currentValue === 'string' ? findSelectOptionLabel(props.option, props.option.currentValue) ?? props.option.currentValue : undefined);
  return (
    <DesignCompactSelect
      value={value}
      disabled={props.disabled}
      compact={props.compact}
      title={props.option.name || props.option.id}
      displayValue={selected ?? defaultValueLabel(current, t)}
      compactValue={selected ? compactSelectLabel(selected) : compactDefaultLabel(current, t)}
      onChange={(nextValue) => props.onChange(nextValue || undefined)}
    >
      <option value="">{defaultValueLabel(current, t)}</option>
      {groups.map((group) => group.name === '__flat__'
        ? group.options.map((option) => <option key={option.value} value={option.value}>{option.name || option.value}</option>)
        : (
          <optgroup key={group.name} label={group.name}>
            {group.options.map((option) => <option key={option.value} value={option.value}>{option.name || option.value}</option>)}
          </optgroup>
        ))}
    </DesignCompactSelect>
  );
}

export function DesignCompactSelect(props: {
  value: string;
  displayValue: string;
  compactValue?: string;
  compact?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={`design-compact-select${props.disabled ? ' disabled' : ''}${props.className ? ` ${props.className}` : ''}`} title={props.title}>
      <span className="design-compact-select-value">{props.compact ? props.compactValue ?? props.displayValue : props.displayValue}</span>
      <Icon name="chevron-down" size={10} />
      <select
        className="design-compact-select-native"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.children}
      </select>
    </label>
  );
}

function designConfigOptions(options: ConfigOption[]): ConfigOption[] {
  return options.filter((option) => {
    const id = option.id.toLowerCase();
    const category = option.category?.toLowerCase() ?? '';
    return category === 'model'
      || category === 'thought_level'
      || id === 'model'
      || id === 'reasoning'
      || id.includes('reasoning')
      || id.includes('thought');
  });
}

function designDefaultOptionLabel(option: ConfigOption): string | undefined {
  if (!isReasoningOption(option)) return undefined;
  const high = findHighOption(option);
  return high?.name || high?.value;
}

function isReasoningOption(option: ConfigOption): boolean {
  const id = option.id.toLowerCase();
  const category = option.category?.toLowerCase() ?? '';
  return category === 'thought_level'
    || id === 'reasoning'
    || id.includes('reasoning')
    || id.includes('thought');
}

function findHighOption(option: ConfigOption): { value: string; name: string } | undefined {
  if (!Array.isArray(option.options)) return undefined;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      const child = entry.options.find(isHighOption);
      if (child) return child;
    } else if ('value' in entry && isHighOption(entry)) {
      return entry;
    }
  }
  return undefined;
}

function isHighOption(entry: { value: string; name: string }): boolean {
  return entry.value.trim().toLowerCase() === 'high'
    || entry.name.trim().toLowerCase() === 'high';
}

function findSelectOptionLabel(option: ConfigOption, value: string): string | undefined {
  if (!value || !Array.isArray(option.options)) return undefined;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      const child = entry.options.find((candidate) => candidate.value === value);
      if (child) return child.name || child.value;
    } else if ('value' in entry && entry.value === value) {
      return entry.name || entry.value;
    }
  }
  return undefined;
}

function defaultValueLabel(value: string | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  return value ? t('design.acp.defaultValue', { value }) : t('design.acp.auto');
}

function compactDefaultLabel(value: string | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  return value ? compactSelectLabel(value) : t('design.acp.autoShort');
}

function compactSelectLabel(value: string): string {
  const clean = value
    .replace(/^claude[-_\s]*/i, '')
    .replace(/^gpt[-_\s]*/i, '')
    .replace(/reasoning[-_\s]*/i, '')
    .trim();
  if (clean.length <= 10) return clean || value;
  const words = clean.split(/[-_\s/]+/).filter(Boolean);
  if (words.length > 1) {
    const shortWords = words.map((word) => {
      if (/^\d/.test(word)) return word;
      return word.length <= 4 ? word : word.slice(0, 4);
    });
    const joined = shortWords.join(' ');
    if (joined.length <= 14) return joined;
  }
  return clean.slice(0, 10);
}

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

function selectGroups(option: ConfigOption): Array<{ name: string; options: Array<{ value: string; name: string }> }> {
  const groups: Array<{ name: string; options: Array<{ value: string; name: string }> }> = [];
  if (!Array.isArray(option.options)) return groups;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      groups.push({ name: entry.name || entry.group, options: entry.options });
    } else if ('value' in entry) {
      if (!groups.length || groups[groups.length - 1]!.name !== '__flat__') {
        groups.push({ name: '__flat__', options: [] });
      }
      groups[groups.length - 1]!.options.push(entry);
    }
  }
  return groups;
}

function findActiveSlashQuery(text: string, caret: number): ActiveSlashQuery | null {
  let queryStart = caret;
  while (queryStart > 0 && /[A-Za-z0-9_:.-]/.test(text[queryStart - 1] ?? '')) queryStart -= 1;
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
    .map((command) => ({ name: command.name, kind: 'command', label: 'agent command', detail: command.description }));
  return [...skillItems, ...commandItems].slice(0, 12);
}

interface SlashToken { display: string; bare: string; scope?: string }

function parseSlashTokens(text: string): SlashToken[] {
  const output: SlashToken[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trimStart().match(/^\/([A-Za-z0-9_:.-]+)/);
    if (!match) continue;
    const rawValue = match[1]!;
    if (rawValue.includes('.')) continue;
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
