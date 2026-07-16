import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { relativeFromNow } from '@/lib/datetime';
import { useAssignedTasksForSource } from './hooks/useAssignedTasksForSource';
import { useResolveTask, useUnresolveTask } from '@/features/tasks/hooks/useResolveTask';
import { resolveAction, awaitingLabelParty } from '@/features/tasks/dualResolve';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';
import { NewAssignedTaskDialog } from './NewAssignedTaskDialog';
import { canCreateAssignedTask } from './canCreateAssignedTask';
import { DepartmentChip } from './DepartmentChip';
import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';
import { useTasksSeenStore } from '@/features/tasks/tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from '@/features/tasks/taskHighlight';
import { NEW_TASK_ROW, NewTaskDot } from '@/features/tasks/taskHighlightStyle';
import { ClientLinkedTasksSection } from '@/features/tasks/ClientLinkedTasksSection';
import type { AssignedTaskRow } from './hooks/useAssignedTasksOpen';

const EMPTY_OPENED: Record<string, true> = {};

type Props = {
  source: { kind: 'deal' | 'job'; id: string };
  deptMatch?: { dealId: string; departmentGroupId: string };
  initialOpenTaskId?: string;
  onInitialOpenConsumed?: () => void;
  clientId?: string;
};

function TaskRow({
  task,
  onOpen,
  fromDeal = false,
  isNew = false,
  jobChip = false,
}: {
  task: AssignedTaskRow;
  onOpen: (id: string) => void;
  fromDeal?: boolean;
  isNew?: boolean;
  jobChip?: boolean;
}) {
  const { t } = useTranslation('jobs');
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const resolve = useResolveTask();
  const unresolve = useUnresolveTask();
  const dualState = {
    creatorResolvedAt: task.creator_resolved_at,
    assigneeResolvedAt: task.assignee_resolved_at,
    creatorId: task.created_by_user_id,
    assigneeId: task.assignee_user_id,
    closed: task.status === 'resolved',
  };
  const action = resolveAction(dualState, userId || null, isAdmin);
  const awaiting = awaitingLabelParty(dualState);
  const resolveLabel =
    action === 'withdraw'
      ? t('assigned_tasks.withdraw')
      : action === 'confirm_close'
        ? t('assigned_tasks.confirm_close')
        : t('assigned_tasks.resolve');
  // No directory hook on this row → the pending party's name isn't available;
  // fall back to nothing after the em-dash (per the badge's documented fallback).
  const onPrimary = () => {
    if (action === 'withdraw') unresolve.mutate({ kind: 'assigned', id: task.id });
    else resolve.mutate({ kind: 'assigned', id: task.id });
  };

  return (
    <li className={cn('border-t first:border-t-0', isNew && NEW_TASK_ROW)}>
      <div
        role="button"
        tabIndex={0}
        aria-label={task.title}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(task.id);
          }
        }}
        className="flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left hover:bg-muted"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isNew && <NewTaskDot />}
            <span className="text-sm font-medium">{task.title}</span>
            <DepartmentChip department={task.department} />
            {jobChip && task.job?.code && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {task.job.code}
              </span>
            )}
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
            {awaiting && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                {t('assigned_tasks.awaiting_confirmation', { name: '' })}
              </span>
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
        {action && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onPrimary();
            }}
            disabled={resolve.isPending || unresolve.isPending}
          >
            {resolveLabel}
          </Button>
        )}
      </div>
    </li>
  );
}

export function AssignedTasksTab({ source, deptMatch, initialOpenTaskId, onInitialOpenConsumed, clientId }: Props) {
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

  // Deep-link from a notification: open the requested task once, then tell
  // the parent we've consumed it so a later tab-switch remount doesn't
  // re-fire (Radix Tabs.Content unmounts inactive panels).
  useEffect(() => {
    if (initialOpenTaskId && userId) {
      markOpened(userId, initialOpenTaskId);
      setOpenTaskId(initialOpenTaskId);
      onInitialOpenConsumed?.();
    }
  }, [initialOpenTaskId, userId, markOpened, onInitialOpenConsumed]);
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
              jobChip={source.kind === 'deal' && task.job_id != null}
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
              jobChip={source.kind === 'deal' && task.job_id != null}
            />
          ))}
        </ul>
      )}

      {clientId && <ClientLinkedTasksSection clientId={clientId} source={source} />}

      <NewAssignedTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} source={source} />
      <AssignedTaskDetailDialog
        taskId={openTaskId}
        onOpenChange={(open) => !open && setOpenTaskId(null)}
      />
    </div>
  );
}
