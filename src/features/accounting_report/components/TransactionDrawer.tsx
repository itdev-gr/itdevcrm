import { useTranslation } from 'react-i18next';
import type { LedgerRow } from '../hooks/useLedger';

export type TransactionDrawerProps = {
  open: boolean;
  title: string;
  rows: LedgerRow[];
  onClose: () => void;
  onSelectExpense?: (id: string) => void;
};

export function TransactionDrawer({
  open, title, rows, onClose, onSelectExpense,
}: TransactionDrawerProps) {
  const { t } = useTranslation('accounting_report');
  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-auto bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" className="text-sm" onClick={onClose}>
          {t('transaction_drawer.close')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-neutral-600">{t('transaction_drawer.empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="px-3 py-2">{t('transaction_drawer.date')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.counterparty')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.billing_type')}</th>
              <th className="px-3 py-2 text-right">{t('transaction_drawer.net')}</th>
              <th className="px-3 py-2 text-right">{t('transaction_drawer.vat')}</th>
              <th className="px-3 py-2 text-right">{t('transaction_drawer.gross')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.source_table}-${r.source_id}`}
                className={r.source_table === 'expenses' ? 'cursor-pointer hover:bg-neutral-50' : ''}
                onClick={() => {
                  if (r.source_table === 'expenses' && onSelectExpense) onSelectExpense(r.source_id);
                }}
              >
                <td className="px-3 py-2">{r.event_date}</td>
                <td className="px-3 py-2">{r.counterparty ?? '—'}</td>
                <td className="px-3 py-2">{r.billing_type}</td>
                <td className="px-3 py-2 text-right">€{r.amount_net.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">€{r.vat_amount.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">€{r.amount_gross.toFixed(2)}</td>
                <td className="px-3 py-2">{t(`status.${r.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
