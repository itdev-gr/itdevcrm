import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AlarmClock, Calendar, CheckCircle2, ListChecks, Lock, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { relativeFromNow } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import { cn } from '@/lib/utils';
import { jobAmountLabel } from './jobAmount';
import { jobCardHeading } from './jobCardTitle';
import { formatJobPeriodChip } from './jobPeriodChip';
import { formatJobDueDateChip } from './jobDueDateChip';
import { canViewJobPricing } from './permissions';
import { groupIdForServiceType } from './serviceTaskMatch';
import { useServiceTaskCounts } from './hooks/useServiceTaskCounts';
import { JobEmailStatusBadge } from './JobEmailStatusBadge';
import { JobDisconnectBadge } from './JobDisconnectBadge';
import { useAuthStore } from '@/lib/stores/authStore';
import type { JobRow } from './hooks/useJobs';

export function JobsKanbanCard({
  job,
  dragDisabled = false,
}: {
  job: JobRow;
  dragDisabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  // Resolve from the full staff directory: job owners are service-team members
  // (e.g. local_seo), who are not in the sales-only assignable_owners list.
  const { data: owners = [] } = useMentionableUsers();
  const owner = job.owner_user_id ? owners.find((o) => o.user_id === job.owner_user_id) : null;

  // Open-task count for this job: job-scoped + deal tasks tagged with this service's
  // department (one cached query per board).
  const { data: groups = [] } = useGroups();
  const taskCounts = useServiceTaskCounts(groupIdForServiceType(groups, job.service_type));
  const openTaskCount = (taskCounts.byDeal[job.deal_id] ?? 0) + (taskCounts.byJob[job.id] ?? 0);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { jobId: job.id, currentStage: job.stage_id },
    disabled: dragDisabled,
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const { headline, subtitleParts } = jobCardHeading(job);
  const subtitle = [...subtitleParts, industryLabel(job.client?.industry, lang)]
    .filter(Boolean)
    .join(' · ');
  const amountLabel = jobAmountLabel(job.billing_type, job.amount_net, lang);
  const displayCode = job.code ?? job.deal?.code ?? null;
  const periodChip = formatJobPeriodChip(
    { start: job.period_start_date ?? null, due: job.period_due_date ?? null },
    new Date(),
  );
  const rawDueDate = job.details?.['due_date'];
  const dueChip = formatJobDueDateChip(
    {
      due: typeof rawDueDate === 'string' ? rawDueDate : null,
      completed: job.completed_at != null,
    },
    new Date(),
    lang,
  );
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canViewPricing = canViewJobPricing(isAdmin, groupCodes);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} data-job-card={job.id}>
      <Card
        size="sm"
        className={cn(
          'gap-0 py-0 ring-border/60 transition-shadow hover:shadow-md',
          dragDisabled ? 'opacity-90' : 'cursor-grab active:cursor-grabbing',
          job.is_blocked && !dragDisabled && 'ring-red-200/80 dark:ring-red-900/50',
        )}
      >
        <CardContent className="space-y-2.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {displayCode && <CopyableCode code={displayCode} className="text-[10px]" />}
                {periodChip && (
                  <span
                    title={periodChip.label}
                    className={cn(
                      'rounded px-1 text-[10px] font-medium',
                      periodChip.tone === 'overdue' &&
                        'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
                      periodChip.tone === 'due-soon' &&
                        'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
                      periodChip.tone === 'ok' &&
                        'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
                    )}
                  >
                    {periodChip.label}
                  </span>
                )}
                {dueChip && (
                  <span
                    title={dueChip.tooltip}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium',
                      dueChip.tone === 'overdue' &&
                        'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
                      dueChip.tone === 'due-soon' &&
                        'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
                      dueChip.tone === 'ok' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    <AlarmClock className="size-2.5" />
                    {dueChip.label}
                  </span>
                )}
                {job.parent_job_id != null && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-semibold text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">
                    AI SEO
                  </span>
                )}
              </div>
              <Link
                to={`/jobs/${job.id}`}
                className="block truncate text-sm font-semibold hover:text-[#157777] dark:hover:text-[#7ad4d4]"
              >
                {headline}
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {openTaskCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  title={lang === 'el' ? `${openTaskCount} ανοιχτές εργασίες` : `${openTaskCount} open tasks`}
                >
                  <ListChecks className="size-3" />
                  {openTaskCount}
                </span>
              )}
              <JobDisconnectBadge job={job} />
              {job.is_blocked && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200"
                  title={
                    job.blocked_reason === 'billing_paused'
                      ? 'Billing paused'
                      : (job.blocked_reason ?? undefined)
                  }
                >
                  <Lock className="size-3" />
                  Blocked
                </span>
              )}
              {job.completed_at && (
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
              )}
            </div>
          </div>

          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}

          {canViewPricing && amountLabel !== '—' && job.parent_job_id == null && (
            <span className="inline-flex rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
              {amountLabel}
            </span>
          )}

          <div className="flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1.5">
              <User className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">
                {owner ? owner.full_name || owner.email : 'Unassigned'}
              </span>
            </div>
            <JobEmailStatusBadge job={job} variant="card" />
          </div>

          <div
            className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground"
            title={job.updated_at}
          >
            <Calendar className="size-3 shrink-0 opacity-70" />
            {relativeFromNow(job.updated_at)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
