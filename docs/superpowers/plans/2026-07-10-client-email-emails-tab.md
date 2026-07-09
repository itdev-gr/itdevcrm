# Client Email — Phase B: Deal "Emails" Tab

> **For agentic workers:** implement task-by-task with TDD; checkbox steps.

**Goal:** Add an **Emails** tab to the deal page showing the captured two-way client conversation (`email_messages`), grouped into threads, department-siloed by RLS, read-only with a **Reply** button that reuses the existing personal-send flow.

**Architecture:** A `useEmailThreads(dealId)` hook selects `email_messages` for the deal (RLS already silos to what the viewer may see) and groups rows by `thread_id`. `EmailThreadList` renders the threads; each thread's Reply opens the existing `SendEmailDialog` (identity `personal`) prefilled with the client's address and `Re:` subject. A new `emails` tab is wired into `DealDetailPage`.

**Tech Stack:** React + TS + Vite, @tanstack/react-query, supabase-js, shadcn Tabs, i18next.

## Global Constraints

- `email_messages` is NOT in the generated `src/types/supabase.ts`. Query it with the codebase's cast pattern (mirror `useDealEmails`): `supabase.from('email_messages' as never)…` and cast the result `as unknown as EmailMessageRow[]`. Do NOT add `any` (eslint `--max-warnings=0`).
- Visibility is enforced by RLS (`staff_user_id = auth.uid() OR current_user_can(department,'view')`). The UI does NO filtering — it shows whatever the query returns.
- Match existing deal-tab patterns: `TabsTrigger value=… className={detailTabTriggerClass}`, `TabsContent value=…`, label via the same `t('tabs.…')` namespace the other triggers use (check `DealDetailPage.tsx` — it's the page's `useTranslation()` default namespace; `tabs.comments` uses a separate `tLeads`).
- `npm run build` (tsc -b + eslint --max-warnings=0) must stay green. Add i18n keys to BOTH `en` and `el` locale files.
- TDD, commit per task.

## File Structure
- Create `src/features/email/hooks/useEmailThreads.ts` — query + thread grouping.
- Create `src/features/email/EmailThreadList.tsx` — render threads + messages + Reply.
- Create `src/features/email/EmailThreadList.test.tsx` — component test (mock the hook).
- Modify `src/features/deals/DealDetailPage.tsx` — add the `emails` tab trigger + content.
- Modify the deal-tab i18n namespace files — add `tabs.emails` (+ panel strings) in `en` and `el`.

---

### Task 1: `useEmailThreads` hook

**Files:** Create `src/features/email/hooks/useEmailThreads.ts`

**Interfaces — Produces:**
```ts
export type EmailMessageRow = {
  id: string; message_id: string; thread_id: string | null;
  direction: 'inbound' | 'outbound';
  from_email: string; from_name: string | null; to_email: string;
  subject: string | null; body_text: string | null; snippet: string | null;
  sent_at: string | null; department: string | null; job_id: string | null;
};
export type EmailThread = { key: string; subject: string; last_at: string | null; messages: EmailMessageRow[] };
export function useEmailThreads(dealId: string): UseQueryResult<EmailThread[]>;
```

- [ ] **Step 1: Write the hook**

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type EmailMessageRow = {
  id: string; message_id: string; thread_id: string | null;
  direction: 'inbound' | 'outbound';
  from_email: string; from_name: string | null; to_email: string;
  subject: string | null; body_text: string | null; snippet: string | null;
  sent_at: string | null; department: string | null; job_id: string | null;
};
export type EmailThread = { key: string; subject: string; last_at: string | null; messages: EmailMessageRow[] };

const COLS = 'id, message_id, thread_id, direction, from_email, from_name, to_email, subject, body_text, snippet, sent_at, department, job_id';

export function groupThreads(rows: EmailMessageRow[]): EmailThread[] {
  const map = new Map<string, EmailThread>();
  for (const r of rows) {
    const key = r.thread_id ?? r.id;
    let th = map.get(key);
    if (!th) { th = { key, subject: r.subject ?? '(no subject)', last_at: r.sent_at, messages: [] }; map.set(key, th); }
    th.messages.push(r);
    if ((r.sent_at ?? '') >= (th.last_at ?? '')) { th.last_at = r.sent_at; }
  }
  const threads = [...map.values()];
  for (const th of threads) th.messages.sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''));
  threads.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  return threads;
}

