import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import { useColumnLeads, type ColumnLeadsFilter } from './hooks/useColumnLeads';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import type { SortBy } from './salesKanbanColumns';

type ColumnProps = {
  stageId: string;
  stageCode?: string | null;
  stageLabel: string;
  stageIndex: number;
  leads: LeadRow[];
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  isLoading: boolean;
  nameFor: (userId: string | null) => string;
  locked?: boolean;
  /** UD board only: per-lead next-step / needs-decision badge. */
  cadenceBadgeFor?: ((leadId: string) => React.ReactNode) | undefined;
};

export function SalesKanbanColumn({
  stageId,
  stageCode,
  stageLabel,
  stageIndex,
  leads,
  total,
  hasMore,
  onLoadMore,
  isLoadingMore,
  isLoading,
  nameFor,
  locked = false,
  cadenceBadgeFor,
}: ColumnProps) {
  const { t } = useTranslation('sales');
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
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <span className={cn('size-2 shrink-0 rounded-full', accent.dot)} />
        <span className="truncate text-sm font-semibold">{stageLabel}</span>
        {locked && (
          <span title="locked" aria-label="locked">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        )}
        <span
          className={cn(
            'ml-auto inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
            accent.badge,
          )}
        >
          {total}
        </span>
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {isLoading ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">…</p>
        ) : leads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
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
                  cadenceBadge={cadenceBadgeFor?.(l.id)}
                />
              </div>
            ))}
            {hasMore && (
              <button
                type="button"
                data-testid="load-more"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="block w-full rounded-lg border border-dashed border-[#1a9696]/30 py-2.5 text-center text-xs font-medium text-[#157777] transition-colors hover:bg-[#1a9696]/5 disabled:opacity-50 dark:text-[#7ad4d4]"
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
  stageCode?: string | null;
  stageLabel: string;
  stageIndex: number;
  total: number;
  filter: ColumnLeadsFilter;
  sortBy: SortBy;
  nameFor: (userId: string | null) => string;
  locked?: boolean;
  cadenceBadgeFor?: ((leadId: string) => React.ReactNode) | undefined;
};

export function SalesKanbanColumnContainer({
  stageId,
  stageCode,
  stageLabel,
  stageIndex,
  total,
  filter,
  sortBy,
  nameFor,
  locked,
  cadenceBadgeFor,
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
      stageCode={stageCode ?? null}
      stageLabel={stageLabel}
      stageIndex={stageIndex}
      leads={leads}
      total={total}
      hasMore={!!hasNextPage}
      onLoadMore={() => void fetchNextPage()}
      isLoadingMore={isFetchingNextPage}
      isLoading={isLoading}
      nameFor={nameFor}
      locked={locked ?? false}
      cadenceBadgeFor={cadenceBadgeFor}
    />
  );
}
