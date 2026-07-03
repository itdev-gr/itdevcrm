import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CopyableCode } from '@/components/CopyableCode';
import { formatPageTitle, useDocumentTitle } from '@/lib/documentTitle';
import { useOffer } from './hooks/useOffer';
import { useUpdateOfferStatus } from './hooks/useUpdateOfferStatus';
import { useDownloadOfferPdf } from './hooks/useDownloadOfferPdf';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import type { OfferItem, OfferTotals } from '@/lib/offers/types';

const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
type Status = typeof STATUSES[number];

const STATUS_CLASS: Record<Status, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
};

export function OfferDetailPage() {
  const { offerId = '' } = useParams<{ offerId: string }>();
  const { t } = useTranslation('common');
  const { data: offer, isLoading, error } = useOffer(offerId);
  const updateStatus = useUpdateOfferStatus(offerId);
  const download = useDownloadOfferPdf();
  const navigate = useNavigate();

  useDocumentTitle(
    formatPageTitle(offer?.client?.name, t('record_type.offer'), offer?.offer_number),
  );

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !offer)
    return <div className="p-8 text-red-600 dark:text-red-400">{error?.message ?? 'Not found'}</div>;

  const items = (offer.items as unknown as OfferItem[]) ?? [];
  const totals = (offer.totals as unknown as OfferTotals) ?? {
    subtotal: 0,
    discountAmount: 0,
    taxable: 0,
    vatAmount: 0,
    total: 0,
  };

  const validUntil = (() => {
    const d = new Date(offer.created_at);
    d.setDate(d.getDate() + offer.validity_days);
    return d;
  })();

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            {offer.offer_number && <CopyableCode code={offer.offer_number} className="text-xs" />}
            <h1 className="text-2xl font-bold">Offer</h1>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[offer.status as Status]}`}
            >
              {offer.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            🗓 {formatDate(offer.created_at)} · {relativeFromNow(offer.created_at)} · valid until{' '}
            {formatDate(validUntil.toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {offer.lead_id && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                navigate(`/leads/${offer.lead_id}/proformas/new?fromOffer=${offer.id}`)
              }
            >
              Create Pro Forma
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="status" className="text-sm">
              Status:
            </Label>
            <select
              id="status"
              value={offer.status}
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
          <Button
            type="button"
            onClick={async () => {
              // Open the tab synchronously, inside the click gesture, so the
              // browser's popup blocker doesn't kill it after the (multi-second)
              // PDF render. Then point the already-open tab at the signed URL.
              const tab = window.open('', '_blank');
              if (tab) tab.document.write('Generating PDF…');
              try {
                const url = await download.mutateAsync(offer.id);
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
          <div className="font-medium">{offer.currency}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Validity</div>
          <div className="font-medium">{offer.validity_days} days</div>
        </div>
        {offer.lead_id && (
          <div>
            <div className="text-xs text-muted-foreground">Lead</div>
            <Link to={`/leads/${offer.lead_id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
              View lead →
            </Link>
          </div>
        )}
        {offer.deal_id && (
          <div>
            <div className="text-xs text-muted-foreground">Deal</div>
            <Link to={`/deals/${offer.deal_id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
              View deal →
            </Link>
          </div>
        )}
        {offer.client_id && (
          <div>
            <div className="text-xs text-muted-foreground">Client</div>
            <Link
              to={`/clients/${offer.client_id}`}
              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              View client →
            </Link>
          </div>
        )}
        {offer.notes && (
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Notes</div>
            <div className="whitespace-pre-wrap">{offer.notes}</div>
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
            {Number(offer.vat_percent) > 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right">VAT ({offer.vat_percent}%)</td>
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
    </div>
  );
}
