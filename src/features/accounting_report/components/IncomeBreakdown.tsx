import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';

export type IncomeBreakdownProps = {
  rows: LedgerRow[];
  onSelectGroup: (categoryKey: string | null, rows: LedgerRow[]) => void;
};

type Group = {
  key: string | null;
  count: number;
  net: number;
  vat: number;
  gross: number;
  rows: LedgerRow[];
};

export function IncomeBreakdown({ rows, onSelectGroup }: IncomeBreakdownProps) {
  const { t } = useTranslation('accounting_report');
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

  return (
    <section>
      <h3 className="mb-2 font-semibold">{t('income_breakdown.title')}</h3>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left">
          <tr>
            <th className="px-3 py-2">{t('income_breakdown.service')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.count')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.net')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.vat')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.gross')}</th>
            <th className="px-3 py-2 text-right">{t('income_breakdown.percent')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr
              key={g.key ?? 'unspecified'}
              className="cursor-pointer hover:bg-neutral-50"
              onClick={() => onSelectGroup(g.key, g.rows)}
            >
              <td className="px-3 py-2">{g.key ?? t('income_breakdown.unknown')}</td>
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
