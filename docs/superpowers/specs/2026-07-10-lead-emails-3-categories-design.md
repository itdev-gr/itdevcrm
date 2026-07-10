# Client Email — Lead capture + Sales/Accounting/Technical categories

**Date:** 2026-07-10 · **Status:** approved by owner (3 recommendations accepted)

## Goal

Extend the email pipeline so sales↔lead correspondence is captured and filed on the
**lead**, carried onto the **client + deal** when the lead converts, and reorganize the
Emails tab (deal, job, client, and now **lead** pages) into three collapsible
categories: **Sales**, **Accounting**, **Technical**.

## Current state (what this builds on)

- `gmail-sync` edge fn sweeps read-scoped mailboxes every 5 min, calls
  `resolve_email_filing(from, to, subject)` per message, upserts into `email_messages`.
- `resolve_email_filing`: staff↔external only; job code in subject → files on
  job+deal+client with `department = job.service_type`; else external address must match
  a **client** or the email is skipped; uncoded client mail → `department='sales'`.
  **Leads never match → sales↔prospect email is dropped today.**
- `email_messages` RLS: `staff_user_id = auth.uid() OR current_user_can(department,'view')`.
- Nothing is ever tagged `accounting` (uncoded defaults to `sales`).
- UI: `EmailThreadList` + `useEmailThreads(scope)` with `EmailScope =
  {deal_id?|job_id?|client_id?}`; flat newest-first thread list; tab on deal/job/client.
- Leads are **own-only** for reps (only admins see all) — lead detail page tabs:
  overview, attachments, tasks, activity.

## Decisions (owner-approved 07-10)

1. **Uncoded department rule** (was: always `sales`): by the **staff party's groups** —
   member of `sales` → `sales`; else member of `accounting` → `accounting`; else
   `sales`. One-off retag of already-captured uncoded rows by the same rule.
2. **Automated CRM emails (Resend / email_log) stay OUT** of the Emails tab for now
   (deal Overview status box already covers them).
3. **Category sections default expanded when non-empty**; empty ones render collapsed
   with a `(0)` count. Clicking a header toggles.

## Data & pipeline changes

### 1. `email_messages.lead_id`

```sql
alter table public.email_messages add column lead_id uuid references public.leads(id);
create index email_messages_lead_idx on public.email_messages(lead_id) where lead_id is not null;
```

### 2. `resolve_email_filing` v3

Return signature gains `lead_id uuid`. Logic:

1. (unchanged) exactly one staff party; job code → job/deal/client + service dept.
2. (changed) uncoded, client matched → dept by **staff-group rule** (sales →
   `sales`; elif accounting → `accounting`; else `sales`). Membership read from the
   same tables `current_user_can` uses (check live schema: `groups` + membership).
3. (new) no client match → match `leads` on `lower(email) = external address` where
   `converted_at is null and archived = false`, newest `created_at` first →
   return `lead_id`, `department = 'sales'`, no client/deal/job. Client match keeps
   **precedence** over lead match (existing-customer resubmission case).
4. (unchanged) no match at all → skip (privacy).

> Implementation note: prod function bodies drift from `.sql` files — read the live
> body via `pg_get_functiondef` before editing (both this fn and
> `convert_lead_to_client`).

### 3. Conversion carry-over

At the end of the success path of `convert_lead_to_client` (latest def:
`20260703120000_business_profile_name.sql`, but verify live):

```sql
update public.email_messages
   set client_id = new_client_id, deal_id = new_deal_id
 where lead_id = target_lead_id;
```

`lead_id` stays populated (history). From then on the address matches the client path,
so new mail files on the client exactly as today ("works as we have it now").

### 4. RLS — lead emails must not leak across reps

Replace `email_messages_select`:

```sql
using (
  staff_user_id = auth.uid()
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
)
```

- **Lead-only email** (pre-conversion): sender/receiver, the lead's owner, admins.
  Sales-group view rights deliberately do NOT grant (leads are own-only).
- **Client email** (incl. post-conversion): department rule, unchanged.

### 5. One-off retag (migration, idempotent)

For existing rows with `department='sales'`, `job_id is null` **and `lead_id is
null`** (lead emails are always Sales by rule): set `department='accounting'` where the
`staff_user_id` is in the accounting group and not in sales. (~176 rows currently;
expected effect: owner-mailbox uncoded mail → Accounting.)

### 6. `gmail-sync` edge fn

Pass through `lead_id: f.lead_id` in the upsert. No other changes. Redeploy.

## UI changes

### `useEmailThreads`

- `EmailScope` gains `lead_id?` (filter precedence: deal → job → client → lead).
- `EmailThread` gains a computed `category: 'sales' | 'accounting' | 'technical'`
  derived from the **newest message's** `department`: `sales`→sales,
  `accounting`→accounting, anything else incl. `null`→technical. Pure function,
  unit-tested alongside `groupThreads`.

### `EmailThreadList`

- Groups threads into three sections rendered in order **Sales, Accounting,
  Technical**. Section header: category label + thread count + chevron; clicking
  toggles. Initial state: expanded iff the section has threads.
- Empty tab overall → existing `CommentEmptyState` (no headers).
- Thread cards inside a section are unchanged (newest-first).

### Lead page

- `LeadDetailPage` gets an `emails` tab (after `attachments`, same trigger classes),
  `<EmailThreadList scope={{ lead_id: lead.id }} clientEmail={lead.email ?? ''} />`.
- Reply reuses `SendEmailDialog identity="personal"` — works for prospects.

### i18n

- `leads.json` (en+el): `tabs.emails`.
- `email.json` (en+el): `category.sales`, `category.accounting`, `category.technical`.

## Out of scope (explicit)

- Merging automated `email_log`/Resend sends into the tab (decision 2).
- Reply defaulting to the thread counterparty (pre-existing gap, unchanged).
- Gmail read-scope rollout to more mailboxes (ops, not code).

## Testing

- Unit: category mapping + grouping (extend `useEmailThreads.test.ts` /
  `EmailThreadList.test.tsx` — section headers, toggle, default states).
- DB: role-switch RLS test (technique in attachments-RLS reference): rep A sees own
  lead's emails, rep B doesn't, admin sees all; post-conversion visibility widens to
  the dept rule.
- Live: file a real lead email via `resolve_email_filing` select-test before enabling;
  verify convert carries rows (staging on a test lead).
- `npm run build` green; `npx vitest run src/features/email/` green.

## Changes / Revert

| Change | Revert |
| --- | --- |
| `email_messages.lead_id` + index | `alter table email_messages drop column lead_id;` |
| `resolve_email_filing` v3 | restore v2 body (snapshot live def in migration comment before replacing) |
| `convert_lead_to_client` carry-over | restore prior body (same snapshot rule) |
| RLS policy replacement | recreate policy from `20260709175000_email_messages.sql` |
| Retag migration | rows are recomputable: `update email_messages set department='sales' where department='accounting' and job_id is null and lead_id is null;` |
| `gmail-sync` redeploy | redeploy previous version (lead_id column tolerated) |
| UI (hook/component/lead tab/i18n) | git revert of the feature commits |
