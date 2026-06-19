import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Lock, Trash2 } from 'lucide-react';
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CopyableCode } from '@/components/CopyableCode';
import {
  DetailTabsList,
  FilterSelect,
  commentsPanelBodyClass,
  commentsPanelHeaderClass,
  commentsPanelShellClass,
  detailOverviewWithCommentsGridClass,
  detailTabTriggerClass,
} from '@/components/layout/page-shell';
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
import { cn } from '@/lib/utils';
import type { ServiceType } from './hooks/useJobs';

const JOB_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  ended: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
};

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

  if (isLoading) return <div className="px-4 py-6 sm:px-6 lg:px-8 text-sm text-muted-foreground">…</div>;
  if (error || !job) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error?.message ?? 'Not found'}
        </div>
      </div>
    );
  }

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
    <div className="flex min-h-full flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8 lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="rounded-xl border border-border/60 bg-card p-3.5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary dark:text-[#7ad4d4]">
                Job
              </span>
              {job.code && <CopyableCode code={job.code} className="text-[11px]" />}
              {job.is_blocked && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/50 dark:text-red-300"
                  title={job.blocked_reason ?? undefined}
                >
                  <Lock className="size-2.5" />
                  Blocked
                  {job.blocked_reason ? ` · ${job.blocked_reason.replace(/_/g, ' ')}` : ''}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-lg font-bold tracking-tight sm:text-xl">{fullName}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {job.service_type.replace(/_/g, ' ')}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3 opacity-70" />
                {formatDate(job.created_at)}
              </span>
              <span>·</span>
              <span>{relativeFromNow(job.created_at)}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {canBlockJob &&
              (job.is_blocked ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => unblock.mutate()}
                  disabled={unblock.isPending}
                >
                  Unblock
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => block.mutate({ reason: 'manual' })}
                  disabled={block.isPending}
                >
                  Block
                </Button>
              ))}
            {isAdmin && (
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3" />
                {t('delete.button')}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/25 p-2">
          {boardStages.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Label htmlFor="job-stage" className="text-[11px] font-medium text-muted-foreground">
                Stage
              </Label>
              <FilterSelect
                id="job-stage"
                value={job.stage_id ?? ''}
                onChange={(e) => onChangeStage(e.target.value)}
                disabled={moveStage.isPending}
                className="h-8 min-w-[150px] px-2 text-xs"
              >
                {boardStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.display_names as { en: string; el: string })[lang]}
                  </option>
                ))}
              </FilterSelect>
            </div>
          )}
          {owner && (
            <div className="flex items-center gap-1.5">
              <Label className="text-[11px] font-medium text-muted-foreground">Owner</Label>
              <span className="inline-flex h-8 items-center rounded-lg border border-input/80 bg-background px-2.5 text-xs text-foreground">
                {owner.full_name || owner.email}
              </span>
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="lg:min-h-0 lg:flex-1 lg:flex lg:flex-col">
        <DetailTabsList>
          <TabsTrigger value="overview" className={detailTabTriggerClass}>
            Overview
          </TabsTrigger>
          {infoFieldsFor(job.service_type).length > 0 && (
            <TabsTrigger value="info" className={detailTabTriggerClass}>
              Info
            </TabsTrigger>
          )}
          <TabsTrigger value="tasks" className={detailTabTriggerClass}>
            Tasks
          </TabsTrigger>
          <TabsTrigger value="attachments" className={detailTabTriggerClass}>
            Attachments
          </TabsTrigger>
          <TabsTrigger value="activity" className={detailTabTriggerClass}>
            Activity
          </TabsTrigger>
        </DetailTabsList>

        <TabsContent value="overview" className="mt-3 outline-none lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          <div className={`${detailOverviewWithCommentsGridClass} lg:h-full lg:min-h-0`}>
            <div className="min-w-0 space-y-3 lg:h-full lg:overflow-auto lg:pr-1">
              {job.billing_type === 'recurring_monthly' && infoFieldsFor(job.service_type).length === 0 && (
                <MonthlyTasksPanel
                  jobId={job.id}
                  serviceType={job.service_type}
                  isBlocked={!!job.is_blocked}
                />
              )}
              <ContactsCard client={job.client ?? null} />
              <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Project info
                </h2>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Service</dt>
                    <dd className="mt-0.5 text-sm font-medium capitalize">
                      {job.service_type.replace(/_/g, ' ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Status</dt>
                    <dd className="mt-0.5">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
                          JOB_STATUS_STYLES[job.status] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {job.status}
                      </span>
                    </dd>
                  </div>
                  {Number(job.one_time_amount ?? 0) > 0 && (
                    <div>
                      <dt className="text-[11px] text-muted-foreground">One-time</dt>
                      <dd className="mt-0.5 text-sm font-medium tabular-nums">
                        €{Number(job.one_time_amount).toFixed(2)}
                      </dd>
                    </div>
                  )}
                  {job.client && (
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Client</dt>
                      <dd className="mt-0.5">
                        <Link
                          to={`/clients/${job.client.id}`}
                          className="text-sm font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {job.client.name}
                        </Link>
                      </dd>
                    </div>
                  )}
                  {job.deal && (
                    <div>
                      <dt className="text-[11px] text-muted-foreground">Deal</dt>
                      <dd className="mt-0.5">
                        <Link
                          to={`/deals/${job.deal.id}`}
                          className="text-sm font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {job.deal.code ?? job.deal.title}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            </div>

            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <div className={commentsPanelShellClass}>
                <div className={commentsPanelHeaderClass}>
                  <h2 className="text-sm font-semibold">Comments</h2>
                </div>
                <div className={commentsPanelBodyClass}>
                  <CommentsPanel parentType="job" parentId={job.id} />
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>

        {infoFieldsFor(job.service_type).length > 0 && (
          <TabsContent value="info" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
            <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
              <JobInfoPanel
                jobId={job.id}
                serviceType={job.service_type}
                initialDetails={(job.details ?? {}) as Record<string, unknown>}
              />
            </div>
          </TabsContent>
        )}
        <TabsContent value="tasks" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <AssignedTasksTab source={{ kind: 'job', id: job.id }} />
          </div>
        </TabsContent>
        <TabsContent value="attachments" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <AttachmentsPanel parentType="job" parentId={job.id} />
          </div>
        </TabsContent>
        <TabsContent value="activity" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <ActivityPanel entityType="jobs" entityId={job.id} />
          </div>
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
