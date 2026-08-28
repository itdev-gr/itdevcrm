import { useTranslation } from 'react-i18next';
import { PlugZap, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { disconnectStatus } from './disconnectStatus';
import type { JobRow } from './hooks/useJobs';

/**
 * Red "Disconnect" / green "Disconnected" pill for Local SEO jobs. Shown on the
 * kanban card (top-right action group) and in the job-page header. Pure
 * presentation — the rule lives in disconnectStatus(); the action lives in
 * JobDisconnectCard on the job page.
 */
export function JobDisconnectBadge({ job, className }: { job: JobRow; className?: string }) {
  const { t } = useTranslation('jobs');
  const status = disconnectStatus(job);
  if (!status) return null;

  const needs = status === 'needs_disconnect';
  return (
    <span
      data-disconnect-status={status}
      title={
        needs
          ? t('disconnect.pill_needs_title')
          : t('disconnect.pill_done_title', { date: formatDate(job.disconnected_at ?? '') })
      }
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold',
        needs
          ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200'
          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
        className,
      )}
    >
      {needs ? <Unplug className="size-3" /> : <PlugZap className="size-3" />}
      {needs ? t('disconnect.pill_needs') : t('disconnect.pill_done')}
    </span>
  );
}
