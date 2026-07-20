import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAssignedTaskDetail } from './hooks/useAssignedTaskDetail';
import { useResolveTask, useUnresolveTask } from '@/features/tasks/hooks/useResolveTask';
import { resolveAction, awaitingLabelParty } from '@/features/tasks/dualResolve';
import { DepartmentChip } from './DepartmentChip';
import { industryLabel } from '@/lib/industries';
import { CallLink } from '@/components/CallLink';
import { useAuthStore } from '@/lib/stores/authStore';
import { importanceOf } from '@/features/tasks/importance';
import { StartTaskButton } from '@/features/tasks/StartTaskButton';
import { resolveTaskOpenLinks } from './taskOpenLink';
import { useDealServiceJobs } from './hooks/useDealServiceJob';
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
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canOpenDeal = isAdmin || groupCodes.includes('accounting') || groupCodes.includes('sales');
  const { data: task, isLoading, error } = useAssignedTaskDetail(taskId);
  const resolve = useResolveTask();
  const unresolve = useUnresolveTask();

  // Accounting can open any task read-only; Resolve + the comment thread stay gated
  // to the task's parties (assignee, creator, or an admin).
  const isParty = !!task && (isAdmin || task.assignee_user_id === meId || task.created_by_user_id === meId);

  // Dual-resolve: primary button depends on which side has stamped.
  const dualState = task
    ? {
        creatorResolvedAt: task.creator_resolved_at,
        assigneeResolvedAt: task.assignee_resolved_at,
        creatorId: task.created_by_user_id,
        assigneeId: task.assignee_user_id,
        closed: task.status === 'resolved',
      }
    : null;
  const resolveKind = dualState ? resolveAction(dualState, meId || null, isAdmin) : null;
  const awaiting = dualState ? awaitingLabelParty(dualState) : null;
  const awaitingName =
    awaiting === 'creator'
      ? task?.creator?.full_name || task?.creator?.email || ''
      : awaiting === 'assignee'
        ? task?.assignee?.full_name || task?.assignee?.email || ''
        : '';
  const primaryLabel =
    resolveKind === 'withdraw'
      ? c('tasks_page.withdraw')
      : resolveKind === 'confirm_close'
        ? c('tasks_page.confirm_close')
        : c('tasks_page.resolve');

  // Technical groups can't open the deal page; for a deal-scoped task, point them at
  // the deal's matching service job instead.
  const needJobLink = !!task?.deal_id && !task?.job_id && !canOpenDeal;
  const { data: matchingJobs } = useDealServiceJobs(
    task?.deal_id ?? null,
    task?.department?.code ?? null,
    needJobLink,
  );

  async function onPrimary() {
    if (!task || !resolveKind) return;
    if (resolveKind === 'withdraw') {
      await unresolve.mutateAsync({ kind: 'assigned', id: task.id });
      return; // stay open — the dialog re-renders back to the Resolve state
    }
    const res = await resolve.mutateAsync({ kind: 'assigned', id: task.id });
    if (res.closed) onOpenChange(false);
  }

  const openLinks = task
    ? resolveTaskOpenLinks({
        dealId: task.deal_id,
        jobId: task.job_id,
        sourceCode: task.source_code,
        canOpenDeal,
        matchingJobs: matchingJobs ?? [],
      })
    : [];

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
        ...(openLinks.length
          ? [{
              label: c('tasks_page.source_label'),
              value: (
                <div className="flex flex-col gap-0.5">
                  {openLinks.map((l) => (
                    <Link key={l.href} to={l.href} className="font-mono text-xs text-primary hover:underline">
                      {l.code || task.source_code}
                    </Link>
                  ))}
                </div>
              ),
            }]
          : task.source_code
            ? [{ label: c('tasks_page.source_label'), value: task.source_code }]
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
            commentsReplacement={
              isParty ? undefined : (
                <p className="text-xs italic text-muted-foreground">
                  {c('tasks_page.comments_participants_only')}
                </p>
              )
            }
            footer={
              <div className="flex flex-wrap justify-end gap-2">
                {resolveKind && (
                  <Button
                    type="button"
                    onClick={onPrimary}
                    disabled={resolve.isPending || unresolve.isPending}
                  >
                    {primaryLabel}
                  </Button>
                )}
                {openLinks.map((l) => (
                  <Button key={l.href} asChild variant="outline">
                    <Link to={l.href}>
                      {t(`assigned_tasks.${l.labelKey}`)} {l.code}
                    </Link>
                  </Button>
                ))}
              </div>
            }
          >
            {awaiting && (
              <div className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                {awaitingName
                  ? c('tasks_page.awaiting_confirmation', { name: awaitingName })
                  : c('tasks_page.awaiting_confirmation_nameless')}
              </div>
            )}
            {task.status === 'resolved' && task.summary && (
              <section className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {c('tasks_page.summary')}
                </h4>
                <p className="whitespace-pre-wrap text-sm text-foreground">{task.summary}</p>
              </section>
            )}
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
