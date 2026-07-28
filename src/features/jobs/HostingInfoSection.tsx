import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { useJobsForClient } from '@/features/jobs/hooks/useJobsForClient';
import { jobListStatus } from '@/features/jobs/jobsList';

/** Matches the old hostingStatus(job): Done iff the job sits in 'closed'. */
const HOSTING_STATUS_OPTS = { doneStageCodes: new Set(['closed']), blockedAware: false } as const;

/**
 * Read-only cross-reference for a web_dev job's Info tab: if the client also has
 * hosting, list each hosting job with its status + renewal date + a link to it.
 * Renders nothing when the client has no hosting job.
 */
export function HostingInfoSection({ clientId }: { clientId: string }) {
  const { data: jobs = [] } = useJobsForClient(clientId);
  const hosting = jobs.filter((j) => j.service_type === 'hosting' && !j.archived);
  if (hosting.length === 0) return null;

  return (
    <div className="border-t border-border/60 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hosting</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {hosting.map((j) => {
          const done = jobListStatus(j, HOSTING_STATUS_OPTS) === 'done';
          return (
            <li key={j.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                to={`/jobs/${j.id}`}
                className="font-mono text-xs font-medium text-primary hover:underline"
              >
                {j.code ?? j.id}
              </Link>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  done
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
                )}
              >
                {done ? 'Done' : 'Active'}
              </span>
              {j.period_due_date && (
                <span className="text-xs text-muted-foreground">
                  renews {formatDate(j.period_due_date)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
