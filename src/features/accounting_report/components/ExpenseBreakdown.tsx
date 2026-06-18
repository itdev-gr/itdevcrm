import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LedgerRow } from '../hooks/useLedger';
import { useExpenseCategories } from '../hooks/useExpenseCategories';

export type ExpenseBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[], title: string) => void;
  onNewExpense: () => void;
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
          className="h-full rounded-full bg-red-400/70 transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="min-w-[3rem] text-right tabular-nums">{pct.toFixed(1)}%</span>
    </div>
  );
}

export function ExpenseBreakdown({ rows, onSelectGroup, onNewExpense }: ExpenseBreakdownProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const isEl = i18n.language.startsWith('el');

  const labelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of cats.data ?? []) {
      map.set(c.key, isEl ? c.name_el : c.name_en);
    }
    return map;
  }, [cats.data, isEl]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      if (r.direction !== 'out' || r.status !== 'paid') continue;
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

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <h3 className="text-sm font-semibold">{t('expense_breakdown.title')}</h3>
        <Button type="button" size="sm" variant="outline" onClick={onNewExpense}>
          <Plus className="size-3.5" />
          {t('expense_breakdown.new_expense')}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('expense_breakdown.category')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.count')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.net')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.vat')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.gross')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.percent')}</th>
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
                  className="cursor-pointer border-t border-border/40 transition-colors hover:bg-red-500/5"
                  onClick={() =>
                    onSelectGroup(
                      g.key,
                      g.rows,
                      g.key ? (labelByKey.get(g.key) ?? g.key) : t('expense_breakdown.category'),
                    )
                  }
                >
                  <td className="px-4 py-3 font-medium">
                    {g.key ? (labelByKey.get(g.key) ?? g.key) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="inline-flex min-w-6 justify-center rounded-full bg-muted px-2 py-0.5 text-xs">
                      {g.count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">€{g.net.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    €{g.vat.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-red-700 dark:text-red-400">
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
