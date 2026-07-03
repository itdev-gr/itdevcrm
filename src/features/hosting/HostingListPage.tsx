// src/features/hosting/HostingListPage.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { useJobs } from '@/features/jobs/hooks/useJobs';
import { useMoveJobStage } from '@/features/jobs/hooks/useMoveJobStage';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { filterAndSortHosting, hostingDomain, hostingStatus } from './hostingList';

type StatusFilter = 'active' | 'done' | 'all';
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

export function HostingListPage() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const { data: jobs = [], isLoading } = useJobs('hosting');
  const { data: stages = [] } = usePipelineStages();
  const move = useMoveJobStage('hosting');

  const hostingStages = stages.filter((s) => s.board === 'hosting' && !s.archived);
  const activeStageId = hostingStages.find((s) => s.code === 'active')?.id;
  const doneStageId = hostingStages.find((s) => s.code === 'closed')?.id;

  const rows = filterAndSortHosting(jobs, { status, search: query, doneStageId });

  function setJobStatus(jobId: string, next: 'active' | 'done') {
    const stageId = next === 'done' ? doneStageId : activeStageId;
    if (!stageId) return;
    move.mutate({ jobId, stageId, completed: next === 'done' });
  }

  if (isLoading) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 text-sm text-muted-foreground">…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Hosting" description="Yearly hosting — Active & Done." />

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
            No hosting jobs match.
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Renewal due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => {
                  const domain = hostingDomain(j);
                  const st = hostingStatus(j, doneStageId);
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
                        <select
                          value={st}
                          onChange={(e) => setJobStatus(j.id, e.target.value as 'active' | 'done')}
                          className={cn(
                            'rounded-full border border-border/70 bg-background px-2 py-1 text-xs font-medium shadow-sm',
                            st === 'active'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-muted-foreground',
                          )}
                        >
                          <option value="active">Active</option>
                          <option value="done">Done</option>
                        </select>
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

export default HostingListPage;
