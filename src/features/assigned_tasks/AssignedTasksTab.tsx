import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { relativeFromNow } from '@/lib/datetime';
import { useAssignedTasksForSource } from './hooks/useAssignedTasksForSource';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';
import { NewAssignedTaskDialog } from './NewAssignedTaskDialog';
import { canCreateAssignedTask } from './canCreateAssignedTask';
import { DepartmentChip } from './DepartmentChip';
import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';
import { useTasksSeenStore } from '@/features/tasks/tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from '@/features/tasks/taskHighlight';
import { NEW_TASK_ROW, NewTaskDot } from '@/features/tasks/taskHighlightStyle';
import type { AssignedTaskRow } from './hooks/useAssignedTasksOpen';

const EMPTY_OPENED: Record<string, true> = {};

type Props = {
  source: { kind: 'deal' | 'job'; id: string };
  deptMatch?: { dealId: string; departmentGroupId: string };
};

function TaskRow({
  task,
  onOpen,
  fromDeal = false,
  isNew = false,
}: {
  task: AssignedTaskRow;
  onOpen: (id: string) => void;
  fromDeal?: boolean;
  isNew?: boolean;
}) {
  const { t } = useTranslation('jobs');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const resolve = useResolveAssignedTask();
  const isAssignee = task.assignee_user_id === userId;
  const canResolve = task.status === 'open' && (isAssignee || isAdmin);

  return (
    <li className={cn('border-t first:border-t-0', isNew && NEW_TASK_ROW)}>
      <button
        type="button"
        aria-label={task.title}
        onClick={() => onOpen(task.id)}
        className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isNew && <NewTaskDot />}
            <span className="text-sm font-medium">{task.title}</span>
            <DepartmentChip department={task.department} />
            {fromDeal && (
              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                {t('assigned_tasks.from_deal')}
              </span>
            )}
            {task.source_code && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {task.source_code}
              </span>
            )}
            {task.client && (
              <span className="text-[11px] text-muted-foreground">· {task.client.name}</span>
            )}
          </div>
          {task.description && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{task.description}</p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">
            {relativeFromNow(task.created_at)}
            {task.resolved_at && ` · ${t('assigned_tasks.resolved_by')} ${relativeFromNow(task.resolved_at)}`}
          </p>
        </div>
        {canResolve && (
          <Button
            type="button"
            size="sm"
            variant="outline"
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

export function AssignedTasksTab({ source, deptMatch }: Props) {
  const { t } = useTranslation('jobs');
  useAssignedTasksRealtime();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canCreate = canCreateAssignedTask({ isAdmin, groupCodes });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const userId = useAuthStore((s) => s.user?.id ?? '');
  const opened = useTasksSeenStore((s) => s.openedByUser[userId] ?? EMPTY_OPENED);
  const markOpened = useTasksSeenStore((s) => s.markOpened);
  const [highlightCutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);
  const newFor = (task: AssignedTaskRow) =>
    isTaskHighlighted({ createdAtIso: task.created_at, opened: !!opened[task.id], cutoffMs: highlightCutoffMs });
  const handleOpen = (id: string) => {
    if (userId) markOpened(userId, id);
    setOpenTaskId(id);
  };

  const { data: tasks = [], isLoading, error } = useAssignedTasksForSource(source, deptMatch);

  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  if (error) return <div className="text-sm text-red-600 dark:text-red-400">{(error as Error).message}</div>;

  const open = tasks.filter((x) => x.status === 'open');
  const resolved = tasks.filter((x) => x.status === 'resolved');
  const emptyKey = source.kind === 'deal' ? 'assigned_tasks.empty' : 'assigned_tasks.empty_job';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('assigned_tasks.section_open')} ({open.length})
        </h2>
        {canCreate && (
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            + {t('assigned_tasks.new_task')}
          </Button>
        )}
      </div>
      {open.length === 0 ? (
        <p className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">{t(emptyKey)}</p>
      ) : (
        <ul className="rounded-md border bg-card">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={handleOpen}
              fromDeal={source.kind === 'job' && task.job_id == null}
              isNew={newFor(task)}
            />
          ))}
        </ul>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t('assigned_tasks.section_resolved')} ({resolved.length})
      </h2>
      {resolved.length > 0 && (
        <ul className="rounded-md border bg-card opacity-70">
          {resolved.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={handleOpen}
              fromDeal={source.kind === 'job' && task.job_id == null}
              isNew={newFor(task)}
            />
          ))}
        </ul>
      )}

      <NewAssignedTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} source={source} />
      <AssignedTaskDetailDialog
        taskId={openTaskId}
        onOpenChange={(open) => !open && setOpenTaskId(null)}
      />
    </div>
  );
}
