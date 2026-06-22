import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/authStore';
import { useOpenUserTasks } from '@/features/home/hooks/useOpenUserTasks';
import { useToggleTaskComplete } from '@/features/home/hooks/useDeleteTask';
import {
  useAssignedTasksOpen,
  type AssignedTaskRow,
} from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';
import { useResolveAssignedTask } from '@/features/assigned_tasks/hooks/useResolveAssignedTask';
import { DepartmentChip } from '@/features/assigned_tasks/DepartmentChip';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { importanceOf, importanceRank, type ImportanceCode } from './importance';
import { ImportanceBadge } from './ImportanceBadge';

type Item =
  | { kind: 'personal'; task: UserTaskRow; importance: ImportanceCode }
  | { kind: 'assigned'; task: AssignedTaskRow; importance: ImportanceCode };

// Kept out of the component body so the `Date.now` read stays out of render purity
// (see AssignedTasksColumn for the same pattern).
function isOverdue(dueIso: string): boolean {
  return new Date(dueIso).getTime() < Date.now();
}
function formatDue(dueIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(dueIso));
}
function sourceHref(task: AssignedTaskRow): string {
  if (task.deal_id) return `/deals/${task.deal_id}`;
  if (task.job_id) return `/jobs/${task.job_id}`;
  return '#';
}

export function MyTasksPage() {
  const { t } = useTranslation('common');
  const { t: th, i18n } = useTranslation('home');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const [showAll, setShowAll] = useState(false);
  const assigneeUserId = isAdmin && showAll ? null : userId || null;
  const { data: personal = [] } = useOpenUserTasks({ assigneeUserId });
  const { data: assigned = [] } = useAssignedTasksOpen({ assigneeUserId });
  const complete = useToggleTaskComplete();
  const resolve = useResolveAssignedTask();
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';

  // personal first (already due-asc), then assigned (created-desc); a STABLE sort
  // by importance rank keeps that intra-importance order while putting urgent on top.
  const items: Item[] = [
    ...personal.map((task) => ({ kind: 'personal' as const, task, importance: importanceOf(task) })),
    ...assigned.map((task) => ({ kind: 'assigned' as const, task, importance: importanceOf(task) })),
  ].sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('tasks_page.title')}</h1>
          <p className="text-sm opacity-70">{t('tasks_page.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              showAll
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {th('assigned_tasks.all_team_title')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded border border-dashed p-6 text-center text-sm opacity-70">
          {showAll ? t('tasks_page.empty_admin') : t('tasks_page.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) =>
            item.kind === 'personal' ? (
              <li key={`p-${item.task.id}`}>
                <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.task.title}</span>
                      <ImportanceBadge importance={item.importance} />
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {th('assigned_tasks.personal')}
                      </span>
                      <span
                        className={cn(
                          'text-[11px]',
                          isOverdue(item.task.due_at) ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {isOverdue(item.task.due_at) ? `${th('assigned_tasks.overdue')} · ` : ''}
                        {formatDue(item.task.due_at, locale)}
                      </span>
                    </div>
                    {item.task.notes && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.task.notes}</p>
                    )}
                  </div>
                  {(isAdmin || item.task.user_id === userId) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => complete.mutate({ id: item.task.id, completed: true })}
                      disabled={complete.isPending}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {th('assigned_tasks.resolve')}
                    </Button>
                  )}
                </div>
              </li>
            ) : (
              <li key={`a-${item.task.id}`}>
                <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.task.title}</span>
                      <ImportanceBadge importance={item.importance} />
                      <DepartmentChip department={item.task.department} />
                      <Link
                        to={sourceHref(item.task)}
                        className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        {item.task.source_code ?? '—'}
                      </Link>
                    </div>
                    {item.task.client && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.task.client.name}</p>
                    )}
                    {item.task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.task.description}</p>
                    )}
                  </div>
                  {(isAdmin || item.task.assignee_user_id === userId) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => resolve.mutate({ id: item.task.id })}
                      disabled={resolve.isPending}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {th('assigned_tasks.resolve')}
                    </Button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
