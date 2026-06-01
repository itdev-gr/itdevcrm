import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{t('expense_breakdown.title')}</h3>
        <button
          type="button"
          onClick={onNewExpense}
          className="rounded border px-3 py-1.5 text-sm"
        >
          {t('expense_breakdown.new_expense')}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left">
          <tr>
            <th className="px-3 py-2">{t('expense_breakdown.category')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.count')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.net')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.vat')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.gross')}</th>
            <th className="px-3 py-2 text-right">{t('expense_breakdown.percent')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.key ?? 'unspecified'}
              className="cursor-pointer hover:bg-neutral-50"
              onClick={() => onSelectGroup(g.key, g.rows, g.key ? (labelByKey.get(g.key) ?? g.key) : t('expense_breakdown.category'))}
            >
              <td className="px-3 py-2">{g.key ? (labelByKey.get(g.key) ?? g.key) : '—'}</td>
              <td className="px-3 py-2 text-right">{g.count}</td>
              <td className="px-3 py-2 text-right">€{g.net.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">€{g.vat.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">€{g.gross.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                {totalGross > 0 ? ((g.gross / totalGross) * 100).toFixed(1) : '0.0'}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
