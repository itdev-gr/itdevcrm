# Per-deal "pause payment reminders" toggle

**Date:** 2026-06-26
**Status:** Approved — ready for implementation plan

## Problem

Accounting sometimes needs to stop automated payment-reminder emails from going to a
specific client (e.g. a special arrangement, a dispute, an on-hold negotiation) without
disabling reminders globally. Today the only lever is the global automation gate; there is
no per-deal control.

## Goal

A toggle on the deal page that, when ON, prevents the three automated payment-reminder
emails from being sent to the client **for that one deal**. Editable by **accounting and
admins**; visible (read-only) to everyone else.

## Scope (decided)

- **Suppresses only the 3 payment reminders**: due-soon (−7d), overdue (+1d),
  final-notice (+7d). All other emails (welcome, receipts, onboarding, etc.) are unaffected.
- **Visibility**: everyone sees the toggle; only accounting + admins can change it
  (read-only/disabled for everyone else), matching the existing billing fields.
- **Per-deal granularity.** Not per-payment, not per-client.

### Out of scope (YAGNI)

- No per-payment granularity.
- No reason/note field.
- No separate badge on the deal kanban card.
- No new backend RLS policy (rides on existing `deals` UPDATE policy, same as current
  billing fields).

## Design

### 1. Database — new flag column

New migration adds:

```sql
alter table public.deals
  add column suppress_payment_reminders boolean not null default false;
```

- Default `false` ⇒ zero behaviour change for all existing deals.
- Naming mirrors the existing `profiles.exclude_from_lead_distribution` flag precedent.

### 2. Cron function — one predicate

`enqueue_payment_reminders()` (currently in
`supabase/migrations/20260616000005_drop_due_today_reminder.sql`) is recreated with one
added condition on the deal join:

```sql
join public.deals d
  on d.id = dp.deal_id
 and d.archived = false
 and d.suppress_payment_reminders = false   -- NEW
```

That is the entire backend behaviour change. All three reminder types flow through this one
loop, so the single predicate covers all of them. The function is `security definer`, so
there are no RLS concerns reading the column.

### 3. Frontend toggle (`src/features/deals/DealForm.tsx`)

- A `Switch` placed in the billing area, labelled in Greek:
  **"Παύση υπενθυμίσεων πληρωμής"** with helper text
  *"Δεν θα αποστέλλονται emails υπενθύμισης πληρωμής στον πελάτη για αυτή τη συμφωνία."*
- Reads current state from the deal row.
- Writes through the existing `useAutoSave` → `dealPatch` →
  `supabase.from('deals').update(...)` flow — no new mutation plumbing.
- `disabled={!canManageBilling}` where
  `canManageBilling = isAdmin || groupCodes.includes('accounting')` (already defined),
  so everyone sees it but only accounting + admins can flip it.

### 4. Audit & types

- The existing deals activity-log trigger records the column change (who + when)
  automatically — it is a direct in-app edit, so the actor is captured, not "System".
- Regenerate / update Supabase types for the new column per the project's usual
  `types:gen` pattern.

### 5. Security boundary (explicit)

Updating the column rides on the existing `deals` UPDATE RLS (admin +
`accounting_onboarding` edit). The toggle's protection for other users is UI-level
`disabled`, exactly like the current billing fields (`payment_method`, `temp_deal_amount`).
Consistent with the codebase; no new RLS policy added.

## Testing (TDD, one commit per step)

1. **Migration** — assert column exists and defaults to `false`.
2. **Cron** — SQL test in a rolled-back transaction: seed a *suppressed* deal + a *control*
   deal, both with a payment dated in the reminder window; run
   `enqueue_payment_reminders()`; assert the suppressed deal produces **0** `email_outbox`
   rows and the control produces **1**.
3. **Frontend** — verify the Switch is `disabled` for a non-billing user and saves for an
   accounting/admin user.

## Changes / Revert

| Change | Revert |
| --- | --- |
| Migration: add `deals.suppress_payment_reminders boolean default false` | `alter table public.deals drop column suppress_payment_reminders;` |
| Migration: recreate `enqueue_payment_reminders()` with the `suppress_payment_reminders = false` predicate | `create or replace function` restoring the version in `20260616000005` (predicate removed) |
| `DealForm.tsx`: add the Switch + wire into `dealPatch` | Revert the commit |
| Supabase types updated | Revert the commit |

All DB changes ship as migrations with inline `-- ROLLBACK:` notes. Frontend changes are
atomic commits.
