import { useTranslation } from 'react-i18next';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { DealRow } from '@/features/deals/hooks/useDeals';

type Props = {
  stageId: string;
  stageLabel: string;
  deals: DealRow[];
};

export function SalesKanbanColumn({ stageId: _stageId, stageLabel, deals }: Props) {
  const { t } = useTranslation('sales');
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-md border bg-slate-50">
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({deals.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {deals.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          deals.map((d) => <SalesKanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}
