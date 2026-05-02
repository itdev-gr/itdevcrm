import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { useMonthlyInvoices } from './hooks/useMonthlyInvoices';
import { GenerateInvoicesDialog } from './GenerateInvoicesDialog';
import { InvoiceDetailDialog } from './InvoiceDetailDialog';

export function AccountingRecurringPage() {
  const { t } = useTranslation('accounting');
  const [genOpen, setGenOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: invoices = [], isLoading } = useMonthlyInvoices();

  if (isLoading) return <div className="p-8">…</div>;

  return (
    <div className="space-y-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('recurring.title')}</h1>
        <Button onClick={() => setGenOpen(true)}>{t('recurring.actions.generate')}</Button>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('recurring.empty')}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">{t('recurring.table.client')}</th>
              <th className="py-2 pr-4">{t('recurring.table.period')}</th>
              <th className="py-2 pr-4">{t('recurring.table.due_date')}</th>
              <th className="py-2 pr-4">{t('recurring.table.total')}</th>
              <th className="py-2 pr-4">{t('recurring.table.paid')}</th>
              <th className="py-2 pr-4">{t('recurring.table.status')}</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b">
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-2">
                    {inv.client?.name}
                    <BlockBadge clientId={inv.client_id} />
                  </span>
                </td>
                <td className="py-2 pr-4">{inv.period}</td>
                <td className="py-2 pr-4">{inv.due_date}</td>
                <td className="py-2 pr-4">€{Number(inv.total_amount).toFixed(2)}</td>
                <td className="py-2 pr-4">€{Number(inv.amount_paid).toFixed(2)}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      inv.status === 'paid'
                        ? 'bg-emerald-100 text-emerald-700'
                        : inv.status === 'overdue'
                          ? 'bg-red-100 text-red-700'
                          : inv.status === 'partial'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {t(`recurring.status.${inv.status}`)}
                  </span>
                </td>
                <td className="py-2">
                  <Button variant="link" size="sm" onClick={() => setDetailId(inv.id)}>
                    {t('recurring.actions.view')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <GenerateInvoicesDialog open={genOpen} onOpenChange={setGenOpen} />
      {detailId && (
        <InvoiceDetailDialog
          invoiceId={detailId}
          open={!!detailId}
          onOpenChange={(o) => !o && setDetailId(null)}
        />
      )}
    </div>
  );
}
