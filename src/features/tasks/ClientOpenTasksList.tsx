import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { ImportanceBadge } from '@/features/tasks/ImportanceBadge';
import type { TaskCard } from '@/features/tasks/taskCard';
import { useClientTasks } from '@/features/clients/hooks/useClientTasks';

/** Read-only awareness list of a client's OPEN tasks (personal + deal/job),
 *  each row clickable to open its detail dialog. Visibility is enforced by RLS
 *  inside useClientTasks — do not add any per-user filtering here. */
export function ClientOpenTasksList({ clientId }: { clientId: string }) {
  const { t } = useTranslation('home');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards, isLoading } = useClientTasks(clientId, meId);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">…</p>;
  }

  const open = cards.filter((c) => !c.resolved);
  if (open.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('client_open_tasks.empty', { defaultValue: 'No open tasks on this client' })}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {t('client_open_tasks.header', { defaultValue: 'Open tasks on this client' })} ({open.length})
      </p>
      <ul className="max-h-40 overflow-y-auto rounded-md border bg-card">
        {open.map((c) => (
          <li key={c.key} className="border-t first:border-t-0">
            <button
              type="button"
              onClick={() => setOpenCard(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
            >
              <span className="truncate text-sm">{c.title}</span>
              <ImportanceBadge importance={c.importance} />
              {c.sourceCode && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {c.sourceCode}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {openCard?.kind === 'assigned' && (
        <AssignedTaskDetailDialog taskId={openCard.id} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
      {openCard?.kind === 'user' && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
    </div>
  );
}
