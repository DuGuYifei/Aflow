import { useI18n } from '../i18n';
import { Icon } from './icon';

interface LegacyWorkflowModalProps {
  workflowName: string;
  busy?: boolean;
  error?: string;
  onMigrate: () => void;
  onClose: () => void;
}

export function LegacyWorkflowModal({ workflowName, busy, error, onMigrate, onClose }: LegacyWorkflowModalProps) {
  const { t } = useI18n();
  return (
    <div className="run-modal-overlay">
      <div className="run-modal legacy-workflow-modal">
        <div className="run-modal-head">
          <div>
            <div className="label"><Icon name="alert" size={11} /> {t('migration.deprecatedLabel')}</div>
            <h2>{t('migration.title')}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} title={t('common.close')}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="code-hint">{t('migration.description', { name: workflowName })}</div>
        {error && <div className="agent-server-error">{error}</div>}
        <div className="run-modal-actions">
          <button className="btn" onClick={onClose}>{t('migration.keepV1')}</button>
          <button className="btn primary" disabled={busy} onClick={onMigrate}>
            <Icon name="terminal" size={12} />{busy ? t('migration.starting') : t('migration.startWithAflow')}
          </button>
        </div>
      </div>
    </div>
  );
}
