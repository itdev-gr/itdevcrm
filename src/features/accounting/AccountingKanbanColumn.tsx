import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { AccountingKanbanCard } from './AccountingKanbanCard';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import type { AccountingDealRow } from './hooks/useAccountingDeals';

type Props = {
  stageId: string;
  stageCode?: string | null;
  stageIndex: number;
  stageLabel: string;
  stageSubtitle?: string | undefined;
  deals: AccountingDealRow[];
};

export function AccountingKanbanColumn({
  stageId,
  stageCode,
  stageIndex,
  stageLabel,
  stageSubtitle,
  deals,
}: Props) {
  const { t } = useTranslation('accounting');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const accent = stageAccent(stageCode, stageIndex);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-80 shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/60',
        accent.columnBorder,
        'border-t-[3px]',
        isOver && 'bg-[#1a9696]/5 ring-[#1a9696]/30',
      )}
    >
      <header className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', accent.dot)} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{stageLabel}</span>
          {stageSubtitle && (
            <span className="block text-[11px] italic text-muted-foreground">{stageSubtitle}</span>
          )}
        </div>
        <span
          className={cn(
            'inline-flex min-w-7 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
            accent.badge,
          )}
        >
          {deals.length}
        </span>
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {deals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          deals.map((d) => <AccountingKanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}
