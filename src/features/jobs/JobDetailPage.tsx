import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CopyableCode } from '@/components/CopyableCode';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { useJob } from './hooks/useJob';
import { MonthlyTasksPanel } from './MonthlyTasksPanel';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { useMoveJobStage } from './hooks/useMoveJobStage';
import { useBlockJob, useUnblockJob } from './hooks/useBlockJob';
import { useAuthStore } from '@/lib/stores/authStore';
import { formatDate, relativeFromNow } from '@/lib/datetime';
import type { ServiceType } from './hooks/useJobs';

export function JobDetailPage() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: job, isLoading, error } = useJob(jobId);
  const { data: owners = [] } = useAssignableOwners();
  const { data: stages = [] } = usePipelineStages();

  const serviceType = (job?.service_type ?? '') as ServiceType;
  const moveStage = useMoveJobStage(serviceType);
  const block = useBlockJob(job?.id ?? '');
  const unblock = useUnblockJob(job?.id ?? '');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canBlockJob = isAdmin || groupCodes.includes('accounting');

  if (isLoading) return <div className="p-8">…</div>;
  if (error || !job)
    return <div className="p-8 text-red-600">{error?.message ?? 'Not found'}</div>;

  const owner = job.owner_user_id ? owners.find((o) => o.user_id === job.owner_user_id) : null;
  const boardStages = stages
    .filter((s) => s.board === job.service_type && !s.archived)
    .sort((a, b) => a.position - b.position);

  async function onChangeStage(stageId: string) {
    if (!job || job.stage_id === stageId) return;
    try {
      await moveStage.mutateAsync({ jobId: job.id, stageId });
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
            {job.deal?.code && <CopyableCode code={job.deal.code} className="text-xs" />}
            <h1 className="text-2xl font-bold">{fullName}</h1>
            {job.is_blocked && (
              <span
                className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                title={job.blocked_reason ?? undefined}
              >
                🔒 Blocked
                {job.blocked_reason ? ` · ${job.blocked_reason.replace(/_/g, ' ')}` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {job.service_type} · {job.billing_type} · 🗓 {formatDate(job.created_at)} ·{' '}
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
              <span className="rounded-md border border-input bg-slate-50 px-2 py-1 text-sm text-slate-700">
                {owner.full_name || owner.email}
              </span>
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-3 pt-4">
          {job.billing_type === 'recurring_monthly' && (
            <MonthlyTasksPanel
              jobId={job.id}
              serviceType={job.service_type}
              isBlocked={!!job.is_blocked}
            />
          )}
          <div className="grid grid-cols-2 gap-4 rounded-md border bg-slate-50 p-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">Service</div>
              <div className="font-medium">{job.service_type}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Billing</div>
              <div className="font-medium">{job.billing_type}</div>
            </div>
            {Number(job.monthly_amount ?? 0) > 0 && (
              <div>
                <div className="text-xs text-slate-500">Monthly</div>
                <div className="font-medium">€{Number(job.monthly_amount).toFixed(2)}</div>
              </div>
            )}
            {Number(job.one_time_amount ?? 0) > 0 && (
              <div>
                <div className="text-xs text-slate-500">One-time</div>
                <div className="font-medium">€{Number(job.one_time_amount).toFixed(2)}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-slate-500">Status</div>
              <div className="font-medium">{job.status}</div>
            </div>
            {job.client && (
              <div>
                <div className="text-xs text-slate-500">Client</div>
                <Link
                  to={`/clients/${job.client.id}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {job.client.name}
                </Link>
              </div>
            )}
            {job.deal && (
              <div>
                <div className="text-xs text-slate-500">Deal</div>
                <Link
                  to={`/deals/${job.deal.id}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {job.deal.code ?? job.deal.title}
                </Link>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <CommentsPanel parentType="job" parentId={job.id} />
        </TabsContent>
        <TabsContent value="attachments" className="pt-4">
          <AttachmentsPanel parentType="job" parentId={job.id} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel entityType="jobs" entityId={job.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
