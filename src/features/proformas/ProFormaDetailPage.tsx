import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CopyableCode } from '@/components/CopyableCode';
import { formatPageTitle, useDocumentTitle } from '@/lib/documentTitle';
import { useProForma } from './hooks/useProForma';
import { useUpdateProFormaStatus } from './hooks/useUpdateProFormaStatus';
import { useDownloadProFormaPdf } from './hooks/useDownloadProFormaPdf';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { buildProFormaDraft } from '@/features/email/buildDraft';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import type { OfferItem, OfferTotals } from '@/lib/offers/types';

const STATUSES = ['draft', 'sent', 'paid', 'cancelled'] as const;
type Status = typeof STATUSES[number];

const STATUS_CLASS: Record<Status, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

export function ProFormaDetailPage() {
  const { proFormaId = '' } = useParams<{ proFormaId: string }>();
  const { t } = useTranslation('common');
  const { data: proForma, isLoading, error } = useProForma(proFormaId);
  const updateStatus = useUpdateProFormaStatus(proFormaId);
  const download = useDownloadProFormaPdf();
  const [emailOpen, setEmailOpen] = useState(false);

  useDocumentTitle(
    formatPageTitle(proForma?.client?.name, t('record_type.proforma'), proForma?.pro_forma_number),
  );

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !proForma)
    return <div className="p-8 text-red-600 dark:text-red-400">{error?.message ?? 'Not found'}</div>;

  const items = (proForma.items as unknown as OfferItem[]) ?? [];
  const totals = (proForma.totals as unknown as OfferTotals) ?? {
    subtotal: 0,
    discountAmount: 0,
    taxable: 0,
    vatAmount: 0,
    total: 0,
  };

  const validUntil = (() => {
    const d = new Date(proForma.created_at);
    d.setDate(d.getDate() + proForma.validity_days);
    return d;
  })();

  const recipientEmail = proForma.client?.email ?? proForma.lead?.email ?? '';
  const recipientName =
    proForma.client?.name ??
    proForma.lead?.contact_first_name ??
    proForma.lead?.company_name ??
    '';
  const draft = buildProFormaDraft(
    recipientName,
    `${window.location.origin}/proformas/${proForma.id}`,
  );

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            {proForma.pro_forma_number && (
              <CopyableCode code={proForma.pro_forma_number} className="text-xs" />
            )}
            <h1 className="text-2xl font-bold">Pro Forma</h1>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[proForma.status as Status]}`}
            >
              {proForma.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            🗓 {formatDate(proForma.created_at)} · {relativeFromNow(proForma.created_at)} · valid
            until {formatDate(validUntil.toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="status" className="text-sm">
              Status:
            </Label>
            <select
              id="status"
              value={proForma.status}
              onChange={(e) => updateStatus.mutate(e.target.value as Status)}
              disabled={updateStatus.isPending}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="outline" onClick={() => setEmailOpen(true)}>
            Send by email
          </Button>
          <Button
            type="button"
            onClick={async () => {
              // Open the tab synchronously, inside the click gesture, so the
              // browser's popup blocker doesn't kill it after the (multi-second)
              // PDF render. Then point the already-open tab at the signed URL.
              const tab = window.open('', '_blank');
              if (tab) tab.document.write('Generating PDF…');
              try {
                const url = await download.mutateAsync(proForma.id);
                if (tab) tab.location.href = url;
                else window.location.href = url; // popup blocked anyway → use current tab
              } catch (err) {
                tab?.close();
                alert((err as Error).message);
              }
            }}
            disabled={download.isPending}
          >
            {download.isPending ? 'Generating…' : 'Download PDF'}
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 rounded-md border bg-muted p-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Currency</div>
          <div className="font-medium">{proForma.currency}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Validity</div>
          <div className="font-medium">{proForma.validity_days} days</div>
        </div>
        {proForma.lead_id && (
          <div>
            <div className="text-xs text-muted-foreground">Lead</div>
            <Link to={`/leads/${proForma.lead_id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
              View lead →
            </Link>
          </div>
        )}
        {proForma.deal_id && (
          <div>
            <div className="text-xs text-muted-foreground">Deal</div>
            <Link to={`/deals/${proForma.deal_id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
              View deal →
            </Link>
          </div>
        )}
        {proForma.client_id && (
          <div>
            <div className="text-xs text-muted-foreground">Client</div>
            <Link
              to={`/clients/${proForma.client_id}`}
              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              View client →
            </Link>
          </div>
        )}
        {proForma.source_offer_id && (
          <div>
            <div className="text-xs text-muted-foreground">Source offer</div>
            <Link
              to={`/offers/${proForma.source_offer_id}`}
              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              View offer →
            </Link>
          </div>
        )}
        {proForma.notes && (
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Notes</div>
            <div className="whitespace-pre-wrap">{proForma.notes}</div>
          </div>
        )}
      </section>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-normal">Service</th>
              <th className="px-3 py-2 font-normal">Description</th>
              <th className="px-3 py-2 font-normal text-right">Qty</th>
              <th className="px-3 py-2 font-normal text-right">Unit</th>
              <th className="px-3 py-2 font-normal text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={`${it.category}-${it.itemId}`} className="border-t">
                <td className="px-3 py-2">{it.label}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{it.description}</td>
                <td className="px-3 py-2 text-right">{it.qty}</td>
                <td className="px-3 py-2 text-right">{formatEur(it.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatEur(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted text-xs">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right font-medium">Subtotal</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatEur(totals.subtotal)}</td>
            </tr>
            {totals.discountAmount > 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right">Discount</td>
                <td className="px-3 py-2 text-right tabular-nums">-{formatEur(totals.discountAmount)}</td>
              </tr>
            )}
            {Number(proForma.vat_percent) > 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right">VAT ({proForma.vat_percent}%)</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatEur(totals.vatAmount)}</td>
              </tr>
            )}
            <tr className="border-t">
              <td colSpan={4} className="px-3 py-2 text-right font-bold">Total</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums">{formatEur(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <SendEmailDialog
        open={emailOpen}
        identity="personal"
        to={recipientEmail}
        subject={draft.subject}
        body={draft.body}
        dedupeKey={`proforma:${proForma.id}`}
        onClose={() => setEmailOpen(false)}
      />
    </div>
  );
}
