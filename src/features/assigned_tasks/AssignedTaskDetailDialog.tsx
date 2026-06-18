import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAssignedTaskDetail } from './hooks/useAssignedTaskDetail';
import { useResolveAssignedTask } from './hooks/useResolveAssignedTask';
import { DepartmentChip } from './DepartmentChip';
import { industryLabel } from '@/lib/industries';
import { CallLink } from '@/components/CallLink';

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
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const { data: task, isLoading, error } = useAssignedTaskDetail(taskId);
  const resolve = useResolveAssignedTask();

  async function onResolve() {
    if (!task) return;
    await resolve.mutateAsync({ id: task.id });
    onOpenChange(false);
  }

  const sourceHref = task?.deal_id ? `/deals/${task.deal_id}` : task?.job_id ? `/jobs/${task.job_id}` : null;
  const sourceLabel = task?.deal_id ? t('assigned_tasks.open_deal') : t('assigned_tasks.open_job');

  return (
    <Dialog open={taskId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('assigned_tasks.detail_title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('assigned_tasks.detail_description')}</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">{t('assigned_tasks.loading')}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{t('assigned_tasks.error_loading')}</p>}
        {task && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold">{task.title}</h3>
              <div className="mt-1">
                <DepartmentChip department={task.department} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{task.status}</span>
              {task.creator && (
                <>
                  {' · '}
                  {t('assigned_tasks.created_by_label')}: {task.creator.full_name || task.creator.email}
                </>
              )}
              {' · '}
              {t('assigned_tasks.created_label')}: {new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium', timeStyle: 'short',
              }).format(new Date(task.created_at))}
            </div>
            {task.description && (
              <p className="whitespace-pre-wrap text-sm text-foreground">{task.description}</p>
            )}
            {task.client && (
              <section className="rounded-md border bg-muted p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
            <DialogFooter className="gap-2">
              {task.status === 'open' && (
                <Button type="button" onClick={onResolve} disabled={resolve.isPending}>
                  Resolve
                </Button>
              )}
              {sourceHref && (
                <Button asChild variant="outline">
                  <Link to={sourceHref}>
                    {sourceLabel} {task.source_code ?? ''}
                  </Link>
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
