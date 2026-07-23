import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Paperclip, X } from 'lucide-react';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  pending: File[];
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
};

export function CommentAttachButton({ pending, onPick, onRemove, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onPick(files);
    if (inputRef.current) inputRef.current.value = '';
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        title="Attach files"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <Paperclip className="size-4" />
      </button>
      <input ref={inputRef} type="file" multiple onChange={onChange} className="hidden" />
      {pending.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {pending.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px]">
              <span className="max-w-[10rem] truncate" title={f.name}>{f.name}</span>
              <span className="text-muted-foreground">{fmtSize(f.size)}</span>
              <button type="button" aria-label="Remove" onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
