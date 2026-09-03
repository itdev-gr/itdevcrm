import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Mail } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useUpdateLead } from '@/features/leads/hooks/useUpdateLead';
import { useConvertLead } from '@/features/leads/hooks/useConvertLead';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterBar, FilterSelect, PageHeader, SegmentedControl } from '@/components/layout/page-shell';
import { SavedFiltersBar } from '@/features/saved_filters/SavedFiltersBar';
import { SalesKanbanColumnContainer } from '@/features/sales/SalesKanbanColumn';
import { SalesKanbanCard } from '@/features/sales/SalesKanbanCard';
import { useSalesKanbanCounts } from '@/features/sales/hooks/useSalesKanbanCounts';
import { useSalesKanbanRealtime } from '@/features/sales/useSalesKanbanRealtime';
import { CreateLeadDialog } from '@/features/leads/CreateLeadDialog';
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
import { useSalesBoardFilterStore } from '@/features/sales/salesBoardFilterStore';
import { cn } from '@/lib/utils';
import { useCadenceOverview } from './hooks/useCadenceOverview';
import type { SortBy } from '@/features/sales/salesKanbanColumns';
import type { LeadRow } from '@/features/leads/hooks/useLeads';
import { formatConvertErrors } from '@/features/leads/convertErrors';

const BOARD = 'under_development';

/**
 * The "Under Development" pipeline — the task-driven sales board being built
 * live next to the classic one. Stage codes are ud_-prefixed so the legacy
 * time-based email engine never fires here; the cadence engine (Phase 2)
 * binds to these codes instead.
 */
