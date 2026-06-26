# Local SEO "Request GBP access" Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button next to the owner on Local SEO job cards that, on click, confirms then sends the existing `localseo_gbp_access` email (request Google Business Profile access) to the client, with re-send allowed and a "✓ sent" indicator.

**Architecture:** Frontend-only except one read-only RPC. A pure `gbpButtonState` decides the button's state; a shared cached `useGbpAccessSentMap()` (security-definer RPC) tells which clients already received the email; `useRequestGbpAccess()` invokes the `send-email` edge function (like the Contracts "Send" button) with no dedupeKey so re-sends work. The button bypasses the `dept_technical` automation toggle by design (explicit staff action).

**Tech Stack:** React + TypeScript (strict: `noUncheckedIndexedAccess`, eslint `--max-warnings=0`), @tanstack/react-query, supabase-js (`functions.invoke`, `rpc`), shadcn Dialog, vitest. Verify with `npm run build`. Prod Supabase project id `xujlrclyzxrvxszepquy`; DDL via Supabase MCP `apply_migration`.

**Spec:** `docs/superpowers/specs/2026-06-26-local-seo-gbp-access-button-design.md`

---

## File Structure

**Created:**
- `supabase/migrations/20260626100000_gbp_access_sent_map.sql` — read-only RPC.
- `src/features/jobs/gbpAccessButton.ts` (+ `gbpAccessButton.test.ts`) — pure state machine.
- `src/features/jobs/hooks/useGbpAccessSentMap.ts` — cached email→last_sent map.
- `src/features/jobs/hooks/useRequestGbpAccess.ts` — send mutation.
- `src/features/jobs/RequestGbpAccessButton.tsx` — button + confirm dialog.

**Modified:**
- `src/features/jobs/JobsKanbanCard.tsx` — owner row → owner + button.
- `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json` — `gbp_access.*` strings.

---

## Task 1: Migration — `gbp_access_sent_map()` RPC

**Files:**
- Create: `supabase/migrations/20260626100000_gbp_access_sent_map.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260626100000_gbp_access_sent_map.sql
-- Read-only helper so non-admin staff (Local SEO team) can see which clients have
-- already received the localseo_gbp_access email. email_log itself is admin-read only.
create or replace function public.gbp_access_sent_map()
returns table (to_email text, last_sent timestamptz)
language sql stable security definer set search_path = public as $$
  select lower(el.to_email), max(el.created_at)
  from public.email_log el
  where el.template_key = 'localseo_gbp_access' and el.status = 'sent'
  group by lower(el.to_email);
$$;
revoke all on function public.gbp_access_sent_map() from anon, public;
grant execute on function public.gbp_access_sent_map() to authenticated;

-- ROLLBACK: drop function if exists public.gbp_access_sent_map();
```

- [ ] **Step 2: Apply to prod via Supabase MCP**

Use `apply_migration`: `project_id="xujlrclyzxrvxszepquy"`, `name="gbp_access_sent_map"`, `query=`<the SQL above>. Expected: `{"success":true}`.

- [ ] **Step 3: Verify with execute_sql**

```sql
select
  (select count(*) from pg_proc where proname='gbp_access_sent_map') as fn_exists,
  (select prosecdef from pg_proc where proname='gbp_access_sent_map') as is_security_definer,
  (select has_function_privilege('authenticated','public.gbp_access_sent_map()','execute')) as authed_can_exec;
-- also confirm it runs:
select count(*) as sent_rows from public.gbp_access_sent_map();
```
Expected: `fn_exists=1, is_security_definer=true, authed_can_exec=true`; the second query returns a row count (≥0) without error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626100000_gbp_access_sent_map.sql
git commit -m "feat(local-seo): gbp_access_sent_map RPC (staff-readable last-sent map)"
```

---

## Task 2: Pure `gbpButtonState` (TDD)

**Files:**
- Create: `src/features/jobs/gbpAccessButton.ts`
- Test: `src/features/jobs/gbpAccessButton.test.ts`

- [ ] **Step 1: Write the failing test** `src/features/jobs/gbpAccessButton.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { gbpButtonState } from './gbpAccessButton';
import type { JobRow } from './hooks/useJobs';

