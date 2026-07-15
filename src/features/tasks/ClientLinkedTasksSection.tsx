import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { ImportanceBadge } from './ImportanceBadge';
import { UserTaskDetailDialog } from './UserTaskDetailDialog';
import { useClientUserTasks, partitionClientTasks } from './useClientUserTasks';
import type { TaskCard } from './taskCard';

/** Read-only surfacing of a client's personal (user_tasks) tasks on the deal/job
 *  Tasks tabs. Renders nothing when the client has no visible user tasks. */
export function ClientLinkedTasksSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation('jobs');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards } = useClientUserTasks(clientId, meId);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);
  const { open, resolved } = partitionClientTasks(cards);

  if (cards.length === 0) return null;

  const row = (c: TaskCard) => (
    <li key={c.key} className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setOpenCard(c)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted"
      >
        <span className="truncate text-sm font-medium">{c.title}</span>
        <ImportanceBadge importance={c.importance} />
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {t('assigned_tasks.from_client')}
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t('assigned_tasks.section_client')} ({open.length})
      </h2>
      {open.length > 0 && <ul className="rounded-md border bg-card">{open.map(row)}</ul>}
      {resolved.length > 0 && (
        <ul className="rounded-md border bg-card opacity-70">{resolved.map(row)}</ul>
      )}
      {openCard && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
    </div>
  );
}
