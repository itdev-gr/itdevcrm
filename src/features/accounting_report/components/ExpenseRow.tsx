import { useTranslation } from 'react-i18next';
import type { ExpenseListRow } from '../hooks/useExpenses';

export type ExpenseRowProps = {
  row: ExpenseListRow;
  onClick: (id: string) => void;
};

export function ExpenseRow({ row, onClick }: ExpenseRowProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const isEl = i18n.language.startsWith('el');
  const categoryName = isEl ? row.category?.name_el : row.category?.name_en;
  return (
    <tr
      className="cursor-pointer hover:bg-neutral-50"
      onClick={() => onClick(row.id)}
      data-testid={`expense-row-${row.id}`}
    >
      <td className="px-3 py-2">{row.start_date}</td>
      <td className="px-3 py-2">{categoryName ?? row.category_id}</td>
      <td className="px-3 py-2">{row.vendor ?? '—'}</td>
      <td className="px-3 py-2 text-right">€{row.amount_net.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">€{row.vat_amount.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">€{row.amount_gross.toFixed(2)}</td>
      <td className="px-3 py-2">{t(`status.${row.status}`)}</td>
    </tr>
  );
}
