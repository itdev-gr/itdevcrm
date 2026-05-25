import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useEffectiveGroupCodes, useEffectiveIsAdmin, useEffectiveUserId } from '@/lib/viewAs';
import { relativeFromNow } from '@/lib/datetime';
import { useAssignedTasksForSource } from './hooks/useAssignedTasksForSource';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';
import { NewAssignedTaskDialog } from './NewAssignedTaskDialog';
import { canCreateAssignedTask } from './canCreateAssignedTask';
import type { AssignedTaskRow } from './hooks/useAssignedTasksOpen';

type Props = { source: { kind: 'deal' | 'job'; id: string } };

function TaskRow({ task }: { task: AssignedTaskRow }) {
  const { t } = useTranslation('jobs');
  const userId = useEffectiveUserId() ?? '';
  const isAdmin = useEffectiveIsAdmin();
  const resolve = useResolveAssignedTask();
  const isAssignee = task.assignee_user_id === userId;
  const canResolve = task.status === 'open' && (isAssignee || isAdmin);

  return (
    <li className="flex items-start gap-3 border-t px-3 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{task.title}</span>
          {task.source_code && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              {task.source_code}
            </span>
          )}
          {task.client && (
            <span className="text-[11px] text-slate-500">· {task.client.name}</span>
          )}
        </div>
        {task.description && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{task.description}</p>
        )}
        <p className="mt-1 text-[10px] text-slate-400">
          {relativeFromNow(task.created_at)}
          {task.resolved_at && ` · ${t('assigned_tasks.resolved_by')} ${relativeFromNow(task.resolved_at)}`}
        </p>
      </div>
      {canResolve && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => resolve.mutate({ id: task.id })}
          disabled={resolve.isPending}
        >
          {t('assigned_tasks.resolve')}
        </Button>
      )}
    </li>
  );
}

export function AssignedTasksTab({ source }: Props) {
  const { t } = useTranslation('jobs');
  useAssignedTasksRealtime();
  const isAdmin = useEffectiveIsAdmin();
  const groupCodes = useEffectiveGroupCodes();
  const canCreate = canCreateAssignedTask({ isAdmin, groupCodes });
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: tasks = [], isLoading, error } = useAssignedTasksForSource(source);

  if (isLoading) return <div className="text-sm text-slate-500">…</div>;
  if (error) return <div className="text-sm text-red-600">{(error as Error).message}</div>;

  const open = tasks.filter((x) => x.status === 'open');
  const resolved = tasks.filter((x) => x.status === 'resolved');
  const emptyKey = source.kind === 'deal' ? 'assigned_tasks.empty' : 'assigned_tasks.empty_job';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {t('assigned_tasks.section_open')} ({open.length})
        </h2>
        {canCreate && (
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            + {t('assigned_tasks.new_task')}
          </Button>
        )}
      </div>
      {open.length === 0 ? (
        <p className="rounded-md border bg-slate-50 p-4 text-sm text-slate-500">{t(emptyKey)}</p>
      ) : (
        <ul className="rounded-md border bg-white">
          {open.map((task) => <TaskRow key={task.id} task={task} />)}
        </ul>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
        {t('assigned_tasks.section_resolved')} ({resolved.length})
      </h2>
      {resolved.length > 0 && (
        <ul className="rounded-md border bg-white opacity-70">
          {resolved.map((task) => <TaskRow key={task.id} task={task} />)}
        </ul>
      )}

      <NewAssignedTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} source={source} />
    </div>
  );
}
