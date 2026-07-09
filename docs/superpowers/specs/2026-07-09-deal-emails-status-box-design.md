# Design: Deal Overview "Emails" status box (3-color, realtime)

**Date:** 2026-07-09
**Status:** Approved to build (user: "create a plan and build it on the already exist system"). Two product defaults chosen while user was away — flagged below, easily reversible.

## Problem

On the Deal Overview there's no at-a-glance view of what emails have gone out for a deal and whether they landed. The team wants a box next to the Deal summary listing the deal's emails, color-coded by delivery status, updating live as new job emails send and as delivery/bounce webhooks arrive.

## Requirements (from user)

- A box on the Deal Overview, next to the Deal summary, listing all emails sent for this deal.
- 3 colors: **green** = sent & delivered, **yellow** = sent but not delivered yet, **red** = bounced (sent, never delivered) or failed to send.
- Must include emails from the deal's **jobs** (each job has its own emails), and update as new jobs open.
- Must update in **real time**.
- Build on the existing system ("we already have this in the Activity").

## Key facts (verified against live prod + code)

- **Source table `email_log`** (`20260602000001_email_tables.sql`; lifecycle broadened in `20260625110400`): `status ∈ ('sent','failed','delivered','bounced','complained')`, plus `delivered_at`, `bounced_at`, `client_id`, `to_email`, `template_key`, `dedupe_key`, `resend_id`, `error`, `created_at`. Live counts today: delivered 1693, sent 331, bounced 278, failed 88 — all three colors are real.
- **Delivery/bounce is live**: Resend webhook (`supabase/functions/resend-webhook/`) updates `email_log` by `resend_id` → `delivered`/`bounced`/`complained` + timestamps.
- **Emails carry only `client_id`** — no `deal_id`/`job_id`. BUT `dedupe_key` encodes the owning entity, verified in prod:
  - `localseo_gbp:<deal_id>`, `webseo_gsc:<deal_id>` (job onboarding/access) → **deal id**
  - `job:<job_id>` → **job id** (→ deal via `jobs.deal_id`)
  - `pay_overdue|pay_soon|pay_final:<deal_payment_id>` → **payment id** (→ deal via `deal_payments.deal_id`)
  - `won_*`, `lead_welcome`, `seq` → **lead** id (sales funnel, NOT this deal); `task:` → task id
  So the deal's own + its jobs' + its payments' emails are precisely resolvable; lead-funnel/task noise is excluded.
