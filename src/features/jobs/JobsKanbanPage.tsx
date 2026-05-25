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
import { useJobs, type JobRow, type ServiceType } from './hooks/useJobs';
import { useMoveJobStage } from './hooks/useMoveJobStage';
import { useJobsRealtime } from './hooks/useJobsRealtime';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useEffectiveIsAdmin, useEffectiveUserId } from '@/lib/viewAs';
import { JobsKanbanColumn } from './JobsKanbanColumn';
import { JobsKanbanCard } from './JobsKanbanCard';

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
  const userId = useEffectiveUserId() ?? '';
  const isAdmin = useEffectiveIsAdmin();
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

  // Map a stage code to its column for this kanban. Lets ai_seo jobs (which
  // canonically live on the web_seo board) appear in the matching local_seo
  // column when the codes line up.
  const colByCode = new Map<string, (typeof boardStages)[number]>();
  for (const s of boardStages) colByCode.set(s.code, s);

  const filteredJobs =
    onlyMine && userId ? jobs.filter((j) => j.owner_user_id === userId) : jobs;

  const jobsByStage = new Map<string, JobRow[]>();
  for (const s of boardStages) jobsByStage.set(s.id, []);
  for (const j of filteredJobs) {
    if (!j.stage_id) continue;
    const jobStage = stageById.get(j.stage_id);
    if (!jobStage) continue;
    const col = colByCode.get(jobStage.code);
    if (!col) continue;
    jobsByStage.get(col.id)?.push(j);
  }

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
    // non-web-seo kanban (i.e. /tech/local-seo), translate the target stage
    // to the matching web_seo stage so the job stays visible on both boards.
    let targetStageId = stageId;
    if (job.service_type === 'ai_seo' && serviceType !== 'web_seo') {
      const targetStage = stageById.get(stageId);
      if (!targetStage) return;
      const webSeoStage = stages.find(
        (s) => s.board === 'web_seo' && s.code === targetStage.code && !s.archived,
      );
      if (!webSeoStage) return;
      targetStageId = webSeoStage.id;
    }
    if (job.stage_id === targetStageId) return;
    try {
      await moveStage.mutateAsync({ jobId, stageId: targetStageId });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{SERVICE_LABELS[serviceType][lang]}</h1>
        {isAdmin ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            Admin view · {filteredJobs.length}
          </span>
        ) : (
          <button
            type="button"
            onClick={toggleScope}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              onlyMine
                ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
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
        </div>
        <DragOverlay>{activeJob ? <JobsKanbanCard job={activeJob} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
