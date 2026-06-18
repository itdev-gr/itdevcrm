import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';

export type IncomeBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[], title: string) => void;
};

type Group = {
  key: string | null;
  count: number;
  net: number;
  vat: number;
  gross: number;
  rows: LedgerRow[];
};

function PercentCell({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="min-w-[3rem] text-right tabular-nums">{pct.toFixed(1)}%</span>
    </div>
  );
}

export function IncomeBreakdown({ rows, onSelectGroup }: IncomeBreakdownProps) {
  const { t } = useTranslation(['accounting_report', 'deals']);
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      if (r.direction !== 'in' || r.status !== 'paid') continue;
      const k = r.category_key ?? '__unspecified';
      const g = map.get(k) ?? { key: r.category_key, count: 0, net: 0, vat: 0, gross: 0, rows: [] };
      g.count += 1;
      g.net += r.amount_net;
      g.vat += r.vat_amount;
      g.gross += r.amount_gross;
      g.rows.push(r);
      map.set(k, g);
    }
    return Array.from(map.values()).sort((a, b) => b.gross - a.gross);
  }, [rows]);

  const totalGross = groups.reduce((s, g) => s + g.gross, 0);

  function labelFor(key: string | null): string {
    if (!key) return t('accounting_report:income_breakdown.unknown');
    return t(`deals:services.types.${key}`, { defaultValue: key });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 px-4 py-3 sm:px-5">
        <h3 className="text-sm font-semibold">{t('accounting_report:income_breakdown.title')}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('accounting_report:income_breakdown.service')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('accounting_report:income_breakdown.count')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('accounting_report:income_breakdown.net')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('accounting_report:income_breakdown.vat')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('accounting_report:income_breakdown.gross')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('accounting_report:income_breakdown.percent')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  —
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <tr
                  key={g.key ?? 'unspecified'}
                  className="cursor-pointer border-t border-border/40 transition-colors hover:bg-primary/5"
                  onClick={() => onSelectGroup(g.key, g.rows, labelFor(g.key))}
                >
                  <td className="px-4 py-3 font-medium">{labelFor(g.key)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="inline-flex min-w-6 justify-center rounded-full bg-muted px-2 py-0.5 text-xs">
                      {g.count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">€{g.net.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    €{g.vat.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                    €{g.gross.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <PercentCell value={g.gross} total={totalGross} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
