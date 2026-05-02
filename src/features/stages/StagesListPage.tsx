import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { usePipelineStages, type StageRow } from './hooks/usePipelineStages';
import { useReorderStage } from './hooks/useReorderStage';
import { useArchiveStage } from './hooks/useArchiveStage';

export function StagesListPage() {
  const { t } = useTranslation('admin');
  const { data: stages = [], isLoading } = usePipelineStages();
  const reorder = useReorderStage();
  const archive = useArchiveStage();

  if (isLoading) return <div className="p-8">…</div>;

  const byBoard = new Map<string, StageRow[]>();
  for (const s of stages) {
    if (s.archived) continue;
    const list = byBoard.get(s.board) ?? [];
    list.push(s);
    byBoard.set(s.board, list);
  }

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-bold">{t('stages.title')}</h1>
      {[...byBoard.entries()].map(([board, list]) => {
        const sorted = list.slice().sort((a, b) => a.position - b.position);
        return (
          <section key={board}>
            <h2 className="mb-2 text-lg font-medium">{t(`permissions.boards.${board}`)}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">{t('stages.code')}</th>
                  <th className="py-2 pr-4">{t('stages.name_en')}</th>
                  <th className="py-2 pr-4">{t('stages.name_el')}</th>
                  <th className="py-2 pr-4">{t('stages.position')}</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, idx) => (
                  <tr key={s.id} className="border-b">
                    <td className="py-2 pr-4 font-mono text-xs">{s.code}</td>
                    <td className="py-2 pr-4">{s.display_names.en}</td>
                    <td className="py-2 pr-4">{s.display_names.el}</td>
                    <td className="py-2 pr-4">{s.position}</td>
                    <td className="py-2 space-x-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={idx === 0}
                        onClick={() =>
                          void reorder.mutateAsync({
                            stages: list,
                            stageId: s.id,
                            direction: 'up',
                          })
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={idx === sorted.length - 1}
                        onClick={() =>
                          void reorder.mutateAsync({
                            stages: list,
                            stageId: s.id,
                            direction: 'down',
                          })
                        }
                      >
                        ↓
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void archive.mutateAsync(s.id)}
                      >
                        {t('stages.archive')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
