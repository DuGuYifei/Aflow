import type { Variable } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './icon';

interface VariablesPaletteProps {
  variables: Variable[];
  selectedName?: string;
  readonly?: boolean;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onAddVariable: () => void;
  onSelectVariable: (name: string) => void;
}

export function VariablesPalette({
  variables,
  selectedName,
  readonly,
  collapsed,
  onCollapsedChange,
  onAddVariable,
  onSelectVariable,
}: VariablesPaletteProps) {
  const { t } = useI18n();
  return (
    <div className={`variables-palette${collapsed ? ' collapsed' : ''}`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="variables-palette-head">
        <button
          className="icon-btn palette-collapse"
          title={collapsed ? t('variables.expandPalette') : t('variables.collapsePalette')}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
        </button>
        <div className="variables-palette-title">
          <span>{t('variables.paletteTitle')}</span>
          <span className="count">{variables.length}</span>
        </div>
        {!readonly && (
          <button className="icon-btn" title={t('variables.add')} onClick={onAddVariable}>
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="variables-palette-body">
          {variables.length === 0 ? (
            <button className="variables-empty-row" disabled={readonly} onClick={onAddVariable}>
              <Icon name="tag" size={11} />
              <span>{t('variables.emptyPalette')}</span>
            </button>
          ) : (
            variables.map((variable) => (
              <button
                key={variable.name}
                className={`variable-row${selectedName === variable.name ? ' selected' : ''}`}
                onClick={() => onSelectVariable(variable.name)}
                title={`<${variable.name}>`}
              >
                <span className="var-status-dot" data-required={variable.required !== false} />
                <span className="var-label">{variable.title || variable.name.replace(/^specflow_/, '')}</span>
                <span className="var-token">&lt;{variable.name}&gt;</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
