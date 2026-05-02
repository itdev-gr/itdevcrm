import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAttachments } from './hooks/useAttachments';
import { useUploadAttachment } from './hooks/useUploadAttachment';
import { useDeleteAttachment } from './hooks/useDeleteAttachment';

type Props = {
  parentType: 'client' | 'deal' | 'job';
  parentId: string;
};

export function AttachmentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: list = [] } = useAttachments(parentType, parentId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'contract' | 'invoice' | 'other'>('other');

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await upload.mutateAsync({ parent_type: parentType, parent_id: parentId, file, kind });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function getDownloadUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(path, 60 * 5);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'contract' | 'invoice' | 'other')}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="other">{t('attachments.kinds.other')}</option>
          <option value="contract">{t('attachments.kinds.contract')}</option>
          <option value="invoice">{t('attachments.kinds.invoice')}</option>
        </select>
        <input ref={inputRef} type="file" onChange={onFileChange} className="text-sm" />
        <span className="text-xs text-muted-foreground">{t('attachments.max_size')}</span>
        {upload.isPending && <span className="text-xs">{t('attachments.uploading')}</span>}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <button
                  className="text-blue-600 hover:underline"
                  onClick={async () => {
                    const url = await getDownloadUrl(a.storage_path);
                    if (url) window.open(url, '_blank');
                  }}
                >
                  {a.file_name}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({(a.file_size ?? 0) > 0 ? `${Math.round((a.file_size ?? 0) / 1024)} KB` : ''})
                  {' · '}
                  {t(`attachments.kinds.${a.kind ?? 'other'}`)}
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  void del.mutateAsync({
                    id: a.id,
                    storage_path: a.storage_path,
                    parent_type: parentType,
                    parent_id: parentId,
                  })
                }
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
