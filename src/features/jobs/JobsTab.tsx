import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';
import { useJobsForDeal } from './hooks/useJobsForDeal';
import { useJobsForClient } from './hooks/useJobsForClient';
import { relativeFromNow, formatDate } from '@/lib/datetime';
import { jobAmountLabel } from './jobAmount';
import { canViewJobPricing } from './permissions';
import { useAuthStore } from '@/lib/stores/authStore';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { filterAssignableOwners } from './assignableOwners';
import { useAssignJobOwner } from './hooks/useAssignJobOwner';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow, ServiceType } from './hooks/useJobs';

const SERVICE_TO_KANBAN: Record<ServiceType, string> = {
  web_seo:      '/tech/web-seo',
  local_seo:    '/tech/local-seo',
  web_dev:      '/tech/web-dev',
  social_media: '/tech/social-media',
  ai_seo:       '/tech/web-seo',
  hosting:      '/tech/hosting',
  ads:          '/tech/ads',
  maintenance:  '/tech/maintenance',
  franchise:    '/tech/franchise',
  domains:      '/tech/domains',
};

const BILLING_LABEL: Record<string, { en: string; el: string }> = {
  one_time:          { en: 'One-time',  el: 'Εφάπαξ' },
  recurring_monthly: { en: 'Monthly',   el: 'Μηνιαία' },
  recurring_yearly:  { en: 'Yearly',    el: 'Ετήσια' },
};

