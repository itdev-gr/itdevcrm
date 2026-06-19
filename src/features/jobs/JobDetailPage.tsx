import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CopyableCode } from '@/components/CopyableCode';
import { detailOverviewWithCommentsGridClass, commentsPanelShellClass, commentsPanelBodyClass } from '@/components/layout/page-shell';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { useJob } from './hooks/useJob';
import { MonthlyTasksPanel } from './MonthlyTasksPanel';
import { JobInfoPanel } from './JobInfoPanel';
import { infoFieldsFor } from './serviceInfoFields';
import { AssignedTasksTab } from '@/features/assigned_tasks/AssignedTasksTab';
import { ContactsCard } from './ContactsCard';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useMoveJobStage } from './hooks/useMoveJobStage';
import { stageCompletesJob } from './stageCompletion';
import { useBlockJob, useUnblockJob } from './hooks/useBlockJob';
import { useAuthStore } from '@/lib/stores/authStore';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDeleteJobs } from './hooks/useDeleteJobs';
import { useJobBillingRefCount } from './hooks/useJobBillingRefCount';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import type { ServiceType } from './hooks/useJobs';

export function JobDetailPage() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const { t, i18n } = useTranslation('jobs');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: job, isLoading, error } = useJob(jobId);
  const { data: owners = [] } = useMentionableUsers();
  const { data: stages = [] } = usePipelineStages();

  const serviceType = (job?.service_type ?? '') as ServiceType;
  const moveStage = useMoveJobStage(serviceType);
  const block = useBlockJob(job?.id ?? '');
  const unblock = useUnblockJob(job?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canBlockJob = isAdmin || groupCodes.includes('accounting');
  const navigate = useNavigate();
  const del = useDeleteJobs();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const billingRefs = useJobBillingRefCount(jobId, confirmDelete);

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !job)
    return <div className="p-8 text-red-600 dark:text-red-400">{error?.message ?? 'Not found'}</div>;

  const owner = job.owner_user_id ? owners.find((o) => o.user_id === job.owner_user_id) : null;
  const boardStages = stages
    .filter((s) => s.board === job.service_type && !s.archived)
    .sort((a, b) => a.position - b.position);

  async function onChangeStage(stageId: string) {
    if (!job || job.stage_id === stageId) return;
    const target = boardStages.find((s) => s.id === stageId);
    try {
      await moveStage.mutateAsync({
        jobId: job.id,
        stageId,
        // Stamp/clear completion the same way a board drag does, so finishing a
        // job from the detail page registers as completed too.
        completed: stageCompletesJob(target),
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const contactName = [job.client?.contact_first_name, job.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const fullName = contactName || job.client?.name || job.deal?.title || '—';

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Job
            </span>
            {job.code && <CopyableCode code={job.code} className="text-xs" />}
            <h1 className="text-2xl font-bold">{fullName}</h1>
            {job.is_blocked && (
              <span
                className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300"
                title={job.blocked_reason ?? undefined}
              >
                🔒 Blocked
                {job.blocked_reason ? ` · ${job.blocked_reason.replace(/_/g, ' ')}` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {job.service_type} · 🗓 {formatDate(job.created_at)} ·{' '}
            {relativeFromNow(job.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canBlockJob &&
            (job.is_blocked ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => unblock.mutate()}
                disabled={unblock.isPending}
              >
                Unblock
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => block.mutate({ reason: 'manual' })}
                disabled={block.isPending}
              >
                Block
              </Button>
            ))}
          {boardStages.length > 0 && (
            <div className="flex items-center gap-2">
              <Label htmlFor="job-stage" className="text-sm">
                Stage:
              </Label>
              <select
                id="job-stage"
                value={job.stage_id ?? ''}
                onChange={(e) => onChangeStage(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {boardStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.display_names as { en: string; el: string })[lang]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {owner && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">Owner:</Label>
              <span className="rounded-md border border-input bg-muted px-2 py-1 text-sm text-muted-foreground">
                {owner.full_name || owner.email}
              </span>
            </div>
          )}
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              🗑 {t('delete.button')}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {infoFieldsFor(job.service_type).length > 0 && (
            <TabsTrigger value="info">Info</TabsTrigger>
          )}
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <div className={detailOverviewWithCommentsGridClass}>
            <div className="space-y-3">
              {job.billing_type === 'recurring_monthly' && infoFieldsFor(job.service_type).length === 0 && (
                <MonthlyTasksPanel
                  jobId={job.id}
                  serviceType={job.service_type}
                  isBlocked={!!job.is_blocked}
                />
              )}
              <ContactsCard client={job.client ?? null} />
              <div className="grid grid-cols-2 gap-4 rounded-md border bg-muted p-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Service</div>
                  <div className="font-medium">{job.service_type}</div>
                </div>
                {Number(job.one_time_amount ?? 0) > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground">One-time</div>
                    <div className="font-medium">€{Number(job.one_time_amount).toFixed(2)}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="font-medium">{job.status}</div>
                </div>
                {job.client && (
                  <div>
                    <div className="text-xs text-muted-foreground">Client</div>
                    <Link
                      to={`/clients/${job.client.id}`}
                      className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                    >
                      {job.client.name}
                    </Link>
                  </div>
                )}
                {job.deal && (
                  <div>
                    <div className="text-xs text-muted-foreground">Deal</div>
                    <Link
                      to={`/deals/${job.deal.id}`}
                      className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                    >
                      {job.deal.code ?? job.deal.title}
                    </Link>
                  </div>
                )}
              </div>
            </div>
            <aside className="min-w-0 lg:border-l lg:border-border/60 lg:pl-6">
              <div className={`${commentsPanelShellClass} border-0 shadow-none lg:max-h-[calc(100vh-6.5rem)]`}>
                <div className="shrink-0 px-1 pb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Comments
                  </h2>
                </div>
                <div className={`${commentsPanelBodyClass} !p-0`}>
                  <CommentsPanel parentType="job" parentId={job.id} />
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>
        {infoFieldsFor(job.service_type).length > 0 && (
          <TabsContent value="info" className="pt-4">
            <JobInfoPanel
              jobId={job.id}
              serviceType={job.service_type}
              initialDetails={(job.details ?? {}) as Record<string, unknown>}
            />
          </TabsContent>
        )}
        <TabsContent value="tasks" className="pt-4">
          <AssignedTasksTab source={{ kind: 'job', id: job.id }} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="job" parentId={job.id} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="jobs" entityId={job.id} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('delete.title')}
        description={
          (billingRefs.data ?? 0) > 0
            ? `${t('delete.confirm')} ${t('delete.billing_warning', { count: billingRefs.data })}`
            : t('delete.confirm')
        }
        confirmLabel={t('delete.button')}
        pending={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync([job.id]);
            setConfirmDelete(false);
            navigate(-1);
          } catch (e) {
            alert((e as Error).message);
          }
        }}
      />
    </div>
  );
}
