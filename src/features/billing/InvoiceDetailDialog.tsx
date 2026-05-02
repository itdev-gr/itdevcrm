import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMonthlyInvoice } from './hooks/useMonthlyInvoice';
import { useMarkInvoicePaid } from './hooks/useMarkInvoicePaid';

type Props = { invoiceId: string; open: boolean; onOpenChange: (v: boolean) => void };

export function InvoiceDetailDialog({ invoiceId, open, onOpenChange }: Props) {
  const { t } = useTranslation('accounting');
  const { data: invoice, isLoading } = useMonthlyInvoice(invoiceId);
  const markPaid = useMarkInvoicePaid();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{invoice ? `${invoice.client?.name} — ${invoice.period}` : '…'}</DialogTitle>
        </DialogHeader>

        {isLoading || !invoice ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          <div className="space-y-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">{t('recurring.items.service')}</th>
                  <th className="py-2 pr-4">{t('recurring.items.description')}</th>
                  <th className="py-2 pr-4 text-right">{t('recurring.items.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-2 pr-4">{it.service_type}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{it.description}</td>
                    <td className="py-2 pr-4 text-right">€{Number(it.amount).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2 pr-4" colSpan={2}>
                    {t('recurring.table.total')}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    €{Number(invoice.total_amount).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">{t('recurring.table.paid')}: </span>€
                {Number(invoice.amount_paid).toFixed(2)} ({t(`recurring.status.${invoice.status}`)})
              </div>
              {invoice.status !== 'paid' && (
                <Button
                  onClick={() =>
                    void markPaid.mutateAsync({
                      id: invoice.id,
                      total: Number(invoice.total_amount),
                    })
                  }
                  disabled={markPaid.isPending}
                >
                  {t('recurring.actions.mark_paid')}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
