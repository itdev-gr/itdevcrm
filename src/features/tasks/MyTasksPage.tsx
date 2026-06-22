import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TasksKanbanBoard } from './TasksKanbanBoard';
import { ResolvedArchive } from './ResolvedArchive';

type Tab = 'board' | 'archive';

export function MyTasksPage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<Tab>('board');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">{t('tasks_page.title')}</h1>
        <p className="text-sm opacity-70">{t('tasks_page.subtitle')}</p>
      </div>
      <div className="flex gap-1 border-b border-border/60">
        {(['board', 'archive'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(key === 'board' ? 'tasks_page.tab_board' : 'tasks_page.tab_archive')}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'board' ? <TasksKanbanBoard /> : <ResolvedArchive />}
      </div>
    </div>
  );
}
