# Local SEO "Request GBP access" button (on the job card, next to the owner)

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Problem

Local SEO staff need to ask each client to grant us manager access to their Google
Business Profile (GBP). The system already has the exact email — template
`localseo_gbp_access` (Greek, step-by-step instructions to invite
`itdevgr24@gmail.com` as a manager, sent from `support@itdev.gr`) — but it only goes
out automatically when a `local_seo` job is created, **and that automation is
currently OFF** (gated by the `dept_technical` toggle). So in practice nobody is
getting the email. Staff want a button on the Local SEO job card, **next to the
owner**, to send that email on demand.

## Scope & decisions (confirmed with product owner)

- **Reuse the existing `localseo_gbp_access` template** (no new email).
- **Confirm-then-send, re-send allowed.** Clicking opens a confirm dialog showing the
  recipient; on confirm it sends. The card shows a "✓ sent" state with the last-sent
  date; clicking again re-sends (staff often need to nudge). **No hard dedup.**
- **Manual action bypasses the `dept_technical` automation toggle.** The button
  invokes the `send-email` edge function directly (like the Contracts "Send" button),
  which does not check the automation toggle — that gate only applies to the auto
  trigger. This is intended: an explicit staff click should send regardless.
- **Local SEO only.** Shown on `service_type = 'local_seo'` cards (Web SEO uses a
  different GSC template; out of scope).
- **Recipient = `job.client.email`.** If the client has no email, the button is
  disabled with a tooltip.

## How email sending works here (grounding)

- On-demand send: `supabase.functions.invoke('send-email', { body: { identity, to,
  templateKey, data, dedupeKey? } })` (see `src/features/email/useSendEmail.ts` and
  the Contracts send in `ContractDetailPage.tsx`).
- The edge function (`supabase/functions/send-email/index.ts`) looks up the
  `email_templates` row by `key`, and for `localseo_gbp_access` overrides
  from/reply-to/cc to `support@itdev.gr`. It logs every send to `email_log`
  (`status='sent'|'failed'`, `to_email`, `template_key`, `dedupe_key`, `created_at`).
  Passing **no `dedupeKey`** means it always sends (no skip) — exactly what "re-send
  allowed" needs.
- Template data var: `code` (used in the subject prefix `{{code}} - …`).

## Data model

One migration: a read-only RPC so non-admin staff can see "already requested" state.
`email_log` is admin-read only (single policy `email_log_admin_read`), so a
security-definer function is required.

```sql
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
```

Exposes only an email→timestamp map for this one template (minimal). Returns a small
set (only clients who already received the GBP email).

## Components / data flow

### Pure: `src/features/jobs/gbpAccessButton.ts` (+ test)

```ts
import type { JobRow } from './hooks/useJobs';

export type GbpButtonState = 'hidden' | 'no-email' | 'idle' | 'sent';

/** What the button should show for a given job + its last-sent timestamp (or null). */
export function gbpButtonState(job: JobRow, lastSent: string | null): GbpButtonState {
  if (job.service_type !== 'local_seo') return 'hidden';
  const email = job.client?.email?.trim();
  if (!email) return 'no-email';
  return lastSent ? 'sent' : 'idle';
}
```

Tests: non-local_seo → hidden; local_seo + no email → no-email; local_seo + email +
no lastSent → idle; local_seo + email + lastSent → sent.

### Hook: `src/features/jobs/hooks/useGbpAccessSentMap.ts`

```ts
// One shared, cached query (queryKey ['gbp-access-sent-map']); enabled only on the
// Local SEO board so other boards never fetch it. Returns Record<lowercased email, iso>.
export function useGbpAccessSentMap(enabled: boolean): Record<string, string> { ... }
```

Calls `supabase.rpc('gbp_access_sent_map')`, reduces rows to a `{ email: last_sent }`
map. All Local SEO cards share the one cached result (no N+1).

### Hook: `src/features/jobs/hooks/useRequestGbpAccess.ts`

