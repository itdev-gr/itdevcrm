import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const AVATAR_PALETTES = [
  'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getInitials(name?: string | null, email?: string | null): string {
  const label = name?.trim() || email?.trim() || '?';
  return label
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export function CommentAvatar({
  name,
  email,
  size = 'md',
  className,
}: {
  name?: string | null;
  email: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const palette = AVATAR_PALETTES[hashString(email) % AVATAR_PALETTES.length];
  const sizeClass = size === 'sm' ? 'size-8 text-[11px]' : 'size-10 text-sm';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        sizeClass,
        palette,
        className,
      )}
      aria-hidden
    >
      {getInitials(name, email)}
    </span>
  );
}

export function formatCommentTime(iso: string, locale: string): { label: string; title: string } {
  const date = new Date(iso);
  const title = date.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) {
    return { label: locale.startsWith('el') ? 'τώρα' : 'just now', title };
  }
  if (diffMin < 60) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return { label: rtf.format(-diffMin, 'minute'), title };
  }
  if (diffHours < 24) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return { label: rtf.format(-diffHours, 'hour'), title };
  }
  if (diffDays < 7) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return { label: rtf.format(-diffDays, 'day'), title };
  }

  return {
    label: date.toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    }),
    title,
  };
}

const MENTION_BODY_RE = /(@[\p{L}\p{N}._-]+)/gu;

function renderLineWithMentions(line: string, lineIndex: number) {
  const parts = line.split(MENTION_BODY_RE);
  return parts.map((part, index) =>
    part.startsWith('@') ? (
      <span
        key={`${lineIndex}-mention-${index}`}
        className="mx-0.5 inline align-middle rounded-sm bg-[#1a9696]/8 px-0.5 text-[10px] font-medium leading-[1.15] text-[#147272] dark:text-[#7ad4d4]"
      >
        {part.replace(/_/g, ' ')}
      </span>
    ) : (
      <span key={`${lineIndex}-text-${index}`}>{part}</span>
    ),
  );
}

export function CommentBody({ body, className }: { body: string; className?: string }) {
  const lines = body.split('\n');

  return (
    <div className={cn('space-y-1.5', className)}>
      {lines.map((line, lineIndex) =>
        line.length === 0 ? (
          <div key={`gap-${lineIndex}`} className="h-1" aria-hidden />
        ) : (
          <p
            key={`line-${lineIndex}`}
            className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground"
          >
            {renderLineWithMentions(line, lineIndex)}
          </p>
        ),
      )}
    </div>
  );
}

export function CommentEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="max-w-[220px] text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
