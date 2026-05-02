import { useTranslation } from 'react-i18next';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useAccountingDeals, type AccountingDealRow } from './hooks/useAccountingDeals';
import { useMoveAccountingStage } from './hooks/useMoveAccountingStage';
import { useCompleteAccounting } from './hooks/useCompleteAccounting';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { AccountingKanbanColumn } from './AccountingKanbanColumn';
import { useAccountingKanbanRealtime } from './hooks/useAccountingKanbanRealtime';

export function AccountingOnboardingKanbanPage() {
  useAccountingKanbanRealtime();
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deals = [], isLoading } = useAccountingDeals();
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveAccountingStage();
  const complete = useCompleteAccounting();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  async function onDragEnd(e: DragEndEvent) {
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
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {accStages.map((s) => (
            <AccountingKanbanColumn
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
