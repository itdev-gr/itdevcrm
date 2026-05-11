import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { relativeFromNow } from '@/lib/datetime';
import type { JobRow, ServiceType } from '@/features/jobs/hooks/useJobs';

const SERVICE_LABELS: Record<ServiceType, { en: string; el: string }> = {
  web_seo:      { en: 'Web SEO',         el: 'Web SEO' },
  local_seo:    { en: 'Local SEO',       el: 'Local SEO' },
  web_dev:      { en: 'Web Development', el: 'Ανάπτυξη Ιστοσελίδων' },
  social_media: { en: 'Social Media',    el: 'Social Media' },
  ai_seo:       { en: 'AI SEO',          el: 'AI SEO' },
  hosting:      { en: 'Hosting',         el: 'Hosting' },
  ads:          { en: 'Ads',             el: 'Διαφημίσεις' },
};

// ai_seo lives on the web_seo kanban (no separate route).
const SERVICE_TO_KANBAN: Record<ServiceType, string> = {
  web_seo:      '/tech/web-seo',
  local_seo:    '/tech/local-seo',
  web_dev:      '/tech/web-dev',
  social_media: '/tech/social-media',
  ai_seo:       '/tech/web-seo',
  hosting:      '/tech/hosting',
  ads:          '/tech/ads',
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
    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      {label}
    </span>
  );
}

function BlockedBadge({ reason }: { reason: string | null }) {
  const label = reason?.replace(/_/g, ' ') ?? 'blocked';
  return (
    <span
      className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700"
      title={reason ?? undefined}
    >
      🔒 {label}
    </span>
  );
}

type Props = {
  dealId: string;
  accountingCompletedAt: string | null;
};

export function JobsTab({ dealId, accountingCompletedAt }: Props) {
  const { i18n } = useTranslation();
  const lang: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: jobs = [], isLoading, error } = useJobsForDeal(dealId);

  if (isLoading) return <div className="text-sm text-slate-500">…</div>;
  if (error)
    return <div className="text-sm text-red-600">{(error as Error).message}</div>;

  if (jobs.length === 0) {
    const message = accountingCompletedAt
      ? lang === 'el'
        ? 'Δεν δημιουργήθηκαν εργασίες. Ελέγξτε τις υπηρεσίες του deal.'
        : 'No jobs were spawned. Check the deal’s planned services.'
      : lang === 'el'
        ? 'Οι εργασίες θα δημιουργηθούν όταν το deal φτάσει σε Μερική Πληρωμή (μπλοκαρισμένες εκτός Web Dev) ή Πλήρως Εξοφλημένο.'
        : 'Jobs will be created when this deal reaches Partial Payment (blocked until full payment, except Web Dev) or Paid In Full.';
    return <p className="text-sm text-muted-foreground">{message}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-normal">{lang === 'el' ? 'Υπηρεσία' : 'Service'}</th>
            <th className="px-3 py-2 font-normal">{lang === 'el' ? 'Χρέωση' : 'Billing'}</th>
            <th className="px-3 py-2 font-normal text-right">{lang === 'el' ? 'Ποσό' : 'Amount'}</th>
            <th className="px-3 py-2 font-normal">{lang === 'el' ? 'Στάδιο' : 'Stage'}</th>
            <th className="px-3 py-2 font-normal">{lang === 'el' ? 'Κατάσταση' : 'Status'}</th>
            <th className="px-3 py-2 font-normal">{lang === 'el' ? 'Ενημέρωση' : 'Updated'}</th>
            <th className="px-3 py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const svc = j.service_type as ServiceType;
            const svcLabel = SERVICE_LABELS[svc]?.[lang] ?? svc;
            const billingLabel =
              BILLING_LABEL[j.billing_type]?.[lang] ?? j.billing_type;
            const amount =
              Number(j.monthly_amount ?? 0) > 0
                ? `€${Number(j.monthly_amount).toFixed(0)}/${lang === 'el' ? 'μήνα' : 'mo'}`
                : Number(j.one_time_amount ?? 0) > 0
                  ? `€${Number(j.one_time_amount).toFixed(0)}`
                  : '—';
            return (
              <tr key={j.id} className="border-t hover:bg-slate-50/60">
                <td className="px-3 py-2">
                  <Link
                    to={`/jobs/${j.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {svcLabel}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{billingLabel}</td>
                <td className="px-3 py-2 text-right tabular-nums">{amount}</td>
                <td className="px-3 py-2">
                  <StageBadge job={j} lang={lang} />
                </td>
                <td className="px-3 py-2">
                  {j.is_blocked ? (
                    <BlockedBadge reason={j.blocked_reason} />
                  ) : (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {lang === 'el' ? 'Ενεργό' : 'Active'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {relativeFromNow(j.updated_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    to={SERVICE_TO_KANBAN[svc] ?? '/'}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    {lang === 'el' ? 'Άνοιγμα kanban →' : 'Open kanban →'}
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
