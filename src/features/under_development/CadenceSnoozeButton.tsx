import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlarmClock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSnoozeCadenceTask } from './hooks/useLeadCadence';

/** «Πάρε με Πέμπτη»: push an open chain task's due date without burning a
 *  step. Presets land at 10:00 local; the date field covers everything else. */
export function CadenceSnoozeButton({ taskId }: { taskId: string }) {
  const { t } = useTranslation('sales');
  const snooze = useSnoozeCadenceTask();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');

  function at10(daysFromNow: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  }

  async function apply(dueAt: string) {
    try {
      await snooze.mutateAsync({ taskId, dueAt });
      setOpen(false);
      setCustom('');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="px-2 text-muted-foreground"
          title={t('ud.cadence.snooze.title')}
        >
          <AlarmClock className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-1.5 p-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('ud.cadence.snooze.title')}
        </p>
        {([
          ['tomorrow', 1],
          ['plus2', 2],
          ['plus7', 7],
        ] as const).map(([key, days]) => (
          <button
            key={key}
            type="button"
            disabled={snooze.isPending}
            onClick={() => void apply(at10(days))}
            className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
          >
            {t(`ud.cadence.snooze.${key}`)}
          </button>
        ))}
        <div className="flex items-center gap-1.5 border-t border-border/60 pt-1.5">
          <Input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={!custom || snooze.isPending}
            onClick={() => void apply(new Date(custom).toISOString())}
          >
            {t('ud.cadence.snooze.apply')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
