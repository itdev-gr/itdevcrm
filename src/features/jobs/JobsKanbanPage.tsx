import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useJobs, type ServiceType } from './hooks/useJobs';
import { useMoveJobStage } from './hooks/useMoveJobStage';
import { useJobsRealtime } from './hooks/useJobsRealtime';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useAuthStore } from '@/lib/stores/authStore';
import { JobsKanbanColumn } from './JobsKanbanColumn';
import { JobsKanbanCard } from './JobsKanbanCard';
import { groupJobsForBoard, hasBlockedColumn, aiSeoTargetCode } from './kanbanGrouping';
import { stageCompletesJob } from './stageCompletion';

const SERVICE_LABELS: Record<ServiceType, { en: string; el: string }> = {
  web_seo: { en: 'Web SEO', el: 'Web SEO' },
  local_seo: { en: 'Local SEO', el: 'Local SEO' },
  web_dev: { en: 'Web Development', el: 'Ανάπτυξη Ιστοσελίδων' },
  social_media: { en: 'Social Media', el: 'Social Media' },
  ai_seo: { en: 'AI SEO', el: 'AI SEO' },
  hosting: { en: 'Hosting', el: 'Hosting' },
  ads: { en: 'Ads', el: 'Διαφημίσεις' },
};

export function JobsKanbanPage({ serviceType }: { serviceType: ServiceType }) {
  useJobsRealtime(serviceType);
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: jobs = [], isLoading } = useJobs(serviceType);
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveJobStage(serviceType);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [searchParams, setSearchParams] = useSearchParams();
  // Admins always see every job in the department — the Only-mine filter
  // is a per-tech-user convenience, not a permissions boundary.
  const onlyMine = !isAdmin && searchParams.get('mine') !== '0';

  const activeJob = activeId ? (jobs.find((j) => j.id === activeId) ?? null) : null;

  if (isLoading) return <div className="p-8">…</div>;

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const boardStages = stages
    .filter((s) => s.board === serviceType && !s.archived)
    .sort((a, b) => a.position - b.position);

  const filteredJobs =
    onlyMine && userId ? jobs.filter((j) => j.owner_user_id === userId) : jobs;

  const { byColumn: jobsByStage, blocked: blockedJobs } = groupJobsForBoard({
    board: serviceType,
    jobs: filteredJobs,
    boardStages,
    stageById,
  });

  function toggleScope() {
    const next = new URLSearchParams(searchParams);
    if (onlyMine) next.set('mine', '0');
    else next.delete('mine');
    setSearchParams(next, { replace: true });
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const jobId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    // ai_seo jobs canonically live on the Web SEO board. When dragged on a
    // non-web-seo kanban (i.e. /tech/local-seo), translate the target column
    // to the matching web_seo stage so the job stays visible on both boards.
    let targetStageId = stageId;
    if (job.service_type === 'ai_seo' && serviceType !== 'web_seo') {
      const targetStage = stageById.get(stageId);
      if (!targetStage) return;
      const targetCode =
        serviceType === 'local_seo' ? aiSeoTargetCode(targetStage.code) : targetStage.code;
      if (!targetCode) return; // column has no web_seo equivalent
      const webSeoStage = stages.find(
        (s) => s.board === 'web_seo' && s.code === targetCode && !s.archived,
      );
      if (!webSeoStage) return;
      targetStageId = webSeoStage.id;
    }
    if (job.stage_id === targetStageId) return;
    const resolved = stageById.get(targetStageId);
    try {
      await moveStage.mutateAsync({
        jobId,
        stageId: targetStageId,
        // Terminal "completed" stages (e.g. Local SEO "Done", Web Dev "Live")
        // stamp the ✓; leaving them clears it.
        completed: stageCompletesJob(resolved),
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{SERVICE_LABELS[serviceType][lang]}</h1>
        {isAdmin ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            Admin view · {filteredJobs.length}
          </span>
        ) : (
          <button
            type="button"
            onClick={toggleScope}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              onlyMine
                ? 'border-border bg-muted text-muted-foreground hover:bg-muted'
                : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950/70'
            }`}
          >
            {onlyMine ? 'Only mine' : "All my group's"} ·{' '}
            <span className="tabular-nums">{filteredJobs.length}</span>
          </button>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {boardStages.map((s) => (
            <JobsKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              jobs={jobsByStage.get(s.id) ?? []}
            />
          ))}
          {hasBlockedColumn(serviceType) && (
            <JobsKanbanColumn
              stageId="__blocked__"
              stageLabel={`🔒 ${lang === 'el' ? 'Μπλοκαρισμένο' : 'Blocked'}`}
              jobs={blockedJobs}
              interactive={false}
            />
          )}
        </div>
        <DragOverlay>{activeJob ? <JobsKanbanCard job={activeJob} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
