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
import { useAuthStore } from '@/lib/stores/authStore';
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
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const [searchParams, setSearchParams] = useSearchParams();
  const onlyMine = searchParams.get('mine') !== '0';

  const activeJob = activeId ? (jobs.find((j) => j.id === activeId) ?? null) : null;

  if (isLoading) return <div className="p-8">…</div>;

  const boardStages = stages
    .filter((s) => s.board === serviceType && !s.archived)
    .sort((a, b) => a.position - b.position);

  const filteredJobs =
    onlyMine && userId ? jobs.filter((j) => j.owner_user_id === userId) : jobs;

  const jobsByStage = new Map<string, JobRow[]>();
  for (const s of boardStages) jobsByStage.set(s.id, []);
  for (const j of filteredJobs) {
    const sid = j.stage_id;
    if (!sid) continue;
    const list = jobsByStage.get(sid);
    if (list) list.push(j);
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
    if (!job || job.stage_id === stageId) return;
    try {
      await moveStage.mutateAsync({ jobId, stageId });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{SERVICE_LABELS[serviceType][lang]}</h1>
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
