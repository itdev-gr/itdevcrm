import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, CheckCircle2, Lock, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { relativeFromNow } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import { cn } from '@/lib/utils';
import { jobAmountLabel } from './jobAmount';
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

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { jobId: job.id, currentStage: job.stage_id },
    disabled: dragDisabled,
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const contactName = [job.client?.contact_first_name, job.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const headline = contactName || job.client?.name || job.deal?.title || '—';
  const subtitle = [contactName ? job.client?.name : null, industryLabel(job.client?.industry, lang)]
    .filter(Boolean)
    .join(' · ');
  const amountLabel = jobAmountLabel(job.billing_type, job.amount_net, lang);
  const displayCode = job.code ?? job.deal?.code ?? null;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
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
              {job.is_blocked && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200"
                  title={job.blocked_reason ?? undefined}
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

          {amountLabel !== '—' && (
            <span className="inline-flex rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
              {amountLabel}
            </span>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <User className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {owner ? owner.full_name || owner.email : 'Unassigned'}
            </span>
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
