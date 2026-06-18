import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import { useColumnLeads, type ColumnLeadsFilter } from './hooks/useColumnLeads';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import type { SortBy } from './salesKanbanColumns';

type ColumnProps = {
  stageId: string;
  stageLabel: string;
  leads: LeadRow[];
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  isLoading: boolean;
  nameFor: (userId: string | null) => string;
  locked?: boolean;
};

/** Presentational column: a droppable list of cards + a "Load more" button. */
export function SalesKanbanColumn({
  stageId,
  stageLabel,
  leads,
  total,
  hasMore,
  onLoadMore,
  isLoadingMore,
  isLoading,
  nameFor,
  locked = false,
}: ColumnProps) {
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
        {locked && (
          <span title="locked" aria-label="locked" className="mr-1">
            🔒
          </span>
        )}
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({total})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {isLoading ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">…</p>
        ) : leads.length === 0 ? (
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
            {hasMore && (
              <button
                type="button"
                data-testid="load-more"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="block w-full rounded-md border border-dashed py-2 text-center text-xs text-blue-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {isLoadingMore ? t('kanban.loading_more') : t('kanban.load_more')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type ContainerProps = {
  stageId: string;
  stageLabel: string;
  total: number;
  filter: ColumnLeadsFilter;
  sortBy: SortBy;
  nameFor: (userId: string | null) => string;
  locked?: boolean;
};

/** Wires one column to its paginated query. Kept thin so the column above stays pure. */
export function SalesKanbanColumnContainer({
  stageId,
  stageLabel,
  total,
  filter,
  sortBy,
  nameFor,
  locked,
}: ContainerProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useColumnLeads(
    stageId,
    filter,
    sortBy,
  );
  const leads = data?.pages.flat() ?? [];
  return (
    <SalesKanbanColumn
      stageId={stageId}
      stageLabel={stageLabel}
      leads={leads}
      total={total}
      hasMore={!!hasNextPage}
      onLoadMore={() => void fetchNextPage()}
      isLoadingMore={isFetchingNextPage}
      isLoading={isLoading}
      nameFor={nameFor}
      locked={locked ?? false}
    />
  );
}
