import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { AttachmentRow } from './hooks/useAttachments';

export function isImageAttachment(f: AttachmentRow): boolean {
  if (f.mime_type) return f.mime_type.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.file_name);
}

export function isPdfAttachment(f: AttachmentRow): boolean {
  if (f.mime_type === 'application/pdf') return true;
  return /\.pdf$/i.test(f.file_name);
}

function useSignedUrls(paths: string[]) {
  return useQuery({
    queryKey: ['attachment-signed-urls', paths.join('|')],
    enabled: paths.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage
        .from('attachments')
        .createSignedUrls(paths, 3600);
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
      }
      return map;
    },
  });
}

type Props = {
  files: AttachmentRow[];
  /** Small caption rendered under each preview tile. */
  tileCaption?: (f: AttachmentRow) => ReactNode;
  /** Extra inline content after the name link of non-preview files. */
  rowMeta?: (f: AttachmentRow) => ReactNode;
  /** When provided, tiles get an × overlay and rows a delete button. */
  onDelete?: (f: AttachmentRow) => void;
};

// Images and PDFs render as preview tiles that expand in a lightbox on click;
// any other file keeps the classic name-link that opens in a new tab.
export function AttachmentGallery({ files, tileCaption, rowMeta, onDelete }: Props) {
  const previews = files.filter((f) => isImageAttachment(f) || isPdfAttachment(f));
  const others = files.filter((f) => !isImageAttachment(f) && !isPdfAttachment(f));
  const { data: urls = {} } = useSignedUrls(previews.map((f) => f.storage_path));
  const [expanded, setExpanded] = useState<AttachmentRow | null>(null);

  async function download(path: string) {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  return (
    <>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((f) => {
            const url = urls[f.storage_path];
            return (
              <div key={f.id} className="flex w-24 flex-col gap-0.5">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => url && setExpanded(f)}
                    title={f.file_name}
                    className="group relative block size-24 overflow-hidden rounded-md border border-border/60 bg-muted/30"
                  >
                    {!url ? (
                      <span className="absolute inset-0 animate-pulse bg-muted" />
                    ) : isPdfAttachment(f) ? (
                      <>
                        <iframe
                          src={`${url}#toolbar=0&navpanes=0&scrollbar=0`}
                          title={f.file_name}
                          loading="lazy"
                          tabIndex={-1}
                          className="pointer-events-none size-full bg-white"
                        />
                        <span className="absolute right-1 bottom-1 rounded bg-red-600/90 px-1 text-[9px] font-bold text-white">
                          PDF
                        </span>
                      </>
                    ) : (
                      <img
                        src={url}
                        alt={f.file_name}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-150 group-hover:scale-105"
                      />
                    )}
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      aria-label="Delete"
                      onClick={() => onDelete(f)}
                      className="absolute -top-1.5 -right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-xs font-bold text-white shadow"
                    >
                      ×
                    </button>
                  )}
                </div>
                {tileCaption && (
                  <div className="truncate text-[10px] text-muted-foreground" title={f.file_name}>
                    {tileCaption(f)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <ul className="mt-2 space-y-1">
          {others.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <button
                type="button"
                onClick={() => download(f.storage_path)}
                className="min-w-0 truncate text-sm font-medium text-primary hover:underline"
              >
                {f.file_name}
              </button>
              {rowMeta?.(f)}
              {onDelete && (
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => onDelete(f)}
                  className="flex size-5 items-center justify-center rounded-full bg-destructive text-xs font-bold text-white shadow"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={expanded !== null}
        onOpenChange={(open) => {
          if (!open) setExpanded(null);
        }}
      >
        <DialogContent className="w-fit p-2 sm:max-w-[92vw]">
          <DialogTitle className="sr-only">{expanded?.file_name ?? ''}</DialogTitle>
          {expanded &&
            (isPdfAttachment(expanded) ? (
              <iframe
                src={urls[expanded.storage_path]}
                title={expanded.file_name}
                className="h-[85vh] w-[90vw] max-w-4xl rounded-md bg-white"
              />
            ) : (
              <img
                src={urls[expanded.storage_path]}
                alt={expanded.file_name}
                className="max-h-[85vh] max-w-[90vw] rounded-md object-contain"
              />
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
