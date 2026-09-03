import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import { openPdfInNewTab } from '@/lib/openPdfInNewTab';
import { useDownloadOfferPdf } from './hooks/useDownloadOfferPdf';
import {
  useOffersForLead,
  useOffersForDeal,
  useOffersForClient,
} from './hooks/useOffersForLeadOrDeal';

type Props = { leadId?: string; dealId?: string; clientId?: string };

/** Most specific parent wins: a lead's own offers, else the deal's, else every
 *  offer filed on the client (the accounting view, where there is no lead). */
export function OffersTab({ leadId, dealId, clientId }: Props) {
  const lead = useOffersForLead(leadId ?? '');
  const deal = useOffersForDeal(!leadId && dealId ? dealId : '');
  const client = useOffersForClient(!leadId && !dealId && clientId ? clientId : '');
  const download = useDownloadOfferPdf();
  const active = leadId ? lead : dealId ? deal : client;
  const offers = active.data ?? [];
  const isLoading = active.isLoading;
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (offers.length === 0) return <p className="text-sm text-muted-foreground">No offers yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {offers.map((o) => {
        const total = (o.totals as { total?: number } | null)?.total ?? 0;
        return (
          <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <div>
              <div className="font-medium">
                {o.offer_number ?? o.id.slice(0, 8)}{' '}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {o.status}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatDate(o.created_at)} · {formatEur(Number(total))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => void openPdfInNewTab(() => download.mutateAsync(o.id))}
              >
                {download.isPending ? '…' : 'PDF'}
              </Button>
              <Link to={`/offers/${o.id}`} className="text-blue-600 underline text-xs dark:text-blue-400">View →</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
