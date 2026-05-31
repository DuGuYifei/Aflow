import type { Variable } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './icon';

interface RunConfigPanelProps {
  workflowName: string;
  variables: Variable[];
  values: Record<string, string>;
  setValue: (name: string, value: string) => void;
  onCancel: () => void;
  onStart: () => void;
  busy?: boolean;
}

export function RunConfigPanel({
  workflowName,
  variables,
  values,
  setValue,
  onCancel,
  onStart,
  busy,
}: RunConfigPanelProps) {
  const { t } = useI18n();
  const missingVariables = variables.filter((variable) => variable.required !== false && (values[variable.name] ?? variable.defaultValue ?? '').trim() === '');
  const canStart = !busy && missingVariables.length === 0;

  const handleKeyDown = (element: React.KeyboardEvent) => {
    if ((element.ctrlKey || element.metaKey) && element.key === 'Enter') {
      element.preventDefault();
      if (canStart) onStart();
    }
    if (element.key === 'Escape') onCancel();
  };

  return (
    <div className="run-modal-overlay" onMouseDown={onCancel}>
      <div className="run-modal" onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="play-circle" size={11} /> {t('runConfig.startRun')}</div>
            <h2>{workflowName}</h2>
          </div>
          <button className="close" onClick={onCancel} title={t('common.close')}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="run-modal-body">
          {variables.length > 0 && (
            <>
              <div className="section-title">
                {t('runConfig.runInputs')}
                <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {variables.length}
                </span>
              </div>
              <div className="run-var-list">
                {variables.map((variable, index) => {
                  const effective = values[variable.name] ?? variable.defaultValue ?? '';
                  const isRequired = variable.required !== false;
                  const isDefault = effective === (variable.defaultValue ?? '');
                  return (
                    <div key={variable.name} className="run-var-row">
                      <label htmlFor={`run-var-${index}`}>{variable.name}</label>
                      {isRequired && (values[variable.name] ?? variable.defaultValue ?? '').trim() === '' && (
                        <span className="run-var-required">{t('common.required')}</span>
                      )}
                      <div className="run-var-control">
                        <input
                          id={`run-var-${index}`}
                          className="input"
                          value={effective}
                          onChange={(event) => setValue(variable.name, event.target.value)}
                          autoFocus={index === 0}
                        />
                        {!isDefault && (
                          <button
                            className="btn sm ghost"
                            title={t('runConfig.resetToDefault')}
                            onClick={() => setValue(variable.name, variable.defaultValue ?? '')}
                          >
                            <Icon name="rotate" size={10} />
                          </button>
                        )}
                      </div>
                      {variable.description && <div className="hint">{variable.description}</div>}
                      {isDefault && variable.defaultValue && <div className="hint mono">{t('runConfig.defaultValue', { value: variable.defaultValue })}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {variables.length === 0 && (
            <div className="run-confirm-only">
              <Icon name="play-circle" size={18} />
              <span>{t('runConfig.noInputs')}</span>
            </div>
          )}
        </div>

        <div className="run-modal-actions">
          <button className="btn sm" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            className="btn sm primary"
            onClick={onStart}
            title={t('runConfig.startRunHotkey')}
            disabled={!canStart}
          >
            <Icon name="play-circle" size={12} />
            {busy ? t('runConfig.checkingAgents') : t('runConfig.startRun')}
          </button>
        </div>
      </div>
    </div>
  );
}