export function UnderDevKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  const { t: tLeads } = useTranslation('leads');
  useSalesKanbanRealtime();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  // Non-admins only ever see their own leads (also enforced by RLS).
  const [filter, setFilter] = useState<Record<string, unknown>>(
    isAdmin || !userId ? {} : { ownerId: userId },
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'' | 'manual' | 'meta' | 'import' | 'franchise'>('');
  // Local (not the persisted sales-board store) so sorting this board never
  // silently reorders the classic board and vice versa.
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const { data: owners = [] } = useAssignableOwners();

  const { data: stages = [], isLoading } = usePipelineStages();
  const moveStage = useMoveLeadStage();
  const updateLead = useUpdateLead();
  const convert = useConvertLead();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const boardStages = stages
    .filter((s) => s.board === BOARD && !s.archived)
    .sort((a, b) => a.position - b.position);
  const wonStage = boardStages.find((s) => s.code === 'ud_won');
  const newLeadStage = boardStages.find((s) => s.code === 'ud_new_lead');
  const scheduledStage = boardStages.find((s) => s.code === 'ud_scheduled');

  // Dragging into Scheduled must produce an actual meeting: the drop is held
  // until a date/time is picked (same input the cadence outcome dialog uses).
  const [schedulePending, setSchedulePending] = useState<{ leadId: string; stageId: string } | null>(
    null,
  );
  const [scheduleAt, setScheduleAt] = useState('');

  async function confirmSchedule() {
    if (!schedulePending || !scheduleAt) return;
    try {
      // Stage first (works from any column, terminal ones included), then the
      // date — the board-aware scheduled_for sync no-ops once already there.
      await moveStage.mutateAsync({ leadId: schedulePending.leadId, stageId: schedulePending.stageId });
      await updateLead.mutateAsync({
        id: schedulePending.leadId,
        patch: { scheduled_for: new Date(scheduleAt).toISOString() },
      });
    } catch (err) {
      alert((err as Error).message);
    }
    setSchedulePending(null);
  }

  const columnFilter = {
    ...(typeof filter.ownerId === 'string' ? { ownerId: filter.ownerId } : {}),
    ...(source ? { source } : {}),
    search,
  };

  // Mirror the active filter so "Next in stage" on the lead detail page walks
  // the same rows this board shows (stage comes from the lead itself).
  const setBoardFilter = useSalesBoardFilterStore((s) => s.setFilter);
  useEffect(() => {
    if (!userId) return;
    setBoardFilter(userId, {
      ...(typeof filter.ownerId === 'string' ? { ownerId: filter.ownerId } : {}),
      ...(source ? { source } : {}),
      search,
    });
  }, [userId, filter.ownerId, source, search, setBoardFilter]);
  const { data: counts } = useSalesKanbanCounts({ ...columnFilter, board: BOARD });

  // Resolve owner/won-by names once (same as the classic board).
  const ownerName = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
  const nameFor = (id: string | null) => (id ? (ownerName.get(id) ?? '') : '');

  // Per-card chain state: next task (red when overdue), scheduled email, or a
  // needs-decision warning — nothing on this board is ever invisibly stalled.
  const { overview } = useCadenceOverview();
  const fmtShort = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(iso));
  const cadenceBadgeFor = (leadId: string) => {
    if (overview.repliedLeads.has(leadId)) {
      return (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
          <Mail className="size-3 shrink-0" />
          📩 {t('ud.tasks.replied_badge')}
        </p>
      );
    }
    if (overview.pausedLeads.has(leadId)) {
      return (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          ⏸ {t('ud.cadence.status.paused')}
        </p>
      );
    }
    const task = overview.taskByLead.get(leadId);
    if (task) {
      const overdue = new Date(task.due_at) < new Date();
      return (
        <p
          className={cn(
            'flex items-center gap-1.5 text-[10px] font-medium',
            overdue ? 'text-red-600 dark:text-red-400' : 'text-[#157777] dark:text-[#7ad4d4]',
          )}
        >
          <Clock className="size-3 shrink-0" />
          {task.title} · {fmtShort(task.due_at)}
        </p>
      );
    }
    const email = overview.pendingEmailByLead.get(leadId);
    if (email) {
      return (
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <Mail className="size-3 shrink-0" />
          Email · {fmtShort(email)}
        </p>
      );
    }
    const decision = overview.decisionByLead.get(leadId);
    if (decision) {
      // On Scheduled, a surviving decision means the meeting date passed (a
      // future one suppresses the flag entirely) — say that instead of the
      // generic nag.
      const decisionStage = decision.lead.stage_id
        ? boardStages.find((s) => s.id === decision.lead.stage_id)
        : undefined;
      const missedMeeting = decisionStage?.code === 'ud_scheduled' && !!decision.lead.scheduled_for;
      return (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3 shrink-0" />
          {missedMeeting ? t('ud.tasks.missed_meeting_badge') : t('ud.tasks.needs_decision_badge')}
        </p>
      );
    }
    return null;
  };

  if (isLoading) return <div className="p-8">…</div>;

  function onDragStart(e: DragStartEvent) {
    setActiveLead((e.active.data.current as { lead?: LeadRow } | undefined)?.lead ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const targetStage = boardStages.find((s) => s.id === stageId);
    if (targetStage && isStageMoveBlocked(targetStage, userId)) {
      alert(t('kanban.locked_move'));
      return;
    }
    if (wonStage && stageId === wonStage.id) {
      try {
        await convert.mutateAsync(leadId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(formatConvertErrors(errors, tLeads));
      }
    } else if (scheduledStage && stageId === scheduledStage.id) {
      setScheduleAt('');
      setSchedulePending({ leadId, stageId });
    } else {
      await moveStage.mutateAsync({ leadId, stageId });
    }
  }

  const ownerFilter =
    isAdmin && typeof filter.ownerId === 'string' ? filter.ownerId : isAdmin ? 'all' : userId ?? 'all';

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('ud.title')}>
        <Button onClick={() => setCreateOpen(true)}>{tLeads('actions.create')}</Button>
      </PageHeader>

      <FilterBar>
        {isAdmin && (
          <SegmentedControl
            value={ownerFilter}
            onChange={(v) => {
              if (v === 'all') setFilter({});
              else setFilter({ ownerId: v });
            }}
            options={[
              { value: userId ?? 'mine', label: t('filters.mine') },
              { value: 'all', label: t('filters.all') },
            ]}
          />
        )}
        {isAdmin && (
          <FilterSelect
            value={typeof filter.ownerId === 'string' ? filter.ownerId : ''}
            onChange={(e) => setFilter(e.target.value ? { ownerId: e.target.value } : {})}
            title={tLeads('owner.label')}
          >
            <option value="">
              {tLeads('owner.label')}: {t('filters.all')}
            </option>
            {owners.map((o) => (
              <option key={o.user_id} value={o.user_id}>
                {o.full_name || o.email}
                {o.is_admin ? ' · admin' : ''}
              </option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect
          value={source}
          onChange={(e) => setSource(e.target.value as '' | 'manual' | 'meta' | 'import' | 'franchise')}
        >
          <option value="">{tLeads('filters.source_all')}</option>
          <option value="manual">{tLeads('form.source_options.manual')}</option>
          <option value="meta">{tLeads('form.source_options.meta')}</option>
          <option value="import">{tLeads('form.source_options.import')}</option>
          <option value="franchise">{tLeads('form.source_options.franchise')}</option>
        </FilterSelect>
        <FilterSelect
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          title={tLeads('filters.sort_label')}
        >
          <option value="newest">{tLeads('filters.sort_newest')}</option>
          <option value="oldest">{tLeads('filters.sort_oldest')}</option>
          <option value="value_high">{tLeads('filters.sort_value_high')}</option>
          <option value="value_low">{tLeads('filters.sort_value_low')}</option>
          <option value="recent">{tLeads('filters.sort_recent')}</option>
        </FilterSelect>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tLeads('filters.search')}
          className="h-9 w-44 rounded-lg border-input/80 shadow-sm sm:w-56"
        />
        <SavedFiltersBar board="under_development:kanban" currentFilter={filter} onApply={setFilter} />
      </FilterBar>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveLead(null)}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
          {boardStages.map((s, index) => (
            <SalesKanbanColumnContainer
              key={s.id}
              stageId={s.id}
              stageCode={s.code.replace(/^ud_/, '')} // reuse the classic stage palette
              stageIndex={index}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              total={counts?.get(s.id) ?? 0}
              filter={columnFilter}
              sortBy={sortBy}
              nameFor={nameFor}
              locked={isStageMoveBlocked(s, userId)}
              cadenceBadgeFor={cadenceBadgeFor}
            />
          ))}
        </div>
        <DragOverlay>
          {activeLead ? (
            <SalesKanbanCard
              lead={activeLead}
              ownerName={nameFor(activeLead.owner_user_id)}
              wonByName={nameFor(activeLead.won_by_user_id)}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} stageId={newLeadStage?.id} />

      <Dialog
        open={!!schedulePending}
        onOpenChange={(open) => {
          if (!open) setSchedulePending(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('ud.schedule_dialog.title')}</DialogTitle>
            <DialogDescription>{t('ud.schedule_dialog.desc')}</DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            aria-label={t('ud.schedule_dialog.title')}
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSchedulePending(null)}>
              {t('ud.cadence.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!scheduleAt || moveStage.isPending || updateLead.isPending}
              onClick={() => void confirmSchedule()}
            >
              {t('ud.schedule_dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
