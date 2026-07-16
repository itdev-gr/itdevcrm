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
  const clock = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) {
    const relative = locale.startsWith('el') ? 'τώρα' : 'just now';
    return { label: `${relative} · ${clock}`, title };
  }
  if (diffMin < 60) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return { label: `${rtf.format(-diffMin, 'minute')} · ${clock}`, title };
  }
  if (diffHours < 24) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return { label: `${rtf.format(-diffHours, 'hour')} · ${clock}`, title };
  }
  if (diffDays < 7) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return { label: `${rtf.format(-diffDays, 'day')} · ${clock}`, title };
  }

  const dateLabel = date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });

  return {
    label: `${dateLabel} · ${clock}`,
    title,
  };
}

// Characters a mention token is built from: Unicode letters (incl. Greek) and
// digits, plus `.`/`_`/`-` (spaces become `_`; dots/hyphens allow initials and
// hyphenated names). Exported so CommentForm.resolveMentions stays in lockstep
// with what CommentBody highlights — "shown as a mention" must imply "notified".
export const MENTION_TOKEN_CHARS = '\\p{L}\\p{N}._-';

const MENTION_BODY_RE = new RegExp(`(@[${MENTION_TOKEN_CHARS}]+)`, 'gu');

function escapeMentionRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Per-token matcher used when RESOLVING a specific known token (e.g. `@Full_Name`)
// against comment text. A token counts as mentioned when it sits on a word
// boundary where "word" = letters/digits only (`\p{L}\p{N}`). This means:
//   • trailing `.`/`-`/`_`/`'`/`/`/`(` etc. still resolve — so `@Full_Name.`,
//     `@Full_Name's` and both halves of `@A/@B` notify, matching the highlight;
//   • a following letter/digit is hard continuation — `@Nikos` never resolves
//     inside `@Nikosxyz` (a different, longer token), avoiding over-match.
// Greek names work because `\p{L}` (with the `u` flag) covers Greek letters.
export function mentionTokenMatcher(token: string, caseInsensitive = false): RegExp {
  const flags = caseInsensitive ? 'iu' : 'u';
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeMentionRegex(token)}(?=$|[^\\p{L}\\p{N}])`,
    flags,
  );
}

// Resolve the set of user ids mentioned in `text`. Pure + shared so CommentForm
// and tests use the exact same boundary rules as the highlighter.
export function resolveMentionedUserIds(
  text: string,
  users: readonly { user_id: string; full_name?: string | null }[],
  sessionTokens?: ReadonlyMap<string, string>,
): string[] {
  const ids = new Set<string>();
  // Tokens inserted during this editing session (exact, case-sensitive).
  if (sessionTokens) {
    for (const [token, id] of sessionTokens) {
      if (mentionTokenMatcher(token).test(text)) ids.add(id);
    }
  }
  // `@Full_Name` typed manually (case-insensitive).
  for (const u of users) {
    if (!u.full_name) continue;
    const token = '@' + u.full_name.trim().replace(/\s+/g, '_');
    if (mentionTokenMatcher(token, true).test(text)) ids.add(u.user_id);
  }
  return [...ids];
}

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
