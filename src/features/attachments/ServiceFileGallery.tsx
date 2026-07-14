import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { AttachmentRow } from './hooks/useAttachments';

export function isImageAttachment(f: AttachmentRow): boolean {
  if (f.mime_type) return f.mime_type.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.file_name);
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

// Images render as thumbnails that expand in a lightbox on click;
// any non-image file keeps the classic name-link that opens in a new tab.
export function ServiceFileGallery({ files }: { files: AttachmentRow[] }) {
  const images = files.filter(isImageAttachment);
  const others = files.filter((f) => !isImageAttachment(f));
  const { data: urls = {} } = useSignedUrls(images.map((f) => f.storage_path));
  const [expanded, setExpanded] = useState<AttachmentRow | null>(null);

  async function download(path: string) {
    const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => {
            const url = urls[f.storage_path];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => url && setExpanded(f)}
                title={f.file_name}
                className="group relative size-24 overflow-hidden rounded-md border border-border/60 bg-muted/30"
              >
                {url ? (
                  <img
                    src={url}
                    alt={f.file_name}
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-150 group-hover:scale-105"
                  />
                ) : (
                  <span className="absolute inset-0 animate-pulse bg-muted" />
                )}
              </button>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <ul className="mt-2 space-y-1">
          {others.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => download(f.storage_path)}
                className="text-sm font-medium text-primary hover:underline"
              >
                {f.file_name}
              </button>
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
          {expanded && (
            <img
              src={urls[expanded.storage_path]}
              alt={expanded.file_name}
              className="max-h-[85vh] max-w-[90vw] rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
