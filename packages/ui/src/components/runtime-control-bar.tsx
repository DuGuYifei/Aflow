import type { RunStatus } from '../types';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './icon';

interface RuntimeControlBarProps {
  status: RunStatus;
  busy?: boolean;
  onPause: () => void;
  onInterrupt: () => void;
  onPlay: () => void;
  onStop: () => void;
}

export function RuntimeControlBar({
  status,
  busy = false,
  onPause,
  onInterrupt,
  onPlay,
  onStop,
}: RuntimeControlBarProps) {
  const { t } = useI18n();
  if (status !== 'running' && status !== 'paused' && status !== 'interrupted') return null;

  const control = (
    label: string,
    icon: IconName,
    action: () => void,
    options: { primary?: boolean; danger?: boolean } = {},
  ) => (
    <button
      className={`runtime-control-button quick-tooltip${options.primary ? ' primary' : ''}${options.danger ? ' danger' : ''}`}
      data-tooltip={label}
      disabled={busy}
      aria-label={label}
      onClick={action}
    >
      <Icon name={busy ? 'loader' : icon} size={15} />
    </button>
  );

  return (
    <div className="runtime-control-bar" role="toolbar" aria-label={t('runtime.controls')}>
      {status === 'running' && (
        <>
          {control(t('runtime.pause'), 'pause', onPause)}
          {control(t('runtime.interrupt'), 'x', onInterrupt)}
          {control(t('runtime.stop'), 'trash', onStop, { danger: true })}
        </>
      )}
      {(status === 'paused' || status === 'interrupted') && (
        <>
          {control(t('runtime.play'), 'play', onPlay, { primary: true })}
          {control(t('runtime.stop'), 'trash', onStop, { danger: true })}
        </>
      )}
    </div>
  );
}
