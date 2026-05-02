import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import type { DealRow } from '@/features/deals/hooks/useDeals';

export function SalesKanbanCard({ deal }: { deal: DealRow }) {
  const { t } = useTranslation('sales');
  return (
    <Card className="cursor-grab active:cursor-grabbing">
      <CardContent className="space-y-1 p-3">
        <div className="flex items-center justify-between">
          <Link to={`/deals/${deal.id}`} className="text-sm font-medium hover:underline">
            {deal.title}
          </Link>
          {deal.locked_at && <span className="text-xs text-emerald-600">🔒</span>}
        </div>
        <div className="text-xs text-muted-foreground">{deal.client?.name}</div>
        <div className="text-xs">
          {Number(deal.one_time_value ?? 0) > 0 && (
            <span>€{Number(deal.one_time_value).toFixed(0)}</span>
          )}
          {Number(deal.recurring_monthly_value ?? 0) > 0 && (
            <span className="ml-2">
              €{Number(deal.recurring_monthly_value).toFixed(0)}
              {t('kanban.card.monthly')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
