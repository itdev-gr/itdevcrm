import { useTranslation } from 'react-i18next';
import { Phone, PhoneMissed, Timer } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMyCallStats } from './hooks/useMyCallStats';
import { hms } from './hms';

const dirIcon: Record<string, string> = { in: '↙', out: '↗', int: '↔' };

export function CallStatsWidget() {
  const { t } = useTranslation('common');
  const { data } = useMyCallStats();
  if (!data) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted lg:flex"
          title={t('callstats.today')}
        >
          <span className="flex items-center gap-1"><Phone className="size-3.5" />{data.total}</span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400"><PhoneMissed className="size-3.5" />{data.missed}</span>
          <span className="flex items-center gap-1"><Timer className="size-3.5" />{hms(data.talk_seconds)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 text-sm font-semibold">{t('callstats.today')}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row label={t('callstats.inbound')} value={data.inbound} />
          <Row label={t('callstats.outbound')} value={data.outbound} />
          <Row label={t('callstats.answered')} value={data.answered} />
          <Row label={t('callstats.missed')} value={data.missed} />
          <Row label={t('callstats.ring')} value={hms(data.ring_seconds)} />
          <Row label={t('callstats.unique')} value={data.unique_numbers} />
        </div>
        <div className="mt-3 mb-1 text-xs font-semibold text-muted-foreground">{t('callstats.recent')}</div>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
          {data.recent.length === 0 && <li className="text-muted-foreground">{t('callstats.none')}</li>}
          {data.recent.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="tabular-nums text-muted-foreground">{c.t}</span>
              <span className="flex-1 truncate">{dirIcon[c.dir] ?? ''} {c.num}</span>
              <span className="tabular-nums text-muted-foreground">{c.dur ? hms(c.dur) : '—'}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </>
  );
}
