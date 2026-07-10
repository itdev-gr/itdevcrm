# Email Tab Collapsed Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deal Emails tab shows one collapsed row per conversation (newest activity first, latest-message snippet), expanding on click to messages listed newest-first; thread grouping gains a subject fallback.

**Architecture:** Frontend-only. The exported pure `groupThreads` in `useEmailThreads.ts` flips message order to newest-first and adds a fallback grouping key (normalized subject when `thread_id` is null, own id when subject blank). `EmailThreadList.tsx` gains an `expanded: Set<string>` state, a collapsed summary header (chevron + subject + count + latest direction badge + snippet + time), and renders the message list only when expanded.

**Tech Stack:** React + TS, TanStack Query (untouched), Vitest + @testing-library/react.

## Global Constraints

- Frontend only — no DB changes, no migrations.
- Conversation cards stay sorted newest `last_at` first; messages inside are **newest-first**; cards **collapsed by default**.
- `npm run build` (tsc + eslint --max-warnings=0) must exit 0. Never run the full vitest suite — only the paths named here.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `groupThreads` — newest-first messages + fallback key

**Files:**
- Modify: `src/features/email/hooks/useEmailThreads.ts`
- Test: `src/features/email/hooks/useEmailThreads.test.ts` (new)

**Interfaces:**
- Produces: `groupThreads(rows: EmailMessageRow[]): EmailThread[]` — unchanged signature; new behavior: `thread.messages[0]` is the NEWEST message; grouping key = `thread_id` → else `subj:<normalized subject>` → else row `id`.

- [ ] **Step 1: Write the failing tests** — create `src/features/email/hooks/useEmailThreads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupThreads, type EmailMessageRow } from './useEmailThreads';

function row(p: Partial<EmailMessageRow>): EmailMessageRow {
  return {
    id: p.id ?? 'm1',
    message_id: p.message_id ?? 'x',
    thread_id: p.thread_id ?? null,
    direction: p.direction ?? 'outbound',
    from_email: p.from_email ?? 'me@itdev.gr',
    from_name: p.from_name ?? null,
    to_email: p.to_email ?? 'c@x.gr',
    subject: p.subject ?? null,
    body_text: p.body_text ?? null,
    snippet: p.snippet ?? null,
    sent_at: p.sent_at ?? null,
    department: p.department ?? null,
    job_id: p.job_id ?? null,
  };
}

describe('groupThreads', () => {
  it('sorts messages inside a thread newest-first', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 't1', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', thread_id: 't1', sent_at: '2026-07-03T10:00:00Z' }),
      row({ id: 'c', thread_id: 't1', sent_at: '2026-07-02T10:00:00Z' }),
    ]);
    expect(th).toHaveLength(1);
    expect(th[0]!.messages.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts threads by latest activity, newest first', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 'old', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', thread_id: 'new', sent_at: '2026-07-09T10:00:00Z' }),
    ]);
    expect(th.map((x) => x.key)).toEqual(['new', 'old']);
  });

  it('groups Re:/Fwd: chains by normalized subject when thread_id is null', () => {
    const th = groupThreads([
      row({ id: 'a', subject: 'GBP access', sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', subject: 'Re: GBP access', sent_at: '2026-07-02T10:00:00Z' }),
      row({ id: 'c', subject: 'RE: Re: GBP access', sent_at: '2026-07-03T10:00:00Z' }),
      row({ id: 'd', subject: 'Fwd: GBP access', sent_at: '2026-07-04T10:00:00Z' }),
    ]);
    expect(th).toHaveLength(1);
    expect(th[0]!.messages).toHaveLength(4);
  });

  it('keeps blank-subject strays separate', () => {
    const th = groupThreads([
      row({ id: 'a', subject: null, sent_at: '2026-07-01T10:00:00Z' }),
      row({ id: 'b', subject: '  ', sent_at: '2026-07-02T10:00:00Z' }),
    ]);
    expect(th).toHaveLength(2);
  });

  it('does not cross-group thread_id rows with same-subject strays', () => {
    const th = groupThreads([
      row({ id: 'a', thread_id: 't1', subject: 'X' }),
      row({ id: 'b', subject: 'X' }),
    ]);
    expect(th).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/email/hooks/useEmailThreads.test.ts` — expect FAIL: newest-first case gets `['a','c','b']` (current oldest-first) and the Re:/Fwd: case gets 4 threads.

