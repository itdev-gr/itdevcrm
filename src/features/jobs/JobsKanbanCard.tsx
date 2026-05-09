import { Link } from 'react-router-dom';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { CopyableCode } from '@/components/CopyableCode';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { relativeFromNow } from '@/lib/datetime';
import type { JobRow } from './hooks/useJobs';

export function JobsKanbanCard({ job }: { job: JobRow }) {
  const { data: owners = [] } = useAssignableOwners();
  const owner = job.owner_user_id ? owners.find((o) => o.user_id === job.owner_user_id) : null;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { jobId: job.id, currentStage: job.stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const contactName = [job.client?.contact_first_name, job.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const headline = contactName || job.client?.name || job.deal?.title || '—';
  const subtitle = [contactName ? job.client?.name : null, job.client?.industry]
    .filter(Boolean)
    .join(' · ');

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {job.deal?.code && <CopyableCode code={job.deal.code} className="text-[10px]" />}
              <Link to={`/jobs/${job.id}`} className="truncate text-sm font-medium hover:underline">
                {headline}
              </Link>
            </div>
            <div className="flex items-center gap-1">
              {job.service_type === 'ai_seo' && (
                <span
                  className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                  title="AI SEO"
                >
                  AI SEO
                </span>
              )}
              {job.is_blocked && (
                <span
                  className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
                  title={job.blocked_reason ?? undefined}
                >
                  🔒 Blocked
                </span>
              )}
              {job.completed_at && <span className="text-xs text-emerald-600">✓</span>}
            </div>
          </div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          {Number(job.monthly_amount ?? 0) > 0 && (
            <div className="text-xs">€{Number(job.monthly_amount).toFixed(0)}/mo</div>
          )}
          <div className="text-[10px] text-slate-500">
            👤 {owner ? owner.full_name || owner.email : 'Unassigned'}
          </div>
          <div className="text-[10px] text-slate-400">🗓 {relativeFromNow(job.updated_at)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