- **`activity_log` mirrors every email** (trigger `log_email_activity`, one row per email updated in place sent→delivered/bounced), carries `client_id`, and its SELECT policy is `authenticated / qual=true` (readable by all staff). This is the existing "we have it in Activity" surface — but it renders **text labels only**, no color helper (`format.ts:424-435`).
- **Realtime**: app uses Supabase Realtime widely; canonical pattern `useJobsForDeal.ts:31-46` (channel + `postgres_changes` filtered by `deal_id` → `invalidateQueries`). `jobs` and `deal_payments` are already in the `supabase_realtime` publication; **`activity_log` and `email_log` are not**. `email_log` is admin-only RLS (realtime wouldn't reach non-admins); `activity_log` is public (realtime reaches all staff).
- **Reusable server pattern**: `seo_access_sent_map()` (`20260702150000`) — a `security definer` function over `email_log` granted to `authenticated`. We mirror it.
- **Deal page**: `DealDetailPage.tsx` — Overview left column stacks `<DealForm initial={deal} />` (the "Deal summary" box, ~line 332) then Notes/Services/Jobs; `deal.id` and `deal.client_id` are in scope. Box styling used throughout: `rounded-xl border border-border/60 bg-card p-3 shadow-sm`.

## Decisions

1. **Scope = deal-scoped** (default chosen while user away; client-scoped is a one-line RPC change if preferred). Show emails where `email_log.client_id = deal.client_id` AND the `dedupe_key` trailing-UUID ∈ { deal.id } ∪ { deal's job ids } ∪ { deal's deal_payment ids }. This is exactly "this deal + its jobs (+ its payment reminders)", and naturally excludes the client's other deals and lead-funnel emails.
2. **Color mapping** (from `email_log.status`): `delivered`→🟢 green; `sent`→🟡 yellow; `bounced|failed|complained`→🔴 red. (Pre-send `email_outbox.pending` is transient and not shown; a failed send surfaces as red once `email_log.status='failed'`.)
3. **Data via `security definer` RPC** over `email_log` (keeps `email_log` admin-RLS unchanged; consistent with `seo_access_sent_map`).
4. **Realtime via `activity_log`** (already public + already mirrors every email incl. delivery updates): add `activity_log` to the `supabase_realtime` publication, subscribe filtered by `client_id`, and invalidate the RPC query only when the changed row is an email. Chosen over adding `email_log` (which would require loosening its admin-only RLS to reach non-admins). Trade-off: `activity_log` is higher-write, so the realtime server processes all activity events; acceptable at this agency's scale and reversible (`alter publication … drop table`). Also unlocks a future realtime Activity feed.

## Architecture

### Server (one migration)

**RPC `public.deal_email_statuses(p_deal_id uuid)`** — `security definer`, `stable`, `set search_path=public`, `grant execute to authenticated`:

```sql
create or replace function public.deal_email_statuses(p_deal_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text,
  delivered_at timestamptz, bounced_at timestamptz, created_at timestamptz, dedupe_key text
)
language sql security definer set search_path = public stable
as $$
  with d as (select client_id from public.deals where id = p_deal_id),
  ids as (
    select p_deal_id as k
    union all select j.id  from public.jobs j          where j.deal_id  = p_deal_id
    union all select dp.id from public.deal_payments dp where dp.deal_id = p_deal_id
  )
  select e.id, e.to_email, e.template_key, e.status,
         e.delivered_at, e.bounced_at, e.created_at, e.dedupe_key
  from public.email_log e
  join d on e.client_id = d.client_id
  where e.dedupe_key ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (substring(e.dedupe_key from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))::uuid
        in (select k from ids)
  order by e.created_at desc;
$$;
grant execute on function public.deal_email_statuses(uuid) to authenticated;
```

**Realtime publication:** `alter publication supabase_realtime add table public.activity_log;`

### Client

- **`src/features/deals/emailStatusColor.ts`** — pure helpers (unit-tested, no I/O):
  - `emailStatusColor(status: string): 'green' | 'yellow' | 'red'` — delivered→green, sent→yellow, else→red.
  - `summarizeEmailStatuses(rows): { green: number; yellow: number; red: number; total: number }`.
- **`src/features/deals/hooks/useDealEmails.ts`** — react-query calling RPC `deal_email_statuses` (`{ p_deal_id }`), `staleTime 30s`; returns `DealEmailRow[]`. Plus a realtime effect (mirroring `useJobsForDeal`): `supabase.channel(\`deal-emails-${dealId}\`).on('postgres_changes', { event:'*', schema:'public', table:'activity_log', filter:\`client_id=eq.${clientId}\` }, (payload) => { if ((payload.new as any)?.entity_type === 'email_log' || (payload.old as any)?.entity_type === 'email_log') qc.invalidateQueries({ queryKey }) }).subscribe()`, cleanup `removeChannel`. Signature `useDealEmails(dealId: string, clientId: string)`.
- **`src/features/deals/DealEmailsBox.tsx`** — the box. Header: "Emails (N)" with three colored count pills (🟢 g / 🟡 y / 🔴 r). Body: list rows, each = a colored status dot + `emailTemplateLabel(template_key)` + `to_email` + relative time (`delivered_at ?? bounced_at ?? created_at`); red rows show the bounce/fail reason (`error`) as title/tooltip. Loading → muted placeholder; empty → muted "No emails sent for this deal yet." Read-only.
- **`format.ts`**: export the existing `emailTemplateLabel(key: string): string` helper for reuse (currently module-private).
- **Integration** in `DealDetailPage.tsx` Overview left column, immediately after `<DealForm initial={deal} />`: `<DealEmailsBox dealId={deal.id} clientId={deal.client_id} />`.

## Data flow

new job email sends / webhook marks delivered|bounced → `email_log` insert/update → `log_email_activity` writes/updates `activity_log` (client_id) → Realtime `postgres_changes` on `activity_log` (filtered client_id) → callback sees `entity_type='email_log'` → `invalidateQueries` → RPC `deal_email_statuses` refetches (recomputes deal's job/payment id-set, so newly-opened jobs' emails are included) → box re-renders with updated colors/counts.

## Error / empty / loading

- RPC error → hook returns empty; box shows empty state; never blocks the page.
- 0 emails → "No emails sent for this deal yet."
- Realtime subscribe failure → data still loads via react-query; staleTime refetch on focus provides a fallback.

## Testing

- **Pure helpers (`emailStatusColor.test.ts`)**: status→color for delivered/sent/bounced/failed/complained/unknown; `summarizeEmailStatuses` counts a mixed set correctly.
- **Component (`DealEmailsBox.test.tsx`)** with a mocked `useDealEmails`: renders count pills; one row per email with correct dot color + label + recipient; empty state when no rows; red row exposes the error text.
- **RPC (manual, rolled-back on prod)**: a DO-block that inserts a client+deal+job+deal_payment and email_log rows keyed by deal.id / job.id / payment.id and asserts `deal_email_statuses(deal)` returns exactly those and excludes a same-client email keyed to another deal's id — then `RAISE EXCEPTION` to roll back (prod has no pgTAP; this mirrors the project's live-verify pattern).
- Realtime wiring is verified manually in the live app (open the box, send/deliver an email, watch it recolor).

## Changes / Revert

**Changes:**
- Migration `supabase/migrations/2026….._deal_email_statuses_and_activity_realtime.sql`: create `deal_email_statuses(uuid)` + `alter publication supabase_realtime add table public.activity_log`. Applied to prod via Management API (project's standard).
- New: `emailStatusColor.ts`, `hooks/useDealEmails.ts`, `DealEmailsBox.tsx` (+ tests). Export `emailTemplateLabel` from `format.ts`. Wire into `DealDetailPage.tsx`.

**Revert:**
- `drop function if exists public.deal_email_statuses(uuid);`
- `alter publication supabase_realtime drop table public.activity_log;`
- `git revert` the frontend commit(s) / restore `DealDetailPage.tsx` and delete the new files; revert the `format.ts` export.
- No data is mutated; all reads. Rollback is fully reversible.
