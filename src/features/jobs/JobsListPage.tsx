// src/features/jobs/JobsListPage.tsx
// Hosting-style flat list of a board's jobs. Extracted verbatim from
// HostingListPage so Hosting and Support render identically; Support adds
// the blocked chip / admin override via showBlocked.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { useJobs, type JobRow, type ServiceType } from '@/features/jobs/hooks/useJobs';
import { useMoveJobStage } from '@/features/jobs/hooks/useMoveJobStage';
import { useUnblockJob } from '@/features/jobs/hooks/useBlockJob';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import {
  filterAndSortJobsList,
  jobListDomain,
  jobListStatus,
  type JobListStatus,
  type JobListStatusOpts,
} from './jobsList';

type StatusFilter = 'active' | 'done' | 'all';
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

const REBLOCK_HINT = 'Billing re-blocks automatically if the payment is still overdue.';

export type JobsListPageProps = {
  /** Board code === service type for the boards using this page. */
  serviceType: ServiceType;
  title: string;
  description: string;
  dueColumnLabel: string;
  /** Stage codes that read as Done. Flipping to Done always writes 'closed'. */
  doneStageCodes: readonly string[];
  /** true = blocked jobs show the red chip (admins get an override dropdown). */
  showBlocked: boolean;
};

function StatusCell({
  job,
  status,
  canOverrideBlocked,
  onSetStatus,
}: {
  job: JobRow;
  status: JobListStatus;
  canOverrideBlocked: boolean;
  onSetStatus: (jobId: string, next: 'active' | 'done') => void;
}) {
  const unblock = useUnblockJob(job.id);

  if (status === 'blocked' && !canOverrideBlocked) {
    return (
      <span
        title={REBLOCK_HINT}
        className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200"
      >
        Blocked
      </span>
    );
  }

  if (status === 'blocked') {
    return (
      <select
        value="blocked"
        disabled={unblock.isPending}
        title={REBLOCK_HINT}
        onChange={async (e) => {
          const next = e.target.value as 'blocked' | 'active' | 'done';
          if (next === 'blocked') return;
          try {
            await unblock.mutateAsync();
            if (next === 'done') onSetStatus(job.id, 'done');
          } catch (err) {
            alert((err as Error).message);
          }
        }}
        className="rounded-full border border-red-300/80 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
      >
        <option value="blocked">Blocked</option>
        <option value="active">Active</option>
        <option value="done">Done</option>
      </select>
    );
  }

  return (
    <select
      value={status}
      onChange={(e) => onSetStatus(job.id, e.target.value as 'active' | 'done')}
      className={cn(
        'rounded-full border border-border/70 bg-background px-2 py-1 text-xs font-medium shadow-sm',
        status === 'active' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground',
      )}
    >
      <option value="active">Active</option>
      <option value="done">Done</option>
    </select>
  );
}

export function JobsListPage({
  serviceType,
  title,
  description,
  dueColumnLabel,
  doneStageCodes,
  showBlocked,
}: JobsListPageProps) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { data: jobs = [], isLoading } = useJobs(serviceType);
  const { data: stages = [] } = usePipelineStages();
  const move = useMoveJobStage(serviceType);

  const boardStages = stages.filter((s) => s.board === serviceType && !s.archived);
  const activeStageId = boardStages.find((s) => s.code === 'active')?.id;
  const closedStageId = boardStages.find((s) => s.code === 'closed')?.id;

  const statusOpts: JobListStatusOpts = {
    doneStageIds: new Set(boardStages.filter((s) => doneStageCodes.includes(s.code)).map((s) => s.id)),
    doneStageCodes: new Set(doneStageCodes),
    blockedAware: showBlocked,
  };

  const rows = filterAndSortJobsList(jobs, { status, search: query }, statusOpts);

  function setJobStatus(jobId: string, next: 'active' | 'done') {
    const stageId = next === 'done' ? closedStageId : activeStageId;
    if (!stageId) return;
    move.mutate({ jobId, stageId, completed: next === 'done' });
  }

  if (isLoading) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 text-sm text-muted-foreground">…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={title} description={description} />

      <FilterBar>
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by client, domain, code…"
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors',
                status === f.key
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/40',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {rows.length} / {jobs.length}
        </span>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-sm text-muted-foreground">
            No {title.toLowerCase()} jobs match.
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">{dueColumnLabel}</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => {
                  const domain = jobListDomain(j);
                  const st = jobListStatus(j, statusOpts);
                  return (
                    <tr
                      key={j.id}
                      className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35"
                    >
                      <td className="max-w-[320px] px-4 py-3">
                        <Link
                          to={`/jobs/${j.id}`}
                          className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {j.client?.name ?? j.code ?? '—'}
                        </Link>
                        {j.code && <p className="truncate text-xs text-muted-foreground">{j.code}</p>}
                      </td>
                      <td className="max-w-[240px] px-4 py-3">
                        {domain ? (
                          <a
                            href={domain.startsWith('http') ? domain : `https://${domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-xs text-primary hover:underline"
                          >
                            {domain}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {j.period_due_date ? (
                          formatDate(j.period_due_date, lang)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusCell
                          job={j}
                          status={st}
                          canOverrideBlocked={isAdmin}
                          onSetStatus={setJobStatus}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default JobsListPage;
