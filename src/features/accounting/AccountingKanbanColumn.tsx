import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { AccountingKanbanCard } from './AccountingKanbanCard';
import type { AccountingDealRow } from './hooks/useAccountingDeals';

type Props = {
  stageId: string;
  stageLabel: string;
  stageSubtitle?: string | undefined;
  deals: AccountingDealRow[];
};

export function AccountingKanbanColumn({ stageId, stageLabel, stageSubtitle, deals }: Props) {
  const { t } = useTranslation('accounting');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-80 shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        {stageSubtitle && (
          <span className="ml-2 text-[11px] font-normal italic text-slate-500">
            {stageSubtitle}
          </span>
        )}
        <span className="ml-1 text-xs text-muted-foreground">({deals.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {deals.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          deals.map((d) => <AccountingKanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}
