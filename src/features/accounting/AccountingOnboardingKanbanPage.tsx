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
import { useAccountingDeals, type AccountingDealRow } from './hooks/useAccountingDeals';
import { useMoveAccountingStage } from './hooks/useMoveAccountingStage';
import { useCompleteAccounting } from './hooks/useCompleteAccounting';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { AccountingKanbanColumn } from './AccountingKanbanColumn';
import { AccountingKanbanCard } from './AccountingKanbanCard';
import { useAccountingKanbanRealtime } from './hooks/useAccountingKanbanRealtime';

export function AccountingOnboardingKanbanPage() {
  useAccountingKanbanRealtime();
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: deals = [], isLoading } = useAccountingDeals();
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveAccountingStage();
  const complete = useCompleteAccounting();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeDeal = activeId ? (deals.find((d) => d.id === activeId) ?? null) : null;

  if (isLoading) return <div className="p-8">…</div>;

  const accStages = stages
    .filter((s) => s.board === 'accounting_onboarding' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const paidStage = accStages.find((s) => s.code === 'paid_in_full');

  const dealsByStage = new Map<string, AccountingDealRow[]>();
  for (const s of accStages) dealsByStage.set(s.id, []);
  for (const d of deals) {
    const sid = d.accounting_stage_id;
    if (!sid) continue;
    const list = dealsByStage.get(sid);
    if (list) list.push(d);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    if (paidStage && stageId === paidStage.id) {
      try {
        await complete.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`complete.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ dealId, stageId });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="-mx-6 -mt-6 border-b bg-white/95 px-6 py-3">
        <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {accStages.map((s) => (
            <AccountingKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              deals={dealsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
        <DragOverlay>{activeDeal ? <AccountingKanbanCard deal={activeDeal} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
