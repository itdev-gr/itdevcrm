import { useEffect, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { PageHeader, FilterSelect } from '@/components/layout/page-shell';
import { Input } from '@/components/ui/input';
import { boardFocusJobId, matchesJobSearch } from './jobSearch';
import { JobsKanbanColumn } from './JobsKanbanColumn';
import { JobsKanbanCard } from './JobsKanbanCard';
import { groupJobsForBoard, hasBlockedColumn } from './kanbanGrouping';
import type { SortBy } from './kanbanGrouping';
import { useJobsBoardSortStore } from './jobsBoardSortStore';
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

const SEARCH_PLACEHOLDER: { en: string; el: string } = {
  en: 'Search this board…',
  el: 'Αναζήτηση σε αυτόν τον πίνακα…',
};

// Sort dropdown is opt-in per board so we can roll out to Local + Web SEO first
// and extend to the other boards (social_media, ads, web_dev, hosting) with a
// single line change once they ask for it.
const SORT_ENABLED_BOARDS = new Set<ServiceType>(['local_seo', 'web_seo']);

const SORT_LABEL: { en: string; el: string } = {
  en: 'Sort',
  el: 'Ταξινόμηση',
};

const SORT_OPTIONS: { value: SortBy; en: string; el: string }[] = [
  { value: 'newest',   en: 'Newest',          el: 'Νεότερα' },
  { value: 'oldest',   en: 'Oldest',          el: 'Παλαιότερα' },
  { value: 'recent',   en: 'Newest updated',  el: 'Πιο πρόσφατη ενημέρωση' },
  { value: 'stale',    en: 'Oldest updated',  el: 'Παλαιότερη ενημέρωση' },
  { value: 'due_soon', en: 'Due date (soonest)', el: 'Ημ. λήξης (πλησιέστερη)' },
  { value: 'due_far',  en: 'Due date (latest)',  el: 'Ημ. λήξης (μακρύτερη)' },
];

export function JobsKanbanPage({ serviceType }: { serviceType: ServiceType }) {
  useJobsRealtime(serviceType);
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { data: jobs = [], isLoading } = useJobs(serviceType);
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveJobStage(serviceType);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const sortBy = useJobsBoardSortStore((s) =>
    userId ? s.byUserBoard[`${userId}:${serviceType}`] ?? 'newest' : 'newest',
  );
  const setSortBy = useJobsBoardSortStore((s) => s.setSortBy);
  const [searchParams, setSearchParams] = useSearchParams();
  // Admins always see every job in the department — the Only-mine filter
  // is a per-tech-user convenience, not a permissions boundary.
  const onlyMine = !isAdmin && searchParams.get('mine') !== '0';
  const boardRef = useRef<HTMLDivElement>(null);

  const scopedJobs =
    onlyMine && userId ? jobs.filter((j) => j.owner_user_id === userId) : jobs;
  const filteredJobs = scopedJobs.filter((j) => matchesJobSearch(j, search));

  // When a search narrows the board to a single card, scroll it into view.
  const focusJobId = boardFocusJobId(filteredJobs, search);
  useEffect(() => {
    if (!focusJobId) return;
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-job-card="${focusJobId}"]`);
    if (!el) return;
    const raf = window.requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }),
    );
    return () => window.cancelAnimationFrame(raf);
  }, [focusJobId]);

  const activeJob = activeId ? (jobs.find((j) => j.id === activeId) ?? null) : null;

  if (isLoading) return <div className="p-8">…</div>;

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const boardStages = stages
    .filter((s) => s.board === serviceType && !s.archived)
    .sort((a, b) => a.position - b.position);

  const { byColumn: jobsByStage, blocked: blockedJobs } = groupJobsForBoard({
    board: serviceType,
    jobs: filteredJobs,
    boardStages,
    stageById,
    sortBy,
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

    const targetStageId = stageId;
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
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={SERVICE_LABELS[serviceType][lang]}>
        {(serviceType === 'local_seo' || serviceType === 'web_seo' || serviceType === 'web_dev') && (
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[lang]}
            aria-label={SEARCH_PLACEHOLDER[lang]}
            className="h-9 w-48 rounded-lg border-input/80 shadow-sm sm:w-64"
          />
        )}
        {SORT_ENABLED_BOARDS.has(serviceType) && (
          <FilterSelect
            value={sortBy}
            aria-label={SORT_LABEL[lang]}
            title={SORT_LABEL[lang]}
            onChange={(e) => {
              if (!userId) return;
              setSortBy(userId, serviceType, e.target.value as SortBy);
            }}
            className="w-44"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o[lang]}</option>
            ))}
          </FilterSelect>
        )}
        {isAdmin ? (
          <span className="rounded-full border border-amber-300/80 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Admin view · {filteredJobs.length}
          </span>
        ) : (
          <button
            type="button"
            onClick={toggleScope}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              onlyMine
                ? 'border-border bg-muted text-muted-foreground hover:bg-muted/80'
                : 'border-blue-300/80 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
            )}
          >
            {onlyMine ? 'Only mine' : "All my group's"} ·{' '}
            <span className="tabular-nums">{filteredJobs.length}</span>
          </button>
        )}
      </PageHeader>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div ref={boardRef} className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
          {boardStages.map((s, index) => (
            <JobsKanbanColumn
              key={s.id}
              stageId={s.id}
              stageCode={s.code}
              stageIndex={index}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              jobs={jobsByStage.get(s.id) ?? []}
            />
          ))}
          {hasBlockedColumn(serviceType) && (
            <JobsKanbanColumn
              stageId="__blocked__"
              stageCode="blocked"
              stageIndex={boardStages.length}
              stageLabel={lang === 'el' ? 'Μπλοκαρισμένο' : 'Blocked'}
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
