import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAttachments } from './hooks/useAttachments';
import { useUploadAttachment } from './hooks/useUploadAttachment';
import { useDeleteAttachment } from './hooks/useDeleteAttachment';
import type { ServiceArea } from './serviceAreas';

export function ServiceAttachmentsSection({
  jobId,
  area,
  canUpload,
  lang,
}: {
  jobId: string;
  area: ServiceArea;
  canUpload: boolean;
  lang: 'en' | 'el';
}) {
  const { t } = useTranslation('jobs');
  const { data: all = [] } = useAttachments('job', jobId);
  const files = all.filter((a) => a.kind === area.kind);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  async function onUpload() {
    if (!file) return;
    try {
      await upload.mutateAsync({ parent_type: 'job', parent_id: jobId, file, kind: area.kind });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function download(path: string) {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  const label = lang === 'el' ? area.labelEl : area.labelEn;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Paperclip className="size-3.5" /> {label} · {t('attachments.title')}
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                onClick={() => download(f.storage_path)}
                className="min-w-0 truncate text-left font-medium text-primary hover:underline"
              >
                {f.file_name}
              </button>
              {canUpload && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    del.mutate({
                      id: f.id,
                      storage_path: f.storage_path,
                      parent_type: 'job',
                      parent_id: jobId,
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <Button size="sm" onClick={onUpload} disabled={!file || upload.isPending}>
            <Upload className="size-3.5" /> {t('attachments.upload')}
          </Button>
        </div>
      )}
    </div>
  );
}
