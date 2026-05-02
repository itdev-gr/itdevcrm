import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDeals, type DealRow } from '@/features/deals/hooks/useDeals';
import { useMoveDealStage } from '@/features/deals/hooks/useMoveDealStage';
import { useLockDeal } from '@/features/deals/hooks/useLockDeal';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { SavedFiltersBar } from '@/features/saved_filters/SavedFiltersBar';
import { SalesKanbanColumn } from './SalesKanbanColumn';
import { useSalesKanbanRealtime } from './useSalesKanbanRealtime';

export function SalesKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  useSalesKanbanRealtime();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [filter, setFilter] = useState<Record<string, unknown>>({});
  const { data: deals = [], isLoading } = useDeals(filter as Parameters<typeof useDeals>[0]);
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveDealStage();
  const lock = useLockDeal();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (isLoading) return <div className="p-8">…</div>;

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const wonStage = salesStages.find((s) => s.code === 'won');

  const dealsByStage = new Map<string, DealRow[]>();
  for (const s of salesStages) dealsByStage.set(s.id, []);
  for (const d of deals) {
    if (d.stage?.board !== 'sales') continue;
    const list = dealsByStage.get(d.stage_id);
    if (list) list.push(d);
  }

  async function onDragEnd(e: DragEndEvent) {
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const isLockTarget = wonStage && stageId === wonStage.id;
    if (isLockTarget) {
      try {
        await lock.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`deals:lock.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ dealId, stageId });
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
        <div className="flex items-center gap-2">
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
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {salesStages.map((s) => (
            <SalesKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              deals={dealsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
