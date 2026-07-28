import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { areasForJob } from '@/features/attachments/serviceAreas';
import { useAttachments } from '@/features/attachments/hooks/useAttachments';
import { useJobIntake } from './hooks/useJobIntake';
import { useDownloadJobAssets } from './hooks/useDownloadJobAssets';
import type { JobRow } from './hooks/useJobs';

/**
 * "Download all" control at the top of the job Info tab. Gathers the same data
 * the Info sections render — the web_dev client-intake logo/files and every
 * per-service attachment area — and hands them to {@link useDownloadJobAssets}
 * to stream one `<job-code>-assets.zip`. Renders nothing when the tab has no
 * assets. react-query dedupes the intake / attachment fetches with the sections
 * already mounted below.
 */
export function DownloadAllAssetsButton({ job, lang }: { job: JobRow; lang: 'en' | 'el' }) {
  const { t } = useTranslation('jobs');

  // Intake only exists for web_dev jobs; passing '' disables the query (the hook
  // gates on `enabled: !!jobId`) so non-web_dev jobs don't fire a wasted fetch.
  const { data: intake } = useJobIntake(job.service_type === 'web_dev' ? job.id : '');
  const { data: attachmentRows = [] } = useAttachments('job', job.id);

  const areas = useMemo(
    () =>
      areasForJob({ service_type: job.service_type }).map((area) => ({
        kind: area.kind,
        label: lang === 'el' ? area.labelEl : area.labelEn,
      })),
    [job.service_type, lang],
  );

  const { run, running, progress, total } = useDownloadJobAssets(job, intake, attachmentRows, areas);
  const [failed, setFailed] = useState(0);

  if (total === 0) return null;

  async function onClick() {
    setFailed(0);
    const { failed: n } = await run();
    setFailed(n);
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {failed > 0 && (
        <span className="text-[11px] text-destructive">
          {t('info_assets.partial_failed', { failed })}
        </span>
      )}
      <Button type="button" size="xs" variant="outline" disabled={running} onClick={onClick}>
        <Download className="size-3" />
        {running ? t('info_assets.downloading', progress) : t('info_assets.download_all')}
      </Button>
    </div>
  );
}
