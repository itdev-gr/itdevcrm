import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ExpenseListRow } from '../hooks/useExpenses';

export type ExpenseRowProps = {
  row: ExpenseListRow;
  onClick: (id: string) => void;
};

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
} as const;

export function ExpenseRow({ row, onClick }: ExpenseRowProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const isEl = i18n.language.startsWith('el');
  const categoryName = isEl ? row.category?.name_el : row.category?.name_en;
  const statusKey = row.status as keyof typeof STATUS_STYLES;

  return (
    <tr
      className="cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-red-500/5"
      onClick={() => onClick(row.id)}
      data-testid={`expense-row-${row.id}`}
    >
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{row.start_date}</td>
      <td className="max-w-[160px] truncate px-4 py-3 font-medium">
        {categoryName ?? row.category_id}
      </td>
      <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
        {row.vendor ?? <span className="text-muted-foreground/50">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">€{row.amount_net.toFixed(2)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        €{row.vat_amount.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums text-red-700 dark:text-red-400">
        €{row.amount_gross.toFixed(2)}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
            STATUS_STYLES[statusKey] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {t(`status.${row.status}`)}
        </span>
      </td>
    </tr>
  );
}
