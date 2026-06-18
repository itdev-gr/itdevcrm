import { useDroppable } from '@dnd-kit/core';
import { JobsKanbanCard } from './JobsKanbanCard';
import type { JobRow } from './hooks/useJobs';

type Props = {
  stageId: string;
  stageLabel: string;
  jobs: JobRow[];
  /** false renders a display-only column: no drop target, cards not draggable. */
  interactive?: boolean;
};

export function JobsKanbanColumn({ stageId, stageLabel, jobs, interactive = true }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId, disabled: !interactive });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-80 shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-muted' : interactive ? 'bg-card' : 'bg-red-50/50 dark:bg-red-950/30'
      }`}
    >
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({jobs.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {jobs.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {interactive ? 'Drop jobs here' : '—'}
          </p>
        ) : (
          jobs.map((j) => <JobsKanbanCard key={j.id} job={j} dragDisabled={!interactive} />)
        )}
      </div>
    </div>
  );
}
