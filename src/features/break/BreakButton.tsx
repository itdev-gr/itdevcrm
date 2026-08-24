import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coffee } from 'lucide-react';
import { hms } from '@/features/callstats/hms';
import { useMyBreakToday } from './hooks/useMyBreakToday';
import { useStartBreak, useEndBreak } from './hooks/useBreakToggle';

/** Daily break allowance (soft limit): 30 minutes. */
const ALLOWANCE_SECONDS = 30 * 60;

export function BreakButton() {
  const { t } = useTranslation('common');
  const { data, isLoading } = useMyBreakToday();
  const startBreak = useStartBreak();
  const endBreak = useEndBreak();
  const [now, setNow] = useState(() => Date.now());

  const activeStartedAt = data?.active_started_at ? Date.parse(data.active_started_at) : null;
  const onBreak = activeStartedAt !== null;

  useEffect(() => {
    if (!onBreak) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [onBreak]);

  const liveSeconds = activeStartedAt ? Math.max(0, Math.floor((now - activeStartedAt) / 1000)) : 0;
  const usedSeconds = (data?.total_seconds ?? 0) + liveSeconds;
  const remaining = ALLOWANCE_SECONDS - usedSeconds;
  const over = remaining < 0;
  const busy = startBreak.isPending || endBreak.isPending;

  const label = onBreak
    ? t('break.stop', { defaultValue: 'End break' })
    : t('break.start', { defaultValue: 'Start break' });

  return (
    <button
      type="button"
      onClick={() => {
        if (busy || isLoading) return;
        (onBreak ? endBreak : startBreak).mutate();
      }}
      disabled={isLoading}
      aria-label={label}
      title={label}
      aria-pressed={onBreak}
      className={[
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50',
        onBreak
          ? 'border-[#1a9696]/40 bg-[#1a9696]/10 text-[#157777] dark:text-[#7ad4d4]'
          : 'border-border/70 text-muted-foreground hover:bg-muted',
        over ? 'text-red-600 dark:text-red-400' : '',
      ].join(' ')}
    >
      <Coffee className={`size-3.5 ${onBreak ? 'animate-pulse' : ''}`} />
      <span className="tabular-nums">
        {over ? `+${hms(-remaining)}` : hms(remaining)}
      </span>
      {onBreak && (
        <span className="hidden sm:inline">
          {t('break.on_break', { defaultValue: 'On break' })}
        </span>
      )}
    </button>
  );
}
