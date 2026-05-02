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
import { useLeads, type LeadRow } from '@/features/leads/hooks/useLeads';
import { useMoveLeadStage } from '@/features/leads/hooks/useMoveLeadStage';
import { useConvertLead } from '@/features/leads/hooks/useConvertLead';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { SavedFiltersBar } from '@/features/saved_filters/SavedFiltersBar';
import { SalesKanbanColumn } from './SalesKanbanColumn';
import { SalesKanbanCard } from './SalesKanbanCard';
import { useSalesKanbanRealtime } from './useSalesKanbanRealtime';
import { CreateLeadDialog } from '@/features/leads/CreateLeadDialog';

export function SalesKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  const { t: tLeads } = useTranslation('leads');
  useSalesKanbanRealtime();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [filter, setFilter] = useState<Record<string, unknown>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: leads = [], isLoading } = useLeads(filter as Parameters<typeof useLeads>[0]);
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveLeadStage();
  const convert = useConvertLead();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeLead = activeId ? (leads.find((l) => l.id === activeId) ?? null) : null;

  if (isLoading) return <div className="p-8">…</div>;

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const wonStage = salesStages.find((s) => s.code === 'won');

  const leadsByStage = new Map<string, LeadRow[]>();
  for (const s of salesStages) leadsByStage.set(s.id, []);
  for (const lead of leads) {
    if (lead.stage?.board !== 'sales') continue;
    const list = leadsByStage.get(lead.stage_id ?? '');
    if (list) list.push(lead);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
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
    <div className="space-y-4 p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
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
          <SavedFiltersBar board="sales:kanban" currentFilter={filter} onApply={setFilter} />
          <Button onClick={() => setCreateOpen(true)}>{tLeads('actions.create')}</Button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {salesStages.map((s) => (
            <SalesKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              leads={leadsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
        <DragOverlay>{activeLead ? <SalesKanbanCard lead={activeLead} /> : null}</DragOverlay>
      </DndContext>
      <CreateLeadDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
