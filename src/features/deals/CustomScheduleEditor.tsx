import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatEur } from '@/lib/countries';
import { scheduleTotal, validateCustomSchedule, type ScheduleRow } from './customSchedule';

type Props = {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  /** The job total the parts must sum to. */
  total: number;
};

export function CustomScheduleEditor({ rows, onChange, total }: Props) {
  const { t } = useTranslation('deals');
  const sum = scheduleTotal(rows);
  const error = validateCustomSchedule(rows, total);

  function update(i: number, patch: Partial<ScheduleRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    onChange([...rows, { amount_net: 0, due_date: null }]);
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="col-span-2 space-y-1.5 rounded-md border bg-background p-2 sm:col-span-3">
      <Label className="text-xs">{t('jobs_billing.schedule.label')}</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-5 text-[10px] text-muted-foreground">{i + 1}.</span>
          <span className="text-[11px] text-muted-foreground">€</span>
          <Input
            type="number" step="0.01" min="0"
            value={r.amount_net ? String(r.amount_net) : ''}
            onChange={(e) => update(i, { amount_net: Number(e.target.value || 0) })}
            className="h-7 w-24 text-[11px]"
            aria-label={t('jobs_billing.schedule.amount')}
          />
          <Input
            type="date"
            value={r.due_date ?? ''}
            onChange={(e) => update(i, { due_date: e.target.value || null })}
            className="h-7 w-36 text-[11px]"
            aria-label={t('jobs_billing.schedule.due_date')}
          />
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
            onClick={() => removeRow(i)} disabled={rows.length <= 1}>
            ✕
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={addRow}>
          {t('jobs_billing.schedule.add_payment')}
        </Button>
        <span className={`text-[10px] ${error ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {t('jobs_billing.schedule.running_total', { sum: formatEur(sum), total: formatEur(total) })}
        </span>
      </div>
    </div>
  );
}