```ts
// mutationFn:
const { data, error } = await supabase.functions.invoke('send-email', {
  body: { identity: 'accounting', to, templateKey: 'localseo_gbp_access', data: { code } },
});
if (error) throw new Error(error.message);
if (data?.status === 'failed') throw new Error(data?.error ?? 'send failed');
return data;
// onSuccess: invalidate ['gbp-access-sent-map']
```

No `dedupeKey` (re-send allowed). `to` = client email, `code` = `job.code ?? job.deal?.code ?? ''`.

### Component: `src/features/jobs/RequestGbpAccessButton.tsx`

- Props: `{ job: JobRow }`.
- Reads `useGbpAccessSentMap(job.service_type === 'local_seo')`, derives
  `lastSent = map[job.client?.email?.toLowerCase() ?? '']` and
  `state = gbpButtonState(job, lastSent ?? null)`.
- `state === 'hidden'` → render nothing.
- `state === 'no-email'` → disabled icon button, `title` = "No client email on file".
- `idle` → ✉ icon button, `title`/aria "Request GBP access".
- `sent` → ✓ icon button (subtle green), `title` "Requested {date} · click to resend".
- Click (idle/sent) → opens a controlled shadcn **`Dialog`** (rendered only when open;
  cheap per-card) with text "Send the Google Business Profile access request to
  **{client email}**?" + Cancel / Send. Send → `useRequestGbpAccess().mutate(...)`;
  on error `window.alert(message)` (app's existing feedback pattern); on success close
  the dialog (the sent-map invalidation flips the card to ✓).
- Button disabled while the mutation is pending.

### Changed: `src/features/jobs/JobsKanbanCard.tsx`

The owner row (currently lines ~105-110, the `<User>` icon + owner name) becomes a
`justify-between` row: owner name on the left, `<RequestGbpAccessButton job={job} />`
on the right — so the button sits **next to the owner**. The button self-hides on
non-local_seo boards (via `gbpButtonState`), so the shared card stays correct
everywhere.

### i18n

`common.json` (en + el): button titles ("Request GBP access", "Requested {{date}} ·
click to resend", "No client email on file"), the confirm dialog title/body/Send/
Cancel, and a generic send-error fallback. (Card text in this file uses the bilingual
`lang`-constant pattern; new strings go in `common.json` since the button uses
`useTranslation`.)

## Error handling

- No client email → button disabled (can't reach the broken state).
- Edge-function error or `data.status==='failed'` → `window.alert` with the message;
  card stays in its prior state; dialog stays open so the user can retry/cancel.
- Pending → button + Send disabled (prevents double-submit).

## Testing

- **Unit:** `gbpAccessButton.test.ts` for the 4 `gbpButtonState` cases.
- `npm run build` green (tsc strict + eslint `--max-warnings=0`).
- **Migration verify:** `gbp_access_sent_map()` exists, is security-definer, executable
  by authenticated, returns rows.
- **Live Playwright smoke:** on `/tech/local-seo`, pick (or temporarily set) a card
  whose client email is a **safe test address** (e.g. `info@itdev.gr`) — NOT a real
  client. Click the button → confirm dialog shows that address → Send → assert a new
  `email_log` row (`template_key='localseo_gbp_access', status='sent'`) and the card
  flips to "✓ sent". Revert any temporary test email. Verify the button does NOT appear
  on `/tech/web-dev`. 0 console errors.

## Changes / Revert

**Changes**
- New migration: `gbp_access_sent_map()` RPC (security definer, grant authenticated).
- New: `gbpAccessButton.ts` (+test), `useGbpAccessSentMap.ts`, `useRequestGbpAccess.ts`,
  `RequestGbpAccessButton.tsx`.
- Edit: `JobsKanbanCard.tsx` (owner row → button), i18n.

**Revert**
- `drop function if exists public.gbp_access_sent_map();`
- `git revert` the frontend commits. Frontend-only otherwise; no data change. The RPC
  is read-only (no risk). Sent emails are real and not "reverted" — but the button
  always confirms first, and smoke uses a test address only.

## Out of scope (YAGNI)

- A Web SEO / GSC equivalent button.
- Editing the email content (done in `email_templates` DB row, unchanged here).
- Bulk "request access for all" actions.
- Changing the auto-onboarding trigger or the `dept_technical` toggle.