function StageBadge({ job, lang }: { job: JobRow; lang: 'en' | 'el' }) {
  const label = job.stage
    ? (job.stage.display_names as { en?: string; el?: string })?.[lang] ?? job.stage.code
    : '—';
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/** True when a yyyy-mm-dd date is strictly before today (UTC day boundary), matching the boards' overdue semantics. */
function isDatePast(due: string | null): boolean {
  if (!due) return false;
  const dueMs = Date.parse(due + 'T00:00:00Z');
  if (Number.isNaN(dueMs)) return false;
  const now = new Date();
  return dueMs < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Read-only date cell: formatted date, red when overdue, em dash when unset. */
function DueDateCell({ date, locale }: { date: string | null; locale: string }) {
  if (!date) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span
      className={`text-xs tabular-nums ${
        isDatePast(date) ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
      }`}
    >
      {formatDate(date, locale)}
    </span>
  );
}

function BlockedBadge({ reason }: { reason: string | null }) {
  const label =
    reason === 'billing_paused'
      ? 'Billing paused'
      : (reason?.replace(/_/g, ' ') ?? 'blocked');
  return (
    <span
      className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300"
      title={reason ?? undefined}
    >
      🔒 {label}
    </span>
  );
}

type Scope =
  | { dealId: string; accountingCompletedAt: string | null }
  | { clientId: string };

export function JobsTab(props: Scope) {
  const { i18n } = useTranslation();
  const lang: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const showPricing = canViewJobPricing(isAdmin, groupCodes);
  // Assigning the owner is gated like billing/pricing: admins + accounting.
  const canAssign = isAdmin || groupCodes.includes('accounting');
  const owners = useMentionableUsers().data ?? [];
  const assignOwner = useAssignJobOwner();

  const isDeal = 'dealId' in props;
  const dealQuery = useJobsForDeal(isDeal ? props.dealId : '');
  const clientQuery = useJobsForClient(isDeal ? '' : props.clientId);
  const { data: jobs = [], isLoading, error } = isDeal ? dealQuery : clientQuery;

  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  if (error)
    return <div className="text-sm text-red-600 dark:text-red-400">{(error as Error).message}</div>;

  if (jobs.length === 0) {
    const message = isDeal
      ? props.accountingCompletedAt
        ? lang === 'el'
          ? 'Δεν δημιουργήθηκαν εργασίες. Ελέγξτε τις υπηρεσίες του deal.'
          : 'No jobs were spawned. Check the deal’s planned services.'
        : lang === 'el'
          ? 'Οι εργασίες θα δημιουργηθούν όταν το deal φτάσει σε Μερική Πληρωμή (μπλοκαρισμένες εκτός Web Dev) ή Πλήρως Εξοφλημένο.'
          : 'Jobs will be created when this deal reaches Partial Payment (blocked until full payment, except Web Dev) or Paid In Full.'
      : lang === 'el'
        ? 'Δεν υπάρχουν ακόμα εργασίες για αυτόν τον πελάτη.'
        : 'No jobs yet for this client.';
    return <p className="text-sm text-muted-foreground">{message}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border/60 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Υπηρεσία' : 'Service'}</th>
            {showPricing && (
              <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Χρέωση' : 'Billing'}</th>
            )}
            {showPricing && (
              <th className="px-4 py-3 text-right font-medium">{lang === 'el' ? 'Ποσό' : 'Amount'}</th>
            )}
            <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Στάδιο' : 'Stage'}</th>
            <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Κατάσταση' : 'Status'}</th>
            <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Ανάθεση' : 'Assigned'}</th>
            {showPricing && (
              <th className="px-4 py-3 font-medium">
                {lang === 'el' ? 'Προθεσμία πληρωμής' : 'Due date'}
              </th>
            )}
            <th className="px-4 py-3 font-medium">
              {lang === 'el' ? 'Προθεσμία παράδοσης' : 'Delivery due'}
            </th>
            {!isDeal && (
              <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Deal' : 'Deal'}</th>
            )}
            <th className="px-4 py-3 font-medium">{lang === 'el' ? 'Ενημέρωση' : 'Updated'}</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const svc = j.service_type as ServiceType;
            const billingLabel =
              BILLING_LABEL[j.billing_type]?.[lang] ?? j.billing_type;
            const amount = jobAmountLabel(j.billing_type, j.amount_net, lang);
            const deliveryDue =
              typeof j.details?.due_date === 'string' && j.details.due_date !== ''
                ? (j.details.due_date as string)
                : null;
            const owner = j.owner_user_id
              ? owners.find((o) => o.user_id === j.owner_user_id)
              : null;
            const assignable = filterAssignableOwners(owners, j.service_type, j.owner_user_id);
            return (
              <tr key={j.id} className="border-t border-border/40 transition-colors hover:bg-muted/35">
                <td className="px-4 py-3">
                  <Link
                    to={`/jobs/${j.id}`}
                    className="group inline-flex items-center gap-1.5 no-underline transition-opacity hover:opacity-85"
                  >
                    <ServiceTypeBadge serviceType={svc} />
                    <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </td>
                {showPricing && (
                  <td className="px-4 py-3 text-xs text-muted-foreground">{billingLabel}</td>
                )}
                {showPricing && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {j.parent_job_id == null ? amount : '—'}
                  </td>
                )}
                <td className="px-4 py-3">
                  <StageBadge job={j} lang={lang} />
                </td>
                <td className="px-4 py-3">
                  {j.is_blocked ? (
                    <BlockedBadge reason={j.blocked_reason} />
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {lang === 'el' ? 'Ενεργό' : 'Active'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {canAssign ? (
                    <select
                      value={j.owner_user_id ?? ''}
                      aria-label={lang === 'el' ? 'Ανάθεση' : 'Assigned'}
                      onChange={(e) =>
                        assignOwner.mutate({
                          jobId: j.id,
                          ownerUserId: e.target.value,
                          invalidate: [
                            isDeal
                              ? queryKeys.jobsForDeal(props.dealId)
                              : queryKeys.jobsForClient(props.clientId),
                            queryKeys.jobsByService(j.service_type),
                          ],
                        })
                      }
                      className="block w-full max-w-[11rem] rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="">{lang === 'el' ? '— Χωρίς ανάθεση' : '— Unassigned'}</option>
                      {assignable.map((o) => (
                        <option key={o.user_id} value={o.user_id}>
                          {o.full_name || o.email}
                        </option>
                      ))}
                    </select>
                  ) : owner ? (
                    <span className="text-xs text-muted-foreground" title={owner.full_name || owner.email}>
                      {owner.full_name || owner.email}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                {showPricing && (
                  <td className="px-4 py-3">
                    <DueDateCell date={j.period_due_date} locale={i18n.language} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <DueDateCell date={deliveryDue} locale={i18n.language} />
                </td>
                {!isDeal && (
                  <td className="px-4 py-3 text-xs">
                    {j.deal ? (
                      <Link
                        to={`/deals/${j.deal.id}`}
                        className="font-medium text-primary no-underline transition-colors hover:text-[#157777] dark:hover:text-[#7ad4d4]"
                      >
                        {j.deal.code ?? j.deal.title ?? '—'}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {relativeFromNow(j.updated_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={SERVICE_TO_KANBAN[svc] ?? '/'}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground no-underline transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                  >
                    {lang === 'el' ? 'Kanban' : 'Kanban'}
                    <ArrowUpRight className="size-3" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
