import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTdClass,
  settingsThClass,
  settingsTheadClass,
  settingsTrClass,
} from '@/components/layout/page-shell';
import { usePipelineStages, type StageRow } from './hooks/usePipelineStages';
import { useReorderStage } from './hooks/useReorderStage';
import { useArchiveStage } from './hooks/useArchiveStage';

export function StagesListPage() {
  const { t } = useTranslation('admin');
  const { data: stages = [], isLoading } = usePipelineStages();
  const reorder = useReorderStage();
  const archive = useArchiveStage();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted-foreground shadow-sm">
        …
      </div>
    );
  }

  const byBoard = new Map<string, StageRow[]>();
  for (const s of stages) {
    if (s.archived) continue;
    const list = byBoard.get(s.board) ?? [];
    list.push(s);
    byBoard.set(s.board, list);
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('stages.title')} />

      <div className="space-y-5">
        {[...byBoard.entries()].map(([board, list]) => {
          const sorted = list.slice().sort((a, b) => a.position - b.position);
          return (
            <SettingsCard key={board} className="overflow-hidden">
              <div className="border-b border-border/60 px-5 py-4">
                <h2 className="text-sm font-semibold">{t(`permissions.boards.${board}`)}</h2>
              </div>
              <SettingsTableShell className="rounded-none border-0 shadow-none">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className={settingsTheadClass}>
                    <tr>
                      <th className={settingsThClass}>{t('stages.code')}</th>
                      <th className={settingsThClass}>{t('stages.name_en')}</th>
                      <th className={settingsThClass}>{t('stages.name_el')}</th>
                      <th className={settingsThClass}>{t('stages.position')}</th>
                      <th className={settingsThClass}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s, idx) => (
                      <tr key={s.id} className={settingsTrClass}>
                        <td className={`${settingsTdClass} font-mono text-xs`}>{s.code}</td>
                        <td className={settingsTdClass}>{s.display_names.en}</td>
                        <td className={settingsTdClass}>{s.display_names.el}</td>
                        <td className={settingsTdClass}>
                          <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                            {s.position}
                          </span>
                        </td>
                        <td className={settingsTdClass}>
                          <div className="flex flex-wrap gap-1">
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
                              <ArrowUp className="size-3.5" />
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
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void archive.mutateAsync(s.id)}
                            >
                              {t('stages.archive')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SettingsTableShell>
            </SettingsCard>
          );
        })}
      </div>
    </div>
  );
}
