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
  detailHeaderBannerClass,
  detailHeaderCardClass,
  detailHeaderChipClass,
  detailHeaderControlGroupClass,
  detailHeaderActionsClass,
  detailHeaderActionButtonClass,
  detailHeaderLabelClass,
  detailHeaderMainClass,
  detailHeaderMetaClass,
  detailHeaderOwnerClass,
  detailHeaderRecordBadgeClass,
  detailHeaderRowClass,
  detailHeaderSelectClass,
  detailHeaderStatusBadgeClass,
  detailHeaderTitleClass,
  detailOverviewWithCommentsGridClass,
  detailTabTriggerClass,
} from '@/components/layout/page-shell';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { areasForJob, canUploadArea } from '@/features/attachments/serviceAreas';
import { ServiceAttachmentsSection } from '@/features/attachments/ServiceAttachmentsSection';
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
import { jobAmountLabel } from './jobAmount';
import { canViewJobPricing } from './permissions';
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
  const { data: parentJob } = useJob(job?.parent_job_id ?? '');
  const { data: owners = [] } = useMentionableUsers();
  const { data: stages = [] } = usePipelineStages();

  const serviceType = (job?.service_type ?? '') as ServiceType;
  const moveStage = useMoveJobStage(serviceType);
  const block = useBlockJob(job?.id ?? '');
  const unblock = useUnblockJob(job?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canBlockJob = isAdmin || groupCodes.includes('accounting');
  const canViewPricing = canViewJobPricing(isAdmin, groupCodes);
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
    <div className="flex min-h-full flex-col gap-1.5 px-4 py-2 sm:px-6 lg:px-8 lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className={detailHeaderCardClass}>
        <div className={detailHeaderRowClass}>
          <div className={detailHeaderMainClass}>
            <h1 className={detailHeaderTitleClass}>{fullName}</h1>
            <span
              className={cn(
                detailHeaderRecordBadgeClass,
                'bg-primary/10 text-primary dark:text-[#7ad4d4]',
              )}
            >
              Job
            </span>
            {job.code && <CopyableCode code={job.code} className="text-[11px]" />}
            {job.is_blocked && (
              <span
                className={cn(
                  detailHeaderStatusBadgeClass,
                  'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
                )}
                title={job.blocked_reason ?? undefined}
              >
                <Lock className="size-2.5" />
                Blocked
                {job.blocked_reason ? ` · ${job.blocked_reason.replace(/_/g, ' ')}` : ''}
              </span>
            )}
            <span
              className="hidden h-3.5 w-px shrink-0 bg-border/50 sm:inline-block"
              aria-hidden="true"
            />
            <span className={detailHeaderChipClass}>{job.service_type.replace(/_/g, ' ')}</span>
            <span className={detailHeaderMetaClass}>
              <Calendar className="size-3 opacity-70" />
              {formatDate(job.created_at)}
              <span className="opacity-60">·</span>
              {relativeFromNow(job.created_at)}
            </span>
            {boardStages.length > 0 && (
              <div className={detailHeaderControlGroupClass}>
                <Label htmlFor="job-stage" className={detailHeaderLabelClass}>
                  Stage
                </Label>
                <FilterSelect
                  id="job-stage"
                  value={job.stage_id ?? ''}
                  onChange={(e) => onChangeStage(e.target.value)}
                  disabled={moveStage.isPending}
                  className={detailHeaderSelectClass}
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
              <div className={detailHeaderControlGroupClass}>
                <Label className={detailHeaderLabelClass}>Owner</Label>
                <span className={detailHeaderOwnerClass} title={owner.full_name || owner.email}>
                  {owner.full_name || owner.email}
                </span>
              </div>
            )}
            {job.parent_job_id && (
              <span className={detailHeaderBannerClass}>
                {t('part_of_ai_seo', { code: parentJob?.code ?? '' })}{' '}
                <Link to={`/jobs/${job.parent_job_id}`} className="underline underline-offset-2">
                  {t('view_billing_record')}
                </Link>
              </span>
            )}
          </div>

          <div className={detailHeaderActionsClass}>
            {canBlockJob &&
              (job.is_blocked ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={detailHeaderActionButtonClass}
                  onClick={() => unblock.mutate()}
                  disabled={unblock.isPending}
                >
                  Unblock
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className={detailHeaderActionButtonClass}
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
                className={detailHeaderActionButtonClass}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3" />
                {t('delete.button')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
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

        <TabsContent value="overview" className="mt-1 outline-none lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          <div className={`${detailOverviewWithCommentsGridClass} lg:h-full lg:min-h-0`}>
            <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">
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
                  {canViewPricing && job.parent_job_id == null && Number(job.amount_net ?? 0) > 0 && (
                    <div>
                      <dt className="text-[11px] text-muted-foreground">
                        {job.billing_type === 'recurring_monthly'
                          ? 'Monthly'
                          : job.billing_type === 'recurring_yearly'
                            ? 'Yearly'
                            : 'One-time'}
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium tabular-nums">
                        {jobAmountLabel(job.billing_type, job.amount_net, lang)}
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

            <aside className="min-w-0 lg:h-full lg:min-h-0">
              <div className={cn(commentsPanelShellClass, 'lg:h-full lg:min-h-0')}>
                <div className={commentsPanelHeaderClass}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Comments
                  </h2>
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
            <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
              <JobInfoPanel
                jobId={job.id}
                serviceType={job.service_type}
                initialDetails={(job.details ?? {}) as Record<string, unknown>}
              />
              {areasForJob(job).map((area) => (
                <ServiceAttachmentsSection
                  key={area.kind}
                  jobId={job.id}
                  area={area}
                  canUpload={canUploadArea(isAdmin, groupCodes, area)}
                  lang={lang}
                />
              ))}
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
            <AttachmentsPanel
              parentType="job"
              parentId={job.id}
              hideKinds={['svc_local', 'svc_web', 'svc_webdev']}
            />
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
