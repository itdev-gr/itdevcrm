import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAssignedTaskDetail } from './hooks/useAssignedTaskDetail';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { DepartmentChip } from './DepartmentChip';
import { industryLabel } from '@/lib/industries';
import { CallLink } from '@/components/CallLink';
import { useAuthStore } from '@/lib/stores/authStore';
import { importanceOf } from '@/features/tasks/importance';
import { StartTaskButton } from '@/features/tasks/StartTaskButton';
import {
  TaskDetailShell, type TaskMetaRow, type TaskStatusTone,
} from '@/features/tasks/TaskDetailShell';

type Props = {
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
};

function contactName(c: { contact_first_name: string | null; contact_last_name: string | null } | null): string {
  if (!c) return '';
  return [c.contact_first_name, c.contact_last_name].filter(Boolean).join(' ').trim();
}

export function AssignedTaskDetailDialog({ taskId, onOpenChange }: Props) {
  const { t, i18n } = useTranslation('home');
  const c = (key: string, opts?: Record<string, unknown>) => t(key, { ns: 'common', ...opts });
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { data: task, isLoading, error } = useAssignedTaskDetail(taskId);
  const resolve = useResolveAssignedTask();

  async function onResolve() {
    if (!task) return;
    await resolve.mutateAsync({ id: task.id });
    onOpenChange(false);
  }

  const sourceHref = task?.deal_id ? `/deals/${task.deal_id}` : task?.job_id ? `/jobs/${task.job_id}` : null;
  const sourceLabel = task?.deal_id ? t('assigned_tasks.open_deal') : t('assigned_tasks.open_job');

  const statusKey = task
    ? task.status === 'resolved' ? 'resolved' : task.started_at ? 'started' : 'open'
    : 'open';

  const rows: TaskMetaRow[] = task
    ? [
        { label: c('tasks_page.assignee_label'), value: task.assignee?.full_name || task.assignee?.email || '—' },
        ...(task.creator
          ? [{ label: c('tasks_page.created_by_label'), value: task.creator.full_name || task.creator.email }]
          : []),
        {
          label: c('tasks_page.created_label'),
          value: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(task.created_at)),
        },
        { label: c('tasks_page.department_label'), value: <DepartmentChip department={task.department} /> },
        ...(task.source_code
          ? [{
              label: c('tasks_page.source_label'),
              value: sourceHref ? (
                <Link to={sourceHref} className="font-mono text-xs text-primary hover:underline">
                  {task.source_code}
                </Link>
              ) : task.source_code,
            }]
          : []),
      ]
    : [];

  return (
    <Dialog open={taskId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogDescription className="sr-only">{t('assigned_tasks.detail_description')}</DialogDescription>
        {/* Shell renders the DialogTitle once loaded; provide a fallback meanwhile. */}
        {!task && <DialogTitle className="sr-only">{t('assigned_tasks.detail_title')}</DialogTitle>}
        {isLoading && <p className="text-sm text-muted-foreground">{t('assigned_tasks.loading')}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{t('assigned_tasks.error_loading')}</p>}
        {task && (
          <TaskDetailShell
            title={task.title}
            importance={importanceOf(task)}
            statusTone={statusKey as TaskStatusTone}
            statusLabel={c(`tasks_page.status_${statusKey}`)}
            metaRows={rows}
            action={
              <StartTaskButton
                kind="assigned"
                id={task.id}
                isAssignee={task.assignee_user_id === meId}
                resolved={task.status === 'resolved'}
                startedAt={task.started_at}
                locale={locale}
              />
            }
            commentsKind="assigned"
            commentsTaskId={task.id}
            locale={locale}
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                {task.status === 'open' && (
                  <Button type="button" onClick={onResolve} disabled={resolve.isPending}>
                    {c('tasks_page.resolve')}
                  </Button>
                )}
                {sourceHref && (
                  <Button asChild variant="outline">
                    <Link to={sourceHref}>
                      {sourceLabel} {task.source_code ?? ''}
                    </Link>
                  </Button>
                )}
              </div>
            }
          >
            {task.description ? (
              <div className="space-y-1">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {c('tasks_page.description_label')}
                </h4>
                <p className="whitespace-pre-wrap text-sm text-foreground">{task.description}</p>
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground">{c('tasks_page.no_description')}</p>
            )}
            {task.client && (
              <section className="rounded-lg border border-border/60 bg-muted/40 p-3">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('assigned_tasks.client_section')}
                </h4>
                <p className="text-sm font-medium text-foreground">
                  {task.client.name}
                  {task.client.industry && (
                    <span className="text-muted-foreground">
                      {' '}· {industryLabel(task.client.industry, i18n.resolvedLanguage === 'el' ? 'el' : 'en')}
                    </span>
                  )}
                </p>
                {contactName(task.client) && (
                  <p className="text-sm text-foreground">{contactName(task.client)}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {task.client.phone && (
                    <span>
                      <CallLink phone={task.client.phone} />
                    </span>
                  )}
                  {task.client.email && (
                    <span>
                      <span aria-hidden="true">✉ </span>
                      <span>{task.client.email}</span>
                    </span>
                  )}
                </div>
              </section>
            )}
          </TaskDetailShell>
        )}
      </DialogContent>
    </Dialog>
  );
}