export function useEmailThreads(dealId: string): UseQueryResult<EmailThread[]> {
  return useQuery({
    queryKey: ['deal-email-threads', dealId] as const,
    enabled: !!dealId,
    queryFn: async (): Promise<EmailThread[]> => {
      const { data, error } = await supabase
        .from('email_messages' as never)
        .select(COLS)
        .eq('deal_id', dealId)
        .order('sent_at', { ascending: true });
      if (error) throw new Error(error.message);
      return groupThreads((data ?? []) as unknown as EmailMessageRow[]);
    },
  });
}
```

- [ ] **Step 2: Build check** — `npm run build` → exit 0 (confirms the `as never` cast typechecks). Fix the cast if not.

- [ ] **Step 3: Commit** — `git commit -m "feat(email): useEmailThreads hook (email_messages grouped by thread)"`

---

### Task 2: `EmailThreadList` component + test

**Files:** Create `src/features/email/EmailThreadList.tsx`, `src/features/email/EmailThreadList.test.tsx`

**Interfaces — Consumes:** `useEmailThreads`, `EmailThread` from Task 1; `SendEmailDialog` from `src/features/email/SendEmailDialog.tsx` (props `{ open, identity, to, subject, body, onClose }`).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EmailThread } from './hooks/useEmailThreads';

const ref: { data: EmailThread[]; isLoading: boolean } = { data: [], isLoading: false };
vi.mock('./hooks/useEmailThreads', () => ({ useEmailThreads: () => ref }));
vi.mock('./SendEmailDialog', () => ({ SendEmailDialog: () => null }));
import { EmailThreadList } from './EmailThreadList';

describe('EmailThreadList', () => {
  it('shows an empty state when there are no threads', () => {
    ref.data = []; ref.isLoading = false;
    render(<EmailThreadList dealId="d1" clientEmail="c@x.gr" />);
    expect(screen.getByText(/no client emails/i)).toBeInTheDocument();
  });
  it('renders a thread subject and a message', () => {
    ref.data = [{ key: 't1', subject: 'Re: 000280-WEBDEV', last_at: '2026-07-09T10:00:00Z', messages: [
      { id: 'm1', message_id: 'x', thread_id: 't1', direction: 'inbound', from_email: 'a@upd8.gr', from_name: 'A', to_email: 'me@itdev.gr', subject: 'Re: 000280-WEBDEV', body_text: 'hello there', snippet: 'hello', sent_at: '2026-07-09T10:00:00Z', department: 'web_dev', job_id: 'j1' },
    ] }];
    render(<EmailThreadList dealId="d1" clientEmail="a@upd8.gr" />);
    expect(screen.getByText('Re: 000280-WEBDEV')).toBeInTheDocument();
    expect(screen.getByText(/hello there/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/features/email/EmailThreadList.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement the component**

Render: loading → a subtle "Loading…"; empty → an empty state with a message/icon (text must include "No client emails"); else the threads. Each thread is a card: subject header + a small count; each message shows a direction chip (`inbound`/`outbound` → e.g. ↙ received / ↗ sent), from → to, a department badge (e.g. `web_dev`), the local time, and `body_text` (fallback `snippet`) in a `whitespace-pre-wrap` block. A **Reply** button on each thread sets state to open `SendEmailDialog` with `identity="personal"`, `to={clientEmail}`, `subject={'Re: ' + thread.subject.replace(/^Re:\s*/i,'')}`, `body=""`. Follow the visual patterns/classes used in `src/features/comments/CommentItem.tsx` and `comment-utils.tsx` (avatars/badges/time) for consistency. Props: `{ dealId: string; clientEmail: string }`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/features/email/EmailThreadList.test.tsx` → PASS (2).

- [ ] **Step 5: Commit** — `git commit -m "feat(email): EmailThreadList — threaded conversation view + Reply"`

---

### Task 3: Wire the Emails tab into the deal page + i18n

**Files:** Modify `src/features/deals/DealDetailPage.tsx`; add i18n keys.

- [ ] **Step 1: Add the tab trigger** — after the `attachments` trigger, add:
```tsx
<TabsTrigger value="emails" className={detailTabTriggerClass}>
  {t('tabs.emails')}
</TabsTrigger>
```

- [ ] **Step 2: Add the tab content** — near the other `TabsContent` blocks:
```tsx
<TabsContent value="emails" className="mt-3 outline-none lg:min-h-0 lg:overflow-y-auto">
  <EmailThreadList dealId={deal.id} clientEmail={deal.client_email ?? ''} />
</TabsContent>
```
Import `EmailThreadList` from `@/features/email/EmailThreadList`. If `deal` has no `client_email` field in scope, derive the client's email from the loaded client (whatever `DealEmailsBox` uses via `clientId`) or pass `''` and let Reply's dialog field be edited manually — do NOT block on it.

- [ ] **Step 3: Add i18n** — add `tabs.emails` = "Emails" / "Email" (el) to the SAME namespace file the other `tabs.*` keys live in (find where `tabs.overview` is defined), plus any panel strings you used (empty state, reply, sent/received), in both `en` and `el`.

- [ ] **Step 4: Build + tests** — `npm run build` → exit 0; `npx vitest run src/features/email/` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(email): Emails tab on the deal page (threaded, rights-siloed)"`

---

## Follow-ups (out of scope)
- Same tab on **job** (filter `job_id`) and **client** pages.
- Realtime refresh on new capture; the cron (Phase A2).

## Changes / Revert
- Adds 2 components + 1 hook + 1 test + a tab + i18n keys. Revert: remove the tab trigger/content + imports, delete the new files, remove the i18n keys.
