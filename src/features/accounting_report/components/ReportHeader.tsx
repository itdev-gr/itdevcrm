import { useTranslation } from 'react-i18next';
import type { RangePreset, DateRange } from '../utils/formatRange';
import type { PLSummary } from '../hooks/usePLSummary';

export type ReportHeaderProps = {
  preset: RangePreset;
  range: DateRange;
  onPreset: (preset: RangePreset) => void;
  onCustomFrom: (iso: string) => void;
  onCustomTo: (iso: string) => void;
  summary: PLSummary | undefined;
  /** Contracted MRR — matches the Recurring page total. */
  mrr: number;
  /** Recurring amount actually collected inside the selected range. */
  collectedMrr: number;
  ytdSummary: PLSummary | undefined;
};

function Tile({
  label, gross, net, suffix,
}: { label: string; gross: number; net?: number | undefined; suffix: string }) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">€{gross.toFixed(2)}</p>
      {net !== undefined && (
        <p className="text-xs text-neutral-500">€{net.toFixed(2)} {suffix}</p>
      )}
    </div>
  );
}

export function ReportHeader({
  preset, range, onPreset, onCustomFrom, onCustomTo,
  summary, mrr, collectedMrr, ytdSummary,
}: ReportHeaderProps) {
  const { t } = useTranslation('accounting_report');
  const presets: RangePreset[] = ['this_month', 'last_month', 'this_year', 'last_year', 'custom'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            className={`rounded border px-3 py-1.5 text-sm ${preset === p ? 'bg-neutral-900 text-white' : ''}`}
          >
            {t(`range.${p}`)}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="ml-4 flex gap-2 text-sm">
            <label>
              {t('range.from')}
              <input
                type="date"
                value={range.from}
                onChange={(e) => onCustomFrom(e.target.value)}
                className="ml-1 rounded border px-2 py-1"
              />
            </label>
            <label>
              {t('range.to')}
              <input
                type="date"
                value={range.to}
                onChange={(e) => onCustomTo(e.target.value)}
                className="ml-1 rounded border px-2 py-1"
              />
            </label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('kpi.income')}
          gross={summary?.totalIncomeGross ?? 0}
          net={summary?.totalIncomeNet}
          suffix={t('kpi.net_suffix')}
        />
        <Tile
          label={t('kpi.expense')}
          gross={summary?.totalExpenseGross ?? 0}
          net={summary?.totalExpenseNet}
          suffix={t('kpi.net_suffix')}
        />
        <Tile
          label={t('kpi.net_profit')}
          gross={summary?.netProfitGross ?? 0}
          net={summary?.netProfitNet}
          suffix={t('kpi.net_suffix')}
        />
        <Tile
          label={t('kpi.mrr')}
          gross={mrr}
          net={collectedMrr}
          suffix={t('kpi.mrr_collected_suffix')}
        />
      </div>

      {ytdSummary && (
        <div className="rounded border bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          {t('kpi.ytd')}: {t('kpi.income')} €{ytdSummary.totalIncomeGross.toFixed(2)} ·{' '}
          {t('kpi.expense')} €{ytdSummary.totalExpenseGross.toFixed(2)} ·{' '}
          {t('kpi.net_profit')} €{ytdSummary.netProfitGross.toFixed(2)}
        </div>
      )}
    </div>
  );
}
