import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

type Props = {
  stageId: string;
  stageLabel: string;
  leads: LeadRow[];
};

export function SalesKanbanColumn({ stageId, stageLabel, leads }: Props) {
  const { t } = useTranslation('sales');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({leads.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          leads.map((l) => <SalesKanbanCard key={l.id} lead={l} />)
        )}
      </div>
    </div>
  );
}