- [ ] **Step 3: Implement.** In `src/features/email/hooks/useEmailThreads.ts`, add above `groupThreads`:

```ts
/** Grouping key: real thread when known; otherwise fold Re:/Fwd: chains of the
 *  same subject together (queries are deal-scoped so this is safe); blank
 *  subjects stay solo. */
function threadKey(r: EmailMessageRow): string {
  if (r.thread_id) return r.thread_id;
  const norm = (r.subject ?? '')
    .replace(/^((re|fwd?):\s*)+/i, '')
    .trim()
    .toLowerCase();
  return norm ? `subj:${norm}` : r.id;
}
```

and inside `groupThreads`: replace `const key = r.thread_id ?? r.id;` with `const key = threadKey(r);`, and flip the message sort to newest-first:

```ts
    th.messages.sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''));
```

- [ ] **Step 4: Run** `npx vitest run src/features/email/hooks/useEmailThreads.test.ts` — PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/email/hooks/useEmailThreads.ts src/features/email/hooks/useEmailThreads.test.ts
git commit -m "feat(email): thread messages newest-first + subject-fallback grouping"
```

---

### Task 2: `EmailThreadList` — collapsed cards, expand on click

**Files:**
- Modify: `src/features/email/EmailThreadList.tsx`
- Test: `src/features/email/EmailThreadList.test.tsx` (rewrite cases)

**Interfaces:**
- Consumes: `EmailThread`/`EmailMessageRow` (Task 1 — `messages[0]` = newest). Component props unchanged: `{ dealId: string; clientEmail: string }`.

- [ ] **Step 1: Rewrite the component test** — replace the body of `src/features/email/EmailThreadList.test.tsx` describe block with:

```tsx
const thread = (): EmailThread => ({
  key: 't1',
  subject: 'Re: 000280-WEBDEV',
  last_at: '2026-07-09T10:00:00Z',
  messages: [
    {
      id: 'm2', message_id: 'y', thread_id: 't1', direction: 'inbound',
      from_email: 'a@upd8.gr', from_name: 'A', to_email: 'me@itdev.gr',
      subject: 'Re: 000280-WEBDEV', body_text: 'newest reply body', snippet: 'newest reply',
      sent_at: '2026-07-09T10:00:00Z', department: 'web_dev', job_id: 'j1',
    },
    {
      id: 'm1', message_id: 'x', thread_id: 't1', direction: 'outbound',
      from_email: 'me@itdev.gr', from_name: 'Me', to_email: 'a@upd8.gr',
      subject: '000280-WEBDEV', body_text: 'older sent body', snippet: 'older sent',
      sent_at: '2026-07-08T10:00:00Z', department: 'web_dev', job_id: 'j1',
    },
  ],
});

