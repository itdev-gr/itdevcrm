import { Link } from 'react-router-dom';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import { useOffersForLead, useOffersForDeal } from './hooks/useOffersForLeadOrDeal';

type Props = { leadId?: string; dealId?: string };

export function OffersTab({ leadId, dealId }: Props) {
  const lead = useOffersForLead(leadId ?? '');
  const deal = useOffersForDeal(dealId ?? '');
  const offers = (leadId ? lead.data : deal.data) ?? [];
  const isLoading = leadId ? lead.isLoading : deal.isLoading;
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (offers.length === 0) return <p className="text-sm text-muted-foreground">No offers yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {offers.map((o) => {
        const total = (o.totals as { total?: number } | null)?.total ?? 0;
        return (
          <li key={o.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <div>
              <div className="font-medium">
                {o.offer_number ?? o.id.slice(0, 8)}{' '}
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                  {o.status}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                {formatDate(o.created_at)} · {formatEur(Number(total))}
              </div>
            </div>
            <Link to={`/offers/${o.id}`} className="text-blue-600 underline text-xs">View →</Link>
          </li>
        );
      })}
    </ul>
  );
}
