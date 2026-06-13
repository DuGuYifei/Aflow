import type { RunControlIntent, RunStatus } from '../types';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './icon';

interface RuntimeControlBarProps {
  status: RunStatus;
  controlIntent?: RunControlIntent;
  busy?: boolean;
  onPause: () => void;
  onInterrupt: () => void;
  onPlay: () => void;
  onStop: () => void;
}

export function RuntimeControlBar({
  status,
  controlIntent,
  busy = false,
  onPause,
  onInterrupt,
  onPlay,
  onStop,
}: RuntimeControlBarProps) {
  const { t } = useI18n();
  if (status !== 'running' && status !== 'paused' && status !== 'interrupted') return null;
  const suspending = status === 'running' && Boolean(controlIntent);
  const playDisabled = busy || suspending;

  const control = (
    label: string,
    icon: IconName,
    action: () => void,
    options: { primary?: boolean; danger?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      className={`runtime-control-button quick-tooltip${options.primary ? ' primary' : ''}${options.danger ? ' danger' : ''}`}
      data-tooltip={label}
      disabled={busy || options.disabled}
      aria-label={label}
      onClick={action}
    >
      <Icon name={busy ? 'loader' : icon} size={15} />
    </button>
  );

  return (
    <div className="runtime-control-bar" role="toolbar" aria-label={t('runtime.controls')}>
      {status === 'running' && !suspending && (
        <>
          {control(t('runtime.pause'), 'pause', onPause)}
          {control(t('runtime.interrupt'), 'interrupt-turn', onInterrupt)}
          {control(t('runtime.stop'), 'stop-square', onStop, { danger: true })}
        </>
      )}
      {(suspending || status === 'paused' || status === 'interrupted') && (
        <>
          {control(suspending ? t('runtime.waitingForCheckpoint') : t('runtime.play'), 'play', onPlay, { primary: true, disabled: playDisabled })}
          {control(t('runtime.stop'), 'stop-square', onStop, { danger: true })}
        </>
      )}
    </div>
  );
}
