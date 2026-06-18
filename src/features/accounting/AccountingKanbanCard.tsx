import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, CheckCircle2, Clock, FileText, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import { cn } from '@/lib/utils';
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
  const upcoming = list
    .filter((p) => p.status === 'pending' && p.end_date)
    .sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? ''));
  return { status, invoiced, nextDue: upcoming[0]?.end_date ?? null };
}

const PAYMENT_BADGE = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  partial: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
} as const;

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
  const oneTime = Number(deal.one_time_value ?? 0);
  const monthly = Number(deal.recurring_monthly_value ?? 0);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        size="sm"
        className="cursor-grab gap-0 py-0 ring-border/60 transition-shadow hover:shadow-md active:cursor-grabbing"
      >
        <CardContent className="space-y-2.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {deal.code && <CopyableCode code={deal.code} className="text-[10px]" />}
              </div>
              <Link
                to={`/deals/${deal.id}`}
                className="block truncate text-sm font-semibold hover:text-[#157777] dark:hover:text-[#7ad4d4]"
              >
                {fullName}
              </Link>
            </div>
            {deal.accounting_completed_at && (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
            )}
          </div>

          {companyAndCategory && (
            <p className="truncate text-xs text-muted-foreground">{companyAndCategory}</p>
          )}

          {(oneTime > 0 || monthly > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {oneTime > 0 && (
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                  €{oneTime.toFixed(0)}
                </span>
              )}
              {monthly > 0 && (
                <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                  €{monthly.toFixed(0)}
                  {tLeads('card.monthly')}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <User className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {owner ? owner.full_name || owner.email : tLeads('owner.unassigned')}
            </span>
          </div>

          {services.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {services.map((s) => (
                <span
                  key={s.service_type}
                  className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-semibold text-teal-800 dark:bg-teal-950/50 dark:text-teal-200"
                >
                  {tDeals(`services.types.${s.service_type}`)}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                PAYMENT_BADGE[payStatus],
              )}
            >
              {tDeals(`payments.card_status.${payStatus}`)}
            </span>
            {invoiced && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                <FileText className="size-3" />
                {tDeals('payments.card_invoiced')}
              </span>
            )}
            {nextDue && payStatus !== 'paid' && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                title={formatDate(nextDue)}
              >
                <Clock className="size-3" />
                {relativeFromNow(nextDue)}
              </span>
            )}
          </div>

          {startedAt && (
            <div
              className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground"
              title={formatDate(startedAt)}
            >
              <Calendar className="size-3 shrink-0 opacity-70" />
              {t('card.lock_date')}: {relativeFromNow(startedAt)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
