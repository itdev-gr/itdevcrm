import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { useAssignedTasksOpen, type AssignedTaskRow } from './hooks/useAssignedTasksOpen';
import { useResolveTask } from '@/features/tasks/hooks/useResolveTask';
import { useAssignedTasksRealtime } from './hooks/useAssignedTasksRealtime';
import { DepartmentChip } from './DepartmentChip';
import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';
import { TaskDialog } from '@/features/home/TaskDialog';
import { useOpenUserTasks } from '@/features/home/hooks/useOpenUserTasks';
import { useToggleTaskComplete } from '@/features/home/hooks/useDeleteTask';
import { useTasksSeenStore } from '@/features/tasks/tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from '@/features/tasks/taskHighlight';
import { NEW_TASK_ROW, NewTaskDot } from '@/features/tasks/taskHighlightStyle';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';

const EMPTY_OPENED: Record<string, true> = {};

function sourceHref(task: AssignedTaskRow): string {
  if (task.deal_id) return `/deals/${task.deal_id}`;
  if (task.job_id) return `/jobs/${task.job_id}`;
  return '#';
}

// Kept out of the component body so the "now" read stays out of render purity.
function isTaskOverdue(dueIso: string): boolean {
  return new Date(dueIso).getTime() < Date.now();
}

function formatDue(dueIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(dueIso));
}

/** A deal/job-scoped assigned task (from the `assigned_tasks` table). */
function Row({
  task, canResolve, onOpen, isNew = false,
}: {
  task: AssignedTaskRow;
  canResolve: boolean;
  onOpen: (id: string) => void;
  isNew?: boolean;
}) {
  const { t } = useTranslation('home');
  const resolve = useResolveTask();
  return (
    <li>
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
        className={cn(
          'flex w-full cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 text-left shadow-sm transition-colors hover:border-primary/20 hover:bg-primary/5',
          isNew && NEW_TASK_ROW,
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isNew && <NewTaskDot />}
            <span className="truncate text-sm font-medium">{task.title}</span>
            <DepartmentChip department={task.department} />
            <Link
              to={sourceHref(task)}
              onClick={(e) => e.stopPropagation()}
              className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              {task.source_code ?? '—'}
            </Link>
          </div>
          {task.client && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.client.name}</p>
          )}
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
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
              resolve.mutate({ kind: 'assigned', id: task.id });
            }}
            disabled={resolve.isPending}
          >
            <CheckCircle2 className="size-3.5" />
            {t('assigned_tasks.resolve')}
          </Button>
        )}
      </div>
    </li>
  );
}

/** A personal/calendar task (from the `user_tasks` table). */
function PersonalRow({
  task, canResolve, onOpen, isNew = false,
}: {
  task: UserTaskRow;
  canResolve: boolean;
  onOpen: (task: UserTaskRow) => void;
  isNew?: boolean;
}) {
  const { t, i18n } = useTranslation('home');
  const complete = useToggleTaskComplete();
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const overdue = isTaskOverdue(task.due_at);
  const dueLabel = formatDue(task.due_at, locale);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-label={task.title}
        onClick={() => onOpen(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(task);
          }
        }}
        className={cn(
          'flex w-full cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 text-left shadow-sm transition-colors hover:border-primary/20 hover:bg-primary/5',
          isNew && NEW_TASK_ROW,
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isNew && <NewTaskDot />}
            <span className="truncate text-sm font-medium">{task.title}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t('assigned_tasks.personal')}
            </span>
            <span
              className={cn(
                'text-[11px]',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {overdue ? `${t('assigned_tasks.overdue')} · ` : ''}
              {dueLabel}
            </span>
          </div>
          {task.notes && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.notes}</p>
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
              complete.mutate({ id: task.id, completed: true });
            }}
            disabled={complete.isPending}
          >
            <CheckCircle2 className="size-3.5" />
            {t('assigned_tasks.resolve')}
          </Button>
        )}
      </div>
    </li>
  );
}

type WidgetItem =
  | { kind: 'assigned'; task: AssignedTaskRow }
  | { kind: 'personal'; task: UserTaskRow };

export function AssignedTasksColumn() {
  const { t } = useTranslation('home');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const [showAllAdmin, setShowAllAdmin] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [editingPersonal, setEditingPersonal] = useState<UserTaskRow | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  useAssignedTasksRealtime();

  const assigneeUserId = isAdmin && showAllAdmin ? null : userId || null;
  const { data: assignedTasks = [] } = useAssignedTasksOpen({ assigneeUserId });
  const { data: personalTasks = [] } = useOpenUserTasks({ assigneeUserId });

  // One unified "assigned to me" list: personal/calendar tasks first (already
  // soonest-due-first from the query), then deal/job tasks (newest-first).
  const items: WidgetItem[] = [
    ...personalTasks.map((task) => ({ kind: 'personal' as const, task })),
    ...assignedTasks.map((task) => ({ kind: 'assigned' as const, task })),
  ];

  const opened = useTasksSeenStore((s) => s.openedByUser[userId] ?? EMPTY_OPENED);
  const markOpened = useTasksSeenStore((s) => s.markOpened);
  const [highlightCutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);
  const newForId = (id: string, createdAt: string) =>
    isTaskHighlighted({ createdAtIso: createdAt, opened: !!opened[id], cutoffMs: highlightCutoffMs });

  function openNewTask() {
    setEditingPersonal(null);
    setTaskDialogOpen(true);
  }
  function openEditTask(task: UserTaskRow) {
    setEditingPersonal(task);
    setTaskDialogOpen(true);
  }
  function openAssigned(id: string) {
    if (userId) markOpened(userId, id);
    setOpenTaskId(id);
  }
  function openPersonal(task: UserTaskRow) {
    if (userId) markOpened(userId, task.id);
    openEditTask(task);
  }

  const title = showAllAdmin ? t('assigned_tasks.all_team_title') : t('assigned_tasks.title');
  const empty = showAllAdmin ? t('assigned_tasks.empty_admin') : t('assigned_tasks.empty');

  return (
    <section className="mx-4 mb-4 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm sm:mx-5">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">
          {title}{' '}
          <span className="font-normal text-muted-foreground">({items.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openNewTask}>
            <Plus className="size-3.5" />
            {t('calendar.new_task')}
          </Button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAllAdmin((v) => !v)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                showAllAdmin
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
              )}
            >
              {showAllAdmin ? t('assigned_tasks.all_team_title') : t('assigned_tasks.title')}
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 max-h-72 flex-1 overflow-y-auto p-3 sm:p-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-10 text-center">
            <CheckCircle2 className="mb-2 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{empty}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) =>
              item.kind === 'assigned' ? (
                <Row
                  key={`a-${item.task.id}`}
                  task={item.task}
                  canResolve={isAdmin || item.task.assignee_user_id === userId}
                  onOpen={openAssigned}
                  isNew={newForId(item.task.id, item.task.created_at)}
                />
              ) : (
                <PersonalRow
                  key={`p-${item.task.id}`}
                  task={item.task}
                  canResolve={isAdmin || item.task.user_id === userId}
                  onOpen={openPersonal}
                  isNew={newForId(item.task.id, item.task.created_at)}
                />
              ),
            )}
          </ul>
        )}
      </div>
      <AssignedTaskDetailDialog
        taskId={openTaskId}
        onOpenChange={(open) => !open && setOpenTaskId(null)}
      />
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={(open) => {
          setTaskDialogOpen(open);
          if (!open) setEditingPersonal(null);
        }}
        task={editingPersonal}
      />
    </section>
  );
}
