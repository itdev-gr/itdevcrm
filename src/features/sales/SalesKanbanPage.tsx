import { useTranslation } from 'react-i18next';
import { useDeals, type DealRow } from '@/features/deals/hooks/useDeals';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { SalesKanbanColumn } from './SalesKanbanColumn';

export function SalesKanbanPage() {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deals = [], isLoading } = useDeals();
  const { data: stages = [] } = usePipelineStages();

  if (isLoading) return <div className="p-8">…</div>;

  const salesStages = stages
    .filter((s) => s.board === 'sales' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const dealsByStage = new Map<string, DealRow[]>();
  for (const s of salesStages) dealsByStage.set(s.id, []);
  for (const d of deals) {
    if (d.stage?.board !== 'sales') continue;
    const list = dealsByStage.get(d.stage_id);
    if (list) list.push(d);
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
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
    </div>
  );
}
