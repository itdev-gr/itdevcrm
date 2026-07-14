import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { formatCommentTime } from '@/features/comments/comment-utils';
import type { AttachmentRow } from '@/features/attachments/hooks/useAttachments';
import { AttachmentGallery } from '@/features/attachments/AttachmentGallery';
import { useDealJobs } from './hooks/useDealJobs';

/** Files uploaded on the deal's JOB pages (any kind), read-only on the deal —
 *  upload/delete stays on the owning job. Renders nothing when there are none. */
export function DealJobFiles({ dealId }: { dealId: string }) {
  const { t, i18n } = useTranslation('sales');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-GB';
  const { data: jobs = [] } = useDealJobs(dealId);
  const jobIds = jobs.map((j) => j.id);
  const codeByJob = new Map(jobs.map((j) => [j.id, j.code]));

  const { data: files = [] } = useQuery<AttachmentRow[]>({
    queryKey: ['deal-job-files', dealId, jobIds.join(',')] as const,
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('parent_type', 'job')
        .in('parent_id', jobIds)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AttachmentRow[];
    },
  });

  if (files.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('attachments.sections.job_files')}
      </h2>
      <AttachmentGallery
        files={files}
        tileCaption={(f) => codeByJob.get(f.parent_id) ?? formatCommentTime(f.created_at, locale).label}
        rowMeta={(f) => {
          const time = formatCommentTime(f.created_at, locale);
          return (
            <>
              {codeByJob.get(f.parent_id) && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
                  {codeByJob.get(f.parent_id)}
                </span>
              )}
              <time className="text-xs text-muted-foreground" title={time.title}>
                {time.label}
              </time>
            </>
          );
        }}
      />
    </section>
  );
}