describe('EmailThreadList', () => {
  it('shows an empty state when there are no threads', () => {
    ref.data = [];
    ref.isLoading = false;
    render(<EmailThreadList dealId="d1" clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
  });

  it('renders conversations collapsed: subject + latest snippet, no bodies', () => {
    ref.data = [thread()];
    ref.isLoading = false;
    render(<EmailThreadList dealId="d1" clientEmail="a@upd8.gr" />);
    expect(screen.getByText('Re: 000280-WEBDEV')).toBeInTheDocument();
    expect(screen.getByText(/newest reply body/)).toBeInTheDocument(); // snippet line (first line of latest body)
    expect(screen.queryByText(/older sent body/)).not.toBeInTheDocument();
  });

  it('expands on header click showing all messages, collapses on second click', async () => {
    ref.data = [thread()];
    ref.isLoading = false;
    render(<EmailThreadList dealId="d1" clientEmail="a@upd8.gr" />);
    const header = screen.getByRole('button', { name: /Re: 000280-WEBDEV/ });
    await userEvent.click(header);
    expect(screen.getByText(/older sent body/)).toBeInTheDocument();
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(header);
    expect(screen.queryByText(/older sent body/)).not.toBeInTheDocument();
  });

  it('Reply button does not toggle expansion', async () => {
    ref.data = [thread()];
    ref.isLoading = false;
    render(<EmailThreadList dealId="d1" clientEmail="a@upd8.gr" />);
    await userEvent.click(screen.getByRole('button', { name: /reply/i }));
    expect(screen.queryByText(/older sent body/)).not.toBeInTheDocument();
  });
});
```

(Add imports at top: `import userEvent from '@testing-library/user-event';` and keep the existing `ref` mock; import `type EmailThread` already present.)

- [ ] **Step 2: Run** `npx vitest run src/features/email/EmailThreadList.test.tsx` — expect FAIL (bodies render expanded today; no aria-expanded header).

- [ ] **Step 3: Implement.** In `src/features/email/EmailThreadList.tsx`:

Imports: add `ChevronDown, ChevronRight` to the lucide import; keep the rest.

Inside `EmailThreadList`, add state + helpers after `replyTo`:

```tsx
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
```

Replace the `threads.map((thread) => (...))` card with:

```tsx
      {threads.map((thread) => {
        const isOpen = expanded.has(thread.key);
        const latest = thread.messages[0];
        const snippet = (latest?.body_text ?? latest?.snippet ?? '').split('\n')[0] ?? '';
        const time = latest?.sent_at ? formatCommentTime(latest.sent_at, locale) : null;
        return (
          <article
            key={thread.key}
            className="min-w-0 overflow-visible rounded-xl border border-border/50 bg-card shadow-sm"
          >
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(thread.key)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-foreground">
                      {thread.subject}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ({thread.messages.length})
                    </span>
                  </span>
                  {!isOpen && latest && (
                    <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <DirectionBadge inbound={latest.direction === 'inbound'} t={t} />
                      <span className="min-w-0 truncate">{snippet}</span>
                      {time && (
                        <time
                          className="shrink-0"
                          dateTime={latest.sent_at ?? undefined}
                          title={time.title}
                        >
                          {time.label}
                        </time>
                      )}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => openReply(thread)}
              >
                <Reply className="size-3.5" />
                {t('thread.reply', { defaultValue: 'Reply' })}
              </button>
            </div>

            {isOpen && (
              <div className="space-y-3 border-t border-border/40 px-4 pb-4 pt-3">
                {thread.messages.map((m) => (
                  <EmailMessage key={m.id} message={m} locale={locale} t={t} />
                ))}
              </div>
            )}
          </article>
        );
      })}
```

(The old `thread.count` "{n} messages" sub-line is replaced by the `({n})` count next to the subject.)

Extract the direction badge (used by both the collapsed row and `EmailMessage`) — add above `EmailMessage`:

```tsx
function DirectionBadge({
  inbound,
  t,
}: {
  inbound: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        inbound
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
      )}
    >
      {inbound ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
      {inbound
        ? t('thread.received', { defaultValue: 'Received' })
        : t('thread.sent', { defaultValue: 'Sent' })}
    </span>
  );
}
```

and in `EmailMessage` replace the inline badge `<span className={cn('inline-flex items-center gap-1 …')}>…</span>` block with `<DirectionBadge inbound={inbound} t={t} />`.

- [ ] **Step 4: Run** `npx vitest run src/features/email/EmailThreadList.test.tsx src/features/email/hooks/useEmailThreads.test.ts` — PASS (4 + 5).

- [ ] **Step 5: Build + email-feature sweep**

Run: `npm run build` — exit 0.
Run: `npx vitest run src/features/email` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/email/EmailThreadList.tsx src/features/email/EmailThreadList.test.tsx
git commit -m "feat(email): collapsed conversation cards, expand on click, newest-first"
```

---

## Changes / Revert

**Changes:** `useEmailThreads.ts` (message sort + `threadKey` fallback), `EmailThreadList.tsx` (collapse state, summary header, `DirectionBadge` extraction), tests.
**Revert:** `git revert` the two commits. No DB/migrations.

## Self-Review

- **Spec coverage:** newest-first cards (already) + newest-first messages ✅ (T1); collapsed default + click expand/collapse + aria-expanded ✅ (T2); collapsed row = chevron/subject/count/badge/snippet/time ✅ (T2); Reply on header, non-toggling (sibling button) ✅ (T2 test); subject fallback + blank-subject solo ✅ (T1).
- **Placeholders:** none.
- **Type consistency:** `threadKey(r: EmailMessageRow)` internal; `groupThreads` signature unchanged; `DirectionBadge({inbound, t})` matches both call sites; tests use the `ref` mock + `EmailThread` type already imported in the existing test file.
