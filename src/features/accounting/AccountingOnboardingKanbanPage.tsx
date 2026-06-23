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
import { useMarkPaidInFull } from './hooks/useMarkPaidInFull';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { PageHeader } from '@/components/layout/page-shell';
import { AccountingKanbanColumn } from './AccountingKanbanColumn';
import { AccountingKanbanCard } from './AccountingKanbanCard';
import { CloseDealDialog } from './CloseDealDialog';
import { useAccountingKanbanRealtime } from './hooks/useAccountingKanbanRealtime';

const STAGE_SUBTITLES: Record<string, { en: string; el: string }> = {
  awaiting_payment: { en: '7 days prior', el: '7 μέρες πριν' },
  on_hold: { en: 'Blocked', el: 'Μπλοκαρισμένο' },
};

export function AccountingOnboardingKanbanPage() {
  useAccountingKanbanRealtime();
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [closingDeal, setClosingDeal] = useState<AccountingDealRow | null>(null);
  const { data: deals = [], isLoading } = useAccountingDeals();
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveAccountingStage();
  const markPaid = useMarkPaidInFull();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeDeal = activeId ? (deals.find((d) => d.id === activeId) ?? null) : null;

  if (isLoading) return <div className="p-8">…</div>;

  const accStages = stages
    .filter((s) => s.board === 'accounting_onboarding' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const paidStage = accStages.find((s) => s.code === 'paid_in_full');
  const closedStage = accStages.find((s) => s.code === 'closed');

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
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || stageId === deal.accounting_stage_id) return;
    // Moving to "Closed" → confirm via dialog, which marks the jobs done +
    // moves them to their boards' close lanes and then closes the deal.
    if (closedStage && stageId === closedStage.id) {
      setClosingDeal(deal);
      return;
    }
    if (!deal.payment_method) {
      alert(t('kanban.move_errors.payment_method_required'));
      return;
    }
    if (paidStage && stageId === paidStage.id) {
      try {
        await markPaid.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`complete.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ dealId, stageId });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('kanban.title')} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
          {accStages.map((s, index) => (
            <AccountingKanbanColumn
              key={s.id}
              stageId={s.id}
              stageCode={s.code}
              stageIndex={index}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              stageSubtitle={STAGE_SUBTITLES[s.code]?.[lang]}
              deals={dealsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
        <DragOverlay>{activeDeal ? <AccountingKanbanCard deal={activeDeal} /> : null}</DragOverlay>
      </DndContext>
      <CloseDealDialog
        dealId={closingDeal?.id ?? null}
        dealLabel={closingDeal?.client?.name ?? ''}
        onClose={() => setClosingDeal(null)}
      />
    </div>
  );
}
