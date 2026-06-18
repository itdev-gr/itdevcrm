import { Lock } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { JobsKanbanCard } from './JobsKanbanCard';
import { stageAccent } from '@/lib/stage-colors';
import { cn } from '@/lib/utils';
import type { JobRow } from './hooks/useJobs';

type Props = {
  stageId: string;
  stageCode?: string | null;
  stageIndex: number;
  stageLabel: string;
  jobs: JobRow[];
  /** false renders a display-only column: no drop target, cards not draggable. */
  interactive?: boolean;
};

export function JobsKanbanColumn({
  stageId,
  stageCode,
  stageIndex,
  stageLabel,
  jobs,
  interactive = true,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId, disabled: !interactive });
  const accent = stageAccent(interactive ? stageCode : 'blocked', stageIndex);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-80 shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/60',
        accent.columnBorder,
        'border-t-[3px]',
        isOver && interactive && 'bg-[#1a9696]/5 ring-[#1a9696]/30',
        !interactive && 'bg-red-50/30 dark:bg-red-950/10',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        {!interactive ? (
          <Lock className="size-3.5 shrink-0 text-red-500" aria-hidden />
        ) : (
          <span className={cn('size-2 shrink-0 rounded-full', accent.dot)} />
        )}
        <span className="truncate text-sm font-semibold">{stageLabel}</span>
        <span
          className={cn(
            'ml-auto inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
            accent.badge,
          )}
        >
          {jobs.length}
        </span>
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {jobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
            {interactive ? 'Drop jobs here' : '—'}
          </p>
        ) : (
          jobs.map((j) => <JobsKanbanCard key={j.id} job={j} dragDisabled={!interactive} />)
        )}
      </div>
    </div>
  );
}
