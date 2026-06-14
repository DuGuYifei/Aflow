import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAflowMigrationTerminal,
  resizeAflowMigrationTerminal,
  sendAflowMigrationTerminalInput,
  subscribeToAflowMigrationTerminal,
  type TerminalSessionStatus,
} from '../api';
import { useI18n } from '../i18n';
import { Icon } from './icon';
import { TerminalSurface, type TerminalSurfaceHandle } from './terminal-surface';

interface AflowMigrationTerminalModalProps {
  sessionId: string;
  workflowName: string;
  onClose: () => void;
}

export function AflowMigrationTerminalModal({ sessionId, workflowName, onClose }: AflowMigrationTerminalModalProps) {
  const { t } = useI18n();
  const terminalRef = useRef<TerminalSurfaceHandle | null>(null);
  const [status, setStatus] = useState<TerminalSessionStatus>('running');
  const [error, setError] = useState('');

  useEffect(() => {
    setStatus('running');
    setError('');
    const unsubscribe = subscribeToAflowMigrationTerminal(sessionId, (event) => {
      if (event.type === 'output') {
        terminalRef.current?.write(event.data);
        return;
      }
      setStatus(event.status);
      if (event.error) setError(event.error);
    }, () => setError(t('migration.terminalDisconnected')));
    return unsubscribe;
  }, [sessionId, t]);

  const sendInput = useCallback((data: string) => {
    void sendAflowMigrationTerminalInput(sessionId, data).catch((error) => setError(error instanceof Error ? error.message : String(error)));
  }, [sessionId]);

  const resize = useCallback((cols: number, rows: number) => {
    void resizeAflowMigrationTerminal(sessionId, cols, rows).catch(() => {});
  }, [sessionId]);

  const cancel = useCallback(async () => {
    try {
      await cancelAflowMigrationTerminal(sessionId);
    } catch {
      // Closing should still be allowed if the session already ended.
    }
    onClose();
  }, [sessionId, onClose]);

  return (
    <div className="run-modal-overlay agent-auth-terminal-overlay">
      <div className="auth-terminal-modal">
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="terminal" size={11} /> {t('migration.terminalLabel')}</div>
            <h2>{workflowName}</h2>
          </div>
          <span className={`cap-badge ${status === 'running' ? 'update' : status === 'succeeded' ? 'on' : ''}`}>
            {t(`migration.terminalStatus.${status}`)}
          </span>
        </div>
        {error && <div className="agent-server-error">{error}</div>}
        <div className="auth-terminal-frame">
          <TerminalSurface ref={terminalRef} onData={sendInput} onResize={resize} />
        </div>
        <div className="run-modal-actions">
          <button className="btn" onClick={cancel}>
            <Icon name="x" size={10} />{status === 'running' ? t('common.cancel') : t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
