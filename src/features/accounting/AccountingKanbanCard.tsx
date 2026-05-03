import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import type { AccountingDealRow } from './hooks/useAccountingDeals';
import type { PlannedService } from '@/features/deals/ServicesPlannedField';

function paymentSummary(rows: AccountingDealRow['deal_payments']) {
  const list = rows ?? [];
  if (list.length === 0)
    return { status: 'pending' as const, invoiced: false, nextDue: null as string | null };
  const paid = list.filter((p) => p.status === 'paid').length;
  const status: 'pending' | 'partial' | 'paid' =
    paid === 0 ? 'pending' : paid === list.length ? 'paid' : 'partial';
  const invoiced = list.length > 0 && list.every((p) => !!p.invoice_number);
  // Next pending row by closest end_date — what accounting needs to chase next.
  const upcoming = list
    .filter((p) => p.status === 'pending' && p.end_date)
    .sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? ''));
  return { status, invoiced, nextDue: upcoming[0]?.end_date ?? null };
}

export function AccountingKanbanCard({ deal }: { deal: AccountingDealRow }) {
  const { t } = useTranslation('accounting');
  const { t: tLeads } = useTranslation('leads');
  const { t: tDeals } = useTranslation('deals');
  const { data: owners = [] } = useAssignableOwners();
  const owner = deal.owner_user_id ? owners.find((o) => o.user_id === deal.owner_user_id) : null;
  const services: PlannedService[] = Array.isArray(deal.services_planned)
    ? (deal.services_planned as unknown as PlannedService[])
    : [];
  const { status: payStatus, invoiced, nextDue } = paymentSummary(deal.deal_payments);
  const statusClass =
    payStatus === 'paid'
      ? 'bg-emerald-100 text-emerald-700'
      : payStatus === 'partial'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-700';

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id, currentAccountingStage: deal.accounting_stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const contactName = [deal.client?.contact_first_name, deal.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const fullName = contactName || deal.client?.name || deal.title;
  const subtitleParts = [contactName ? deal.client?.name : null, deal.client?.industry].filter(
    Boolean,
  );
  const companyAndCategory = subtitleParts.join(' · ');
  const startedAt = deal.actual_close_date ?? deal.locked_at ?? deal.updated_at;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {deal.code && <CopyableCode code={deal.code} className="text-[10px]" />}
              <Link
                to={`/deals/${deal.id}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {fullName}
              </Link>
            </div>
            {deal.accounting_completed_at && <span className="text-xs text-emerald-600">✓</span>}
          </div>
          {companyAndCategory && (
            <div className="text-xs text-muted-foreground">{companyAndCategory}</div>
          )}
          <div className="text-xs">
            {Number(deal.one_time_value ?? 0) > 0 && (
              <span>€{Number(deal.one_time_value).toFixed(0)}</span>
            )}
            {Number(deal.recurring_monthly_value ?? 0) > 0 && (
              <span className="ml-2">
                €{Number(deal.recurring_monthly_value).toFixed(0)}
                {tLeads('card.monthly')}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500">
            👤 {owner ? owner.full_name || owner.email : tLeads('owner.unassigned')}
          </div>
          {services.length > 0 && (
            <div className="text-[10px] text-slate-500">
              {services.map((s) => tDeals(`services.types.${s.service_type}`)).join(' · ')}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}>
              {tDeals(`payments.card_status.${payStatus}`)}
            </span>
            {invoiced && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                📄 {tDeals('payments.card_invoiced')}
              </span>
            )}
            {nextDue && payStatus !== 'paid' && (
              <span className="text-[10px] text-slate-400" title={formatDate(nextDue)}>
                ⏳ {relativeFromNow(nextDue)}
              </span>
            )}
          </div>
          {startedAt && (
            <div className="text-[10px] text-slate-400" title={formatDate(startedAt)}>
              🗓 {t('card.lock_date')}: {relativeFromNow(startedAt)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
