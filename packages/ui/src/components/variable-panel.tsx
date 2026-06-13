import { useEffect, useState } from 'react';
import type { Variable } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './icon';
import { RightPanel } from './right-panel';

interface VariablePanelProps {
  variable: Variable;
  variables: Variable[];
  readonly: boolean;
  onClose: () => void;
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  onRenameVariable: (oldName: string, newName: string) => void;
  onDeleteVariable: (name: string) => void;
}

function displayName(name: string): string {
  return name.startsWith('specflow_') ? name.slice('specflow_'.length) : name;
}

function fullVariableName(rawName: string): string {
  const cleaned = rawName.replace(/[^A-Za-z0-9_]/g, '');
  return cleaned.startsWith('specflow_') ? cleaned : `specflow_${cleaned}`;
}

function isVariableKey(value: string): boolean {
  return /^specflow_[A-Za-z0-9_]+$/.test(value);
}

export function VariablePanel({
  variable,
  variables,
  readonly,
  onClose,
  onEditVariable,
  onRenameVariable,
  onDeleteVariable,
}: VariablePanelProps) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState(displayName(variable.name));
  const [error, setError] = useState('');

  useEffect(() => {
    setDraftName(displayName(variable.name));
    setError('');
  }, [variable.name]);

  const commitName = (value = draftName) => {
    const nextName = fullVariableName(value.trim());
    if (nextName === variable.name) {
      setDraftName(displayName(variable.name));
      setError('');
      return;
    }
    if (!isVariableKey(nextName)) {
      setError(t('variables.keyInvalid'));
      return;
    }
    if (variables.some((candidate) => candidate.name === nextName && candidate.name !== variable.name)) {
      setError(t('variables.keyDuplicate'));
      return;
    }
    setError('');
    onRenameVariable(variable.name, nextName);
  };

  return (
    <RightPanel label={<><Icon name="tag" size={11} />{t('variables.variableLabel')}</>} title={variable.title || `<${variable.name}>`} onClose={onClose}>
      <div className="code-hint">{t('variables.globalHint')}</div>
      <div className="section-title">{t('variables.key')}</div>
      <input
        className={`input${error ? ' invalid' : ''}`}
        value={draftName}
        disabled={readonly}
        onChange={(event) => {
          setDraftName(event.target.value.replace(/[^A-Za-z0-9_]/g, ''));
          if (error) setError('');
        }}
        onBlur={(event) => commitName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitName(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            setDraftName(displayName(variable.name));
            setError('');
            event.currentTarget.blur();
          }
        }}
      />
      {error && <div className="field-error">{error}</div>}
      <div className="code-hint">
        {t('variables.referenceAs')} <code>&lt;{variable.name}&gt;</code>
      </div>

      <div className="section-title">{t('variables.title')}</div>
      <input
        className="input"
        value={variable.title ?? ''}
        disabled={readonly}
        placeholder={displayName(variable.name)}
        onChange={(event) => onEditVariable(variable.name, { title: event.target.value || undefined })}
      />

      <div className="section-title">{t('node.inputRequired')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={variable.required !== false}
          disabled={readonly}
          onChange={(event) => onEditVariable(variable.name, { required: event.target.checked ? undefined : false })}
        />
        {t('common.required')}
      </label>
      <div className="code-hint">{t('node.inputOptionalHint')}</div>

      <div className="section-title">{t('variables.defaultValue')}</div>
      <input
        className="input"
        value={variable.defaultValue ?? ''}
        disabled={readonly}
        placeholder="—"
        onChange={(event) => onEditVariable(variable.name, { defaultValue: event.target.value || undefined })}
      />

      <div className="section-title">{t('variables.description')}</div>
      <textarea
        className="textarea"
        rows={4}
        value={variable.description ?? ''}
        disabled={readonly}
        placeholder={t('variables.descriptionPlaceholder')}
        onChange={(event) => onEditVariable(variable.name, { description: event.target.value || undefined })}
      />

      {!readonly && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
          <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => onDeleteVariable(variable.name)}>
            <Icon name="trash" size={12} />{t('common.delete')}
          </button>
        </div>
      )}
    </RightPanel>
  );
}
