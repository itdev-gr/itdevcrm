import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TaskDialog } from '@/features/home/TaskDialog';
import { TasksKanbanBoard } from './TasksKanbanBoard';
import { ResolvedArchive } from './ResolvedArchive';
import { useAuthStore } from '@/lib/stores/authStore';
import { useTasksSeenStore } from './tasksSeenStore';

type Tab = 'board' | 'archive';

export function MyTasksPage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<Tab>('board');
  const [newOpen, setNewOpen] = useState(false);
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const markSeen = useTasksSeenStore((s) => s.markSeen);

  // Opening the Tasks page clears the "new since last visit" badge.
  useEffect(() => {
    if (meId) markSeen(meId, new Date().toISOString());
  }, [meId, markSeen]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('tasks_page.title')}</h1>
          <p className="text-sm opacity-70">{t('tasks_page.subtitle')}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
          + {t('tasks_page.new_task')}
        </Button>
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
      <TaskDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
