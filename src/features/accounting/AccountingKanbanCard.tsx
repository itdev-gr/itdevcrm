import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import type { AccountingDealRow } from './hooks/useAccountingDeals';

export function AccountingKanbanCard({ deal }: { deal: AccountingDealRow }) {
  const { t } = useTranslation('accounting');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id, currentAccountingStage: deal.accounting_stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const services = Array.isArray(deal.services_planned)
    ? (deal.services_planned as unknown as Array<{ service_type: string }>)
    : [];

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <Link to={`/deals/${deal.id}`} className="block text-sm font-medium hover:underline">
            {deal.title}
          </Link>
          <div className="text-xs text-muted-foreground">{deal.client?.name}</div>
          {services.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">{t('card.services')}: </span>
              {services.map((s) => s.service_type).join(', ')}
            </div>
          )}
          <div className="text-xs">
            {Number(deal.one_time_value ?? 0) > 0 && (
              <span>€{Number(deal.one_time_value).toFixed(0)} once</span>
            )}
            {Number(deal.recurring_monthly_value ?? 0) > 0 && (
              <span className="ml-2">€{Number(deal.recurring_monthly_value).toFixed(0)}/mo</span>
            )}
          </div>
          {deal.locked_at && (
            <div className="text-[10px] text-muted-foreground">
              {t('card.lock_date')}: {new Date(deal.locked_at).toLocaleDateString()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
