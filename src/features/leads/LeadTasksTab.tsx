import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { TaskDialog } from '@/features/home/TaskDialog';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { ImportanceBadge } from '@/features/tasks/ImportanceBadge';
import type { TaskCard } from '@/features/tasks/taskCard';
import { useLeadTasks } from './hooks/useLeadTasks';

export function LeadTasksTab({ leadId, leadTitle }: { leadId: string; leadTitle: string }) {
  const { t } = useTranslation('leads');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards, isLoading } = useLeadTasks(leadId, meId);
  const [newOpen, setNewOpen] = useState(false);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);

  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  const open = cards.filter((c) => !c.resolved);
  const resolved = cards.filter((c) => c.resolved);

  const row = (c: TaskCard) => (
    <li key={c.key} className="border-t first:border-t-0">
      <button type="button" onClick={() => setOpenCard(c)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted">
        <span className="truncate text-sm font-medium">{c.title}</span>
        <ImportanceBadge importance={c.importance} />
      </button>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('tasks_tab.open')} ({open.length})
        </h2>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>+ {t('tasks_tab.new')}</Button>
      </div>
      {open.length === 0 ? (
        <p className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">{t('tasks_tab.empty')}</p>
      ) : (
        <ul className="rounded-md border bg-card">{open.map(row)}</ul>
      )}
      {resolved.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('tasks_tab.resolved')} ({resolved.length})
          </h2>
          <ul className="rounded-md border bg-card opacity-70">{resolved.map(row)}</ul>
        </>
      )}

      <TaskDialog open={newOpen} onOpenChange={setNewOpen} defaultLead={{ id: leadId, name: leadTitle }} />
      {openCard?.kind === 'user' && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
    </div>
  );
}