function job(partial: Partial<JobRow> & { client?: JobRow['client'] }): JobRow {
  return partial as unknown as JobRow;
}

const local = (email: string | null) =>
  job({ service_type: 'local_seo', client: { id: 'c', name: 'X', email } as JobRow['client'] });

describe('gbpButtonState', () => {
  it('hidden on non-local_seo jobs', () => {
    expect(gbpButtonState(job({ service_type: 'web_dev' }), null)).toBe('hidden');
  });
  it('no-email when local_seo but client has no email', () => {
    expect(gbpButtonState(local(null), null)).toBe('no-email');
    expect(gbpButtonState(local('   '), null)).toBe('no-email');
  });
  it('idle when local_seo + email + never sent', () => {
    expect(gbpButtonState(local('a@b.gr'), null)).toBe('idle');
  });
  it('sent when local_seo + email + a last-sent timestamp', () => {
    expect(gbpButtonState(local('a@b.gr'), '2026-06-26T10:00:00Z')).toBe('sent');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './gbpAccessButton'`)

Run: `npx vitest run src/features/jobs/gbpAccessButton.test.ts`

- [ ] **Step 3: Implement** `src/features/jobs/gbpAccessButton.ts`

```ts
import type { JobRow } from './hooks/useJobs';

export type GbpButtonState = 'hidden' | 'no-email' | 'idle' | 'sent';

/** What the GBP-access button should show for a job + its last-sent timestamp. */
export function gbpButtonState(job: JobRow, lastSent: string | null): GbpButtonState {
  if (job.service_type !== 'local_seo') return 'hidden';
  const email = job.client?.email?.trim();
  if (!email) return 'no-email';
  return lastSent ? 'sent' : 'idle';
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/features/jobs/gbpAccessButton.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/gbpAccessButton.ts src/features/jobs/gbpAccessButton.test.ts
git commit -m "feat(local-seo): pure gbpButtonState helper + tests"
```

---

## Task 3: `useGbpAccessSentMap` hook

**Files:**
- Create: `src/features/jobs/hooks/useGbpAccessSentMap.ts`

- [ ] **Step 1: Implement** (one shared cached query; `enabled` only on the Local SEO board)

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type SentRow = { to_email: string; last_sent: string };

/** Map of lowercased client email -> ISO timestamp of the last localseo_gbp_access
 *  email sent to them. One cached fetch shared by every Local SEO card. */
export function useGbpAccessSentMap(enabled: boolean): Record<string, string> {
  const { data } = useQuery({
    queryKey: ['gbp-access-sent-map'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      // RPC not yet in generated types; cast the name + the rows.
      const { data, error } = await supabase.rpc('gbp_access_sent_map' as never);
      if (error) throw new Error(error.message);
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as unknown as SentRow[]) {
        map[row.to_email] = row.last_sent;
      }
      return map;
    },
  });
  return data ?? {};
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (If `supabase.rpc('gbp_access_sent_map' as never)` errors, run `npm run types:gen` later; the `as never` cast keeps the build green now.)

- [ ] **Step 3: Commit**

```bash
git add src/features/jobs/hooks/useGbpAccessSentMap.ts
git commit -m "feat(local-seo): cached gbp-access sent-map hook"
```

---

## Task 4: `useRequestGbpAccess` mutation

**Files:**
- Create: `src/features/jobs/hooks/useRequestGbpAccess.ts`

- [ ] **Step 1: Implement** (mirrors `useSendContract`'s robust error extraction; no dedupeKey → resend allowed)

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = { to: string; code: string };

export function useRequestGbpAccess() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Input>({
    mutationFn: captureMutation('local_seo', 'request_gbp_access', async (input: Input) => {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: 'accounting',
          to: input.to,
          templateKey: 'localseo_gbp_access',
          data: { code: input.code },
        },
      });
      if (error) {
        let msg = error.message;
        try {
          const ctx = error.context as { json?: () => Promise<{ error?: string }> } | undefined;
          if (ctx?.json) {
            const j = await ctx.json();
            if (j?.error) msg = j.error;
          }
        } catch {
          // ignore — fall back to error.message
        }
        throw new Error(msg);
      }
      const status = (data as { status?: string; error?: string } | null)?.status;
      if (status !== 'sent' && status !== 'skipped') {
        throw new Error((data as { error?: string } | null)?.error ?? 'send failed');
      }
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['gbp-access-sent-map'] }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/jobs/hooks/useRequestGbpAccess.ts
git commit -m "feat(local-seo): useRequestGbpAccess sends the GBP-access email"
```

---

## Task 5: `RequestGbpAccessButton` component + i18n

**Files:**
- Create: `src/features/jobs/RequestGbpAccessButton.tsx`
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json`

- [ ] **Step 1: Add i18n strings** — add a top-level `"gbp_access"` object to BOTH files.

`en/common.json`:
```json
  "gbp_access": {
    "request_title": "Request Google Business Profile access",
    "sent_title": "Access requested {{date}} · click to resend",
    "no_email": "No client email on file",
    "confirm_title": "Request GBP access",
    "confirm_body": "Send the Google Business Profile access request email to {{email}}?",
    "send": "Send",
    "cancel": "Cancel",
    "error": "Could not send the email."
  },
```
`el/common.json`:
```json
  "gbp_access": {
    "request_title": "Αίτημα πρόσβασης στο Google Business Profile",
    "sent_title": "Ζητήθηκε πρόσβαση {{date}} · κλικ για επαναποστολή",
    "no_email": "Δεν υπάρχει email πελάτη",
    "confirm_title": "Αίτημα πρόσβασης GBP",
    "confirm_body": "Αποστολή του email αιτήματος πρόσβασης στο Google Business Profile στο {{email}};",
    "send": "Αποστολή",
    "cancel": "Άκυρο",
    "error": "Δεν ήταν δυνατή η αποστολή του email."
  },
```
(Place it after an existing top-level key, e.g. right after `"tasks_page": { … },`. Keep JSON valid — comma after the previous object.)

- [ ] **Step 2: Implement** `src/features/jobs/RequestGbpAccessButton.tsx`

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { gbpButtonState } from './gbpAccessButton';
import { useGbpAccessSentMap } from './hooks/useGbpAccessSentMap';
import { useRequestGbpAccess } from './hooks/useRequestGbpAccess';
import type { JobRow } from './hooks/useJobs';

export function RequestGbpAccessButton({ job }: { job: JobRow }) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const isLocal = job.service_type === 'local_seo';
  const sentMap = useGbpAccessSentMap(isLocal);
  const email = job.client?.email?.trim() ?? '';
  const lastSent = email ? (sentMap[email.toLowerCase()] ?? null) : null;
  const state = gbpButtonState(job, lastSent);
  const send = useRequestGbpAccess();
  const [open, setOpen] = useState(false);

  if (state === 'hidden') return null;

  if (state === 'no-email') {
    return (
      <button
        type="button"
        disabled
        title={t('gbp_access.no_email')}
        className="shrink-0 rounded p-1 text-muted-foreground/40"
      >
        <Mail className="size-3.5" />
      </button>
    );
  }

  const sentDate = lastSent
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(lastSent))
    : null;

  function onSend() {
    send.mutate(
      { to: email, code: job.code ?? job.deal?.code ?? '' },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => window.alert(e instanceof Error ? e.message : t('gbp_access.error')),
      },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t('gbp_access.request_title')}
        title={state === 'sent' ? t('gbp_access.sent_title', { date: sentDate }) : t('gbp_access.request_title')}
        className={cn(
          'shrink-0 rounded p-1 transition-colors hover:bg-muted',
          state === 'sent'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {state === 'sent' ? <Check className="size-3.5" /> : <Mail className="size-3.5" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('gbp_access.confirm_title')}</DialogTitle>
            <DialogDescription>{t('gbp_access.confirm_body', { email })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('gbp_access.cancel')}
              </Button>
            </DialogClose>
            <Button type="button" onClick={onSend} disabled={send.isPending}>
              {t('gbp_access.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Typecheck + JSON valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/common.json','utf8'));JSON.parse(require('fs').readFileSync('src/i18n/locales/el/common.json','utf8'));console.log('JSON OK')" && npm run typecheck`
Expected: `JSON OK` + typecheck PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/RequestGbpAccessButton.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(local-seo): RequestGbpAccessButton (confirm dialog + states) + i18n"
```

---

## Task 6: Wire the button into the card (next to the owner)

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx`

- [ ] **Step 1: Import the button**

Add near the other imports in `src/features/jobs/JobsKanbanCard.tsx`:

```ts
import { RequestGbpAccessButton } from './RequestGbpAccessButton';
```

- [ ] **Step 2: Put the button next to the owner**

Replace the owner block (the `<div>` with the `<User>` icon + owner name):

```tsx
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <User className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {owner ? owner.full_name || owner.email : 'Unassigned'}
            </span>
          </div>
```

with (owner on the left, button on the right via `justify-between`):

```tsx
          <div className="flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1.5">
              <User className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">
                {owner ? owner.full_name || owner.email : 'Unassigned'}
              </span>
            </div>
            <RequestGbpAccessButton job={job} />
          </div>
```

(`RequestGbpAccessButton` returns `null` on non-local_seo boards, so the shared card stays unchanged everywhere else.)

- [ ] **Step 3: Build (lint gate)**

Run: `npm run build`
Expected: tsc PASS, eslint 0 warnings, vite build OK.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobsKanbanCard.tsx
git commit -m "feat(local-seo): show Request-GBP-access button next to the owner on cards"
```

---

## Task 7: Full verification, live smoke, push

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm run build && npm run test:run`
Expected: build green; all vitest pass (including `gbpAccessButton.test.ts`).

- [ ] **Step 2: Push to main**

```bash
git push origin HEAD:main
```
(If a parallel session advanced origin: `git fetch origin && git pull --rebase origin main`, then push. Commit only the files in this plan; leave other sessions' files untouched.)

- [ ] **Step 3: Live Playwright smoke (no real client emailed)**

After Vercel redeploys (confirm the served `index-*.js` hash changed first), OR against a local `npm run dev` (hits prod DB):
1. Pick a Local SEO job and **temporarily** set its client email to a safe test address via `execute_sql` (capture the original first):
   `update clients set email='info@itdev.gr' where id='<the job's client_id>' returning email;` (record the prior value).
2. Open `/tech/local-seo`, find that card, confirm the ✉ button appears next to the owner. Confirm the button does NOT appear on `/tech/web-dev`.
3. Click it → the confirm dialog shows "… to info@itdev.gr?" → click Send.
4. Verify via `execute_sql`: a new `email_log` row exists (`template_key='localseo_gbp_access', status='sent', to_email='info@itdev.gr'`), and after a refresh the card button shows the ✓ "sent" state.
5. **Restore** the client's original email. (Optionally delete the smoke `email_log` row.)
6. `browser_console_messages` level=error → expect 0.

---

## Self-Review (run before execution)

- **Spec coverage:** reuse `localseo_gbp_access` (Task 4) ✅; confirm-then-send + resend, no dedupeKey (Task 4/5) ✅; bypasses dept_technical (direct invoke, Task 4) ✅; local_seo only (Task 2 `gbpButtonState` + self-hiding button) ✅; recipient client.email, disabled when missing (Task 2/5) ✅; last-sent via security-definer RPC (Task 1/3) ✅; next to owner (Task 6) ✅; pure unit tests + build + live smoke (Task 2/7) ✅; i18n en+el (Task 5) ✅.
- **Type consistency:** `gbpButtonState(job: JobRow, lastSent: string | null): GbpButtonState` used identically in Task 2 (impl/test) and Task 5. `useGbpAccessSentMap(enabled: boolean): Record<string,string>` and `useRequestGbpAccess()` (`{ to, code }`) match across Task 3/4/5. Query key `['gbp-access-sent-map']` identical in Task 3 (query) and Task 4 (invalidate).
- **No placeholders:** every code step has complete code.
