import { useDroppable } from '@dnd-kit/core';
import { JobsKanbanCard } from './JobsKanbanCard';
import type { JobRow } from './hooks/useJobs';

type Props = {
  stageId: string;
  stageLabel: string;
  jobs: JobRow[];
};

export function JobsKanbanColumn({ stageId, stageLabel, jobs }: Props) {
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
        <span className="ml-1 text-xs text-muted-foreground">({jobs.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {jobs.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">Drop jobs here</p>
        ) : (
          jobs.map((j) => <JobsKanbanCard key={j.id} job={j} />)
        )}
      </div>
    </div>
  );
}
