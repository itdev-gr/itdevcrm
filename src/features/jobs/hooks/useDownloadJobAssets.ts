import { useCallback, useMemo, useState } from 'react';
import { downloadZip } from 'client-zip';
import { supabase } from '@/lib/supabase';
import { buildZipEntries, type AssetBucket, type AttachmentArea } from '../assetZip';
import type { JobRow } from './useJobs';
import type { JobIntakeFile, JobIntakeForm } from './useJobIntake';
import type { AttachmentRow } from '@/features/attachments/hooks/useAttachments';

export type DownloadProgress = { done: number; total: number };

type IntakeData = { form: JobIntakeForm | null; files: JobIntakeFile[] } | undefined;
type AreaInput = { kind: string; label: string };

const SIGN_TTL_SECONDS = 300;

// Save a blob to disk via a transient object-URL anchor — the pattern from
// accounting_report/utils/exportCSV.ts.
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Bundle every asset on a job's Info tab into one `<job-code>-assets.zip`.
 *
 * The pure {@link buildZipEntries} helper maps the client-intake logo/files and
 * the per-service attachment rows to `{ bucket, path, zipName }` entries. This
 * hook batch-signs the paths per bucket (`createSignedUrls`), fetches each URL
 * sequentially (reporting `{ done, total }` progress), and streams the
 * successful fetches into a ZIP with `client-zip`. Failures don't abort the
 * run — they're counted and returned so the caller can surface a partial note.
 */
export function useDownloadJobAssets(
  job: Pick<JobRow, 'code'>,
  intake: IntakeData,
  attachmentRows: AttachmentRow[],
  areas: AreaInput[],
) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress>({ done: 0, total: 0 });

  const entries = useMemo(() => {
    const attachmentAreas: AttachmentArea[] = areas.map((area) => ({
      label: area.label,
      files: attachmentRows.filter((row) => row.kind === area.kind),
    }));
    return buildZipEntries({
      logoPath: intake?.form?.logo_path ?? null,
      intakeFiles: intake?.files ?? [],
      attachmentAreas,
    });
  }, [areas, attachmentRows, intake]);

  const run = useCallback(async (): Promise<{ failed: number }> => {
    if (entries.length === 0) return { failed: 0 };
    setRunning(true);
    setProgress({ done: 0, total: entries.length });
    try {
      // Batch-sign each bucket's paths once. Key by `${bucket}\n${path}` since a
      // path is only unique within its bucket.
      const signedByKey = new Map<string, string>();
      const buckets: AssetBucket[] = ['client-intake', 'attachments'];
      for (const bucket of buckets) {
        const paths = entries.filter((e) => e.bucket === bucket).map((e) => e.path);
        if (paths.length === 0) continue;
        const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGN_TTL_SECONDS);
        if (error || !data) continue; // every entry in this bucket will be counted as failed
        for (const item of data) {
          if (item.path && item.signedUrl) signedByKey.set(`${bucket}\n${item.path}`, item.signedUrl);
        }
      }

      const zipInputs: { name: string; input: Response }[] = [];
      let failed = 0;
      let done = 0;
      for (const entry of entries) {
        const url = signedByKey.get(`${entry.bucket}\n${entry.path}`);
        let ok = false;
        if (url) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              zipInputs.push({ name: entry.zipName, input: res });
              ok = true;
            }
          } catch {
            // network error — treated as a failure below
          }
        }
        if (!ok) failed += 1;
        done += 1;
        setProgress({ done, total: entries.length });
      }

      if (zipInputs.length > 0) {
        const blob = await downloadZip(zipInputs).blob();
        saveBlob(blob, `${job.code ?? 'job'}-assets.zip`);
      }
      return { failed };
    } finally {
      setRunning(false);
    }
  }, [entries, job.code]);

  return { run, running, progress, total: entries.length };
}
