import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import { overflowCount } from './salesKanbanColumns';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

type Props = {
  stageId: string;
  stageLabel: string;
  leads: LeadRow[];
  total: number;
  overflowHref: string;
  nameFor: (userId: string | null) => string;
  locked?: boolean;
  collapsed?: boolean;
};

export function SalesKanbanColumn({
  stageId,
  stageLabel,
  leads,
  total,
  overflowHref,
  nameFor,
  locked = false,
  collapsed = false,
}: Props) {
  const { t } = useTranslation('sales');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const overflow = overflowCount(total, leads.length);

  return (
    <div
      ref={setNodeRef}
      className={`flex ${collapsed ? 'w-44' : 'w-72'} shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        {locked && (
          <span title="locked" aria-label="locked" className="mr-1">
            🔒
          </span>
        )}
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({total})</span>
      </header>

      {collapsed ? (
        <div className="p-3 text-center">
          <Link to={overflowHref} className="text-xs text-blue-700 hover:underline">
            {t('kanban.open_in_list', { count: total })}
          </Link>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          {leads.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t('kanban.empty_column')}
            </p>
          ) : (
            <>
              {leads.map((l) => (
                <div key={l.id} data-testid="kanban-card">
                  <SalesKanbanCard
                    lead={l}
                    ownerName={nameFor(l.owner_user_id)}
                    wonByName={nameFor(l.won_by_user_id)}
                  />
                </div>
              ))}
              {overflow > 0 && (
                <Link
                  to={overflowHref}
                  className="block rounded-md border border-dashed py-2 text-center text-xs text-blue-700 hover:bg-slate-100"
                >
                  {t('kanban.more_in_list', { count: overflow })}
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
