import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAssignedTasksOpen, type AssignedTaskRow } from './hooks/useAssignedTasksOpen';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';
import { DepartmentChip } from './DepartmentChip';
import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';

function sourceHref(task: AssignedTaskRow): string {
  if (task.deal_id) return `/deals/${task.deal_id}`;
  if (task.job_id) return `/jobs/${task.job_id}`;
  return '#';
}

function Row({
  task, canResolve, onOpen,
}: {
  task: AssignedTaskRow;
  canResolve: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation('home');
  const resolve = useResolveAssignedTask();
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        aria-label={task.title}
        onClick={() => onOpen(task.id)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{task.title}</span>
            <DepartmentChip department={task.department} />
            <Link
              to={sourceHref(task)}
              onClick={(e) => e.stopPropagation()}
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200"
            >
              {task.source_code ?? '—'}
            </Link>
          </div>
          {task.client && (
            <p className="truncate text-[11px] text-slate-500">{task.client.name}</p>
          )}
          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{task.description}</p>
          )}
        </div>
        {canResolve && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              resolve.mutate({ id: task.id });
            }}
            disabled={resolve.isPending}
          >
            {t('assigned_tasks.resolve')}
          </Button>
        )}
      </button>
    </li>
  );
}

export function AssignedTasksColumn() {
  const { t } = useTranslation('home');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const [showAllAdmin, setShowAllAdmin] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  useAssignedTasksRealtime();

  const assigneeUserId = isAdmin && showAllAdmin ? null : userId || null;
  const { data: tasks = [] } = useAssignedTasksOpen({ assigneeUserId });

  const title = showAllAdmin ? t('assigned_tasks.all_team_title') : t('assigned_tasks.title');
  const empty = showAllAdmin ? t('assigned_tasks.empty_admin') : t('assigned_tasks.empty');

  return (
    <section className="flex h-80 min-h-0 flex-col border-t bg-white">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-2.5">
        <h2 className="text-sm font-semibold">{title} ({tasks.length})</h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAllAdmin((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              showAllAdmin
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-300 bg-slate-100 text-slate-700'
            }`}
          >
            {showAllAdmin ? t('assigned_tasks.all_team_title') : t('assigned_tasks.title')}
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">{empty}</p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <Row
                key={task.id}
                task={task}
                canResolve={isAdmin || task.assignee_user_id === userId}
                onOpen={setOpenTaskId}
              />
            ))}
          </ul>
        )}
      </div>
      <AssignedTaskDetailDialog
        taskId={openTaskId}
        onOpenChange={(open) => !open && setOpenTaskId(null)}
      />
    </section>
  );
}
