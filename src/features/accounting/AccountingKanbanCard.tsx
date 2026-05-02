import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import type { AccountingDealRow } from './hooks/useAccountingDeals';

export function AccountingKanbanCard({ deal }: { deal: AccountingDealRow }) {
  const { t } = useTranslation('accounting');
  const { t: tLeads } = useTranslation('leads');
  const { data: owners = [] } = useAssignableOwners();
  const owner = deal.owner_user_id ? owners.find((o) => o.user_id === deal.owner_user_id) : null;

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
