import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import { openPdfInNewTab } from '@/lib/openPdfInNewTab';
import { useDownloadProFormaPdf } from './hooks/useDownloadProFormaPdf';
import { useProFormasForLead, useProFormasForDeal } from './hooks/useProFormasForLeadOrDeal';

type Props = { leadId?: string; dealId?: string };

export function ProFormasTab({ leadId, dealId }: Props) {
  const lead = useProFormasForLead(leadId ?? '');
  const deal = useProFormasForDeal(dealId ?? '');
  const download = useDownloadProFormaPdf();
  const proFormas = (leadId ? lead.data : deal.data) ?? [];
  const isLoading = leadId ? lead.isLoading : deal.isLoading;
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (proFormas.length === 0)
    return <p className="text-sm text-muted-foreground">No pro formas yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {proFormas.map((p) => {
        const total = (p.totals as { total?: number } | null)?.total ?? 0;
        return (
          <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <div>
              <div className="font-medium">
                {p.pro_forma_number ?? p.id.slice(0, 8)}{' '}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {p.status}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatDate(p.created_at)} · {formatEur(Number(total))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={download.isPending}
                onClick={() => void openPdfInNewTab(() => download.mutateAsync(p.id))}
              >
                {download.isPending ? '…' : 'PDF'}
              </Button>
              <Link to={`/proformas/${p.id}`} className="text-blue-600 underline text-xs dark:text-blue-400">View →</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
