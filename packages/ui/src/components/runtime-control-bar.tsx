import type { RunControlIntent, RunStatus } from '../types';
import { useI18n } from '../i18n';
import { FloatingTooltip } from './floating-tooltip';
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
    options: { primary?: boolean; success?: boolean; warning?: boolean; danger?: boolean; disabled?: boolean } = {},
  ) => (
    <FloatingTooltip content={label}>
      <button
        className={`runtime-control-button${options.primary ? ' primary' : ''}${options.success ? ' success' : ''}${options.warning ? ' warning' : ''}${options.danger ? ' danger' : ''}`}
        disabled={busy || options.disabled}
        aria-label={label}
        onClick={action}
      >
        <Icon name={busy ? 'loader' : icon} size={15} />
      </button>
    </FloatingTooltip>
  );

  return (
    <div className="runtime-control-bar" role="toolbar" aria-label={t('runtime.controls')}>
      {status === 'running' && !suspending && (
        <>
          {control(t('runtime.pause'), 'pause', onPause, { success: true })}
          {control(t('runtime.interrupt'), 'interrupt-turn', onInterrupt, { warning: true })}
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
