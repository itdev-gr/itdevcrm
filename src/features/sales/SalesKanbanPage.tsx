import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useConvertLead } from '@/features/leads/hooks/useConvertLead';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { SavedFiltersBar } from '@/features/saved_filters/SavedFiltersBar';
import { SalesKanbanColumnContainer } from './SalesKanbanColumn';
import { SalesKanbanCard } from './SalesKanbanCard';
import { useSalesKanbanCounts } from './hooks/useSalesKanbanCounts';
import { useSalesKanbanRealtime } from './useSalesKanbanRealtime';
import { CreateLeadDialog } from '@/features/leads/CreateLeadDialog';
import { isStageMoveBlocked } from './stageAccess';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

export function SalesKanbanPage() {
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
  const [source, setSource] = useState<'' | 'manual' | 'meta' | 'import'>('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'value_high' | 'value_low' | 'recent'>(
    'newest',
  );
  const { data: owners = [] } = useAssignableOwners();

  const { data: stages = [], isLoading } = usePipelineStages();
  const moveStage = useMoveLeadStage();
  const convert = useConvertLead();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);
  const wonStage = salesStages.find((s) => s.code === 'won');

  // Each column is an independent paginated list ("Load more"); only the true
  // per-stage counts are fetched up front so headers show the full totals.
  const columnFilter = {
    ...(typeof filter.ownerId === 'string' ? { ownerId: filter.ownerId } : {}),
    ...(source ? { source } : {}),
    search,
  };
  const { data: counts } = useSalesKanbanCounts(columnFilter);

  // Resolve owner/won-by names once (was a per-card query + O(n) find).
  const ownerName = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
  const nameFor = (userId: string | null) => (userId ? (ownerName.get(userId) ?? '') : '');

  if (isLoading) return <div className="p-8">…</div>;

  function onDragStart(e: DragStartEvent) {
    setActiveLead((e.active.data.current as { lead?: LeadRow } | undefined)?.lead ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const targetStage = salesStages.find((s) => s.id === stageId);
    if (targetStage && isStageMoveBlocked(targetStage, userId)) {
      alert(t('kanban.locked_move'));
      return;
    }
    if (wonStage && stageId === wonStage.id) {
      try {
        await convert.mutateAsync(leadId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => tLeads(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ leadId, stageId });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <Button
                variant={filter.ownerId === userId ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter({ ownerId: userId ?? undefined })}
              >
                {t('filters.mine')}
              </Button>
              <Button
                variant={Object.keys(filter).length === 0 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter({})}
              >
                {t('filters.all')}
              </Button>
            </>
          )}
          {isAdmin && (
            <select
              value={typeof filter.ownerId === 'string' ? filter.ownerId : ''}
              onChange={(e) => setFilter(e.target.value ? { ownerId: e.target.value } : {})}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
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
            </select>
          )}
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as '' | 'manual' | 'meta' | 'import')}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            <option value="">{tLeads('filters.source_all')}</option>
            <option value="manual">{tLeads('form.source_options.manual')}</option>
            <option value="meta">{tLeads('form.source_options.meta')}</option>
            <option value="import">{tLeads('form.source_options.import')}</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(
                e.target.value as 'newest' | 'oldest' | 'value_high' | 'value_low' | 'recent',
              )
            }
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            title={tLeads('filters.sort_label')}
          >
            <option value="newest">{tLeads('filters.sort_newest')}</option>
            <option value="oldest">{tLeads('filters.sort_oldest')}</option>
            <option value="value_high">{tLeads('filters.sort_value_high')}</option>
            <option value="value_low">{tLeads('filters.sort_value_low')}</option>
            <option value="recent">{tLeads('filters.sort_recent')}</option>
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tLeads('filters.search')}
            className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <SavedFiltersBar board="sales:kanban" currentFilter={filter} onApply={setFilter} />
          <Button onClick={() => setCreateOpen(true)}>{tLeads('actions.create')}</Button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveLead(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {salesStages.map((s) => (
            <SalesKanbanColumnContainer
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              total={counts?.get(s.id) ?? 0}
              filter={columnFilter}
              sortBy={sortBy}
              nameFor={nameFor}
              locked={isStageMoveBlocked(s, userId)}
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
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
