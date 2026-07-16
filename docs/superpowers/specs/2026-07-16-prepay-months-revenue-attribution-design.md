# Design: Prepay N months + revenue attribution by period month

**Date:** 2026-07-16
**Status:** DRAFT — owner asked for the upgrade; the four product decisions below
were answered with my recommendations because the owner was away when asked.
⚠️ OWNER MUST CONFIRM the "Assumptions" section before implementation.

## Problem

1. Clients want to prepay 1/3/5 months. The machinery already supports chained
   paid periods safely (verified in the 07-16 read-only audit: spawner successor
   guard, duplicate-period trigger, stage/blocks/reminders all key on unpaid
   rows), but the accountant must hand-create each future period with exactly
   chained dates — the duplicate guard only blocks *identical* periods, so a
   typo'd date creates a gap or an overlapping record.
2. Prepaid revenue all lands in the collection month: `accounting_ledger_v`
   uses `COALESCE(paid_at::date, start_date)` as event_date/period, so 3 months
   prepaid show as 3× revenue this month and zero in the covered months. Owner
   wants each month's revenue in its own month.

## Assumptions (owner's ⭐-recommended defaults — CONFIRM before build)

1. **Yearly payments** (hosting): whole amount in the **period-start month**;
   no 1/12 spreading (ledger stays 1 row = 1 payment, CSV/PDF exports unchanged).
2. **One-time payments**: unchanged — **paid month** (`coalesce(paid_at, start_date)`).
3. **Expenses**: symmetric change — recurring expenses → period-start month,
   one-time expenses → paid month (keeps monthly net profit comparing
   like-for-like).
4. **Prepay UX**: one deal-level button; N covers **all active monthly chains**
   of the deal (no per-service selection); periods are created AND marked paid
   in one atomic RPC.

## Part A — Revenue attribution (one view migration)

Replace `accounting_ledger_v`'s event date for BOTH arms ('in' deal_payments,
'out' expenses):

```sql
case when billing_type in ('recurring_monthly','recurring_yearly')
     then start_date
     else coalesce(paid_at::date, start_date) end  as event_date
-- period = to_char(<same expr>, 'YYYY-MM')
```

- `accounting_pl_summary_v` derives from the ledger — no change needed.
- Frontend (`useLedger`, `usePLSummary`, CSV/PDF exports, month filter) — no
  change needed; they consume `event_date`/`period` as-is.
- `useMRR`/`useContractedMRR` already use `start_date`/face values — untouched.
- **Retroactive effect (flag to owner):** historical recurring payments paid
  late (e.g. an overdue June period paid in July) move back to their covered
  month, so past months' totals in the Report will shift slightly. This is the
  intended accrual semantic, applied uniformly.

## Part B — Prepay RPC (one migration)

`public.accounting_prepay_months(p_deal_id uuid, p_months int) returns jsonb`
— security definer, gate: `current_user_is_admin() or current_user_in_group('accounting')`
(same population as the Payments tab's edit rights). `p_months` clamped to 1..12.

Logic (mirrors `ensure_recurring_payments_v2`'s grouping exactly):

- For each **recurring_monthly** group of the deal (`billing_group_id` or
  `solo:<job_id>`) having `billing_active`, non-archived jobs:
  - `cur_end := max(end_date)` across the group's linked payments (via
    deal_payment_lines, same join as v2). If NULL (no seeded period yet) →
    skip group, report `no_base_period`.
  - Loop `p_months` times: insert `deal_payments (deal_id, service_type null,
    billing_type 'recurring_monthly', start_date cur_end, end_date cur_end+1mo,
    status 'paid', paid_at now(), amount_net 0, vat_rate 24)`; insert
    `deal_payment_lines` per group job (label/amount/vat from the job, as v2);
    update header amount from line sums (as v2); advance `cur_end`.
    NB: v2 inserts pending rows; here rows are born `paid` — the after-insert
    line-seeding and no-duplicate-period triggers behave identically.
  - The duplicate-period trigger silently drops an exact-duplicate insert
    (returns null) — the RPC detects a null-returning insert and reports it
    (`skipped_duplicate`) instead of silently advancing.
- Returns `{ok, periods_created, groups: [{group_key, service_types, created,
  new_horizon}]}` for the UI toast.
- Knock-on effects, all existing and already verified: `recompute_job_period_dates`
  (job due = new horizon), `reconcile_deal_stage` (deal stays/lands Paid In
  Full), on-hold release, nightly spawner resumes 7 days before the new horizon,
  SEO renewal ping fires at most once, reminders stay silent. Yearly chains are
  NOT touched by prepay (months semantic).

## Part C — Prepay UI (PaymentsPanel)

- "Prepay" button in the Payments tab header (visible to the same users who can
  edit payments; i18n namespace `deals`, EN+EL).
- Dialog: months selector 1–12 (default 3) + a preview list of the deal's
  monthly chains — service label(s), €/month, current horizon (max end_date),
  new horizon after N months — and the grand total to be recorded as paid.
  Deals with no monthly chain: button hidden.
- Confirm → RPC → success toast with periods created + new horizon; invalidate
  `dealPaymentsKey`, `jobsBillingKey`, `['accounting-deals']`.

## Testing

- RPC: rolled-back RED/GREEN DO-blocks on prod (fixture deal + monthly job):
  N=3 creates 3 chained paid periods (start[i]=end[i-1]), header amounts = line
  sums, re-run with N=1 continues from the new horizon, duplicate insert reports
  `skipped_duplicate`, permission denied for non-accounting.
- View: before/after query on a known prepaid fixture — period = covered month
  for recurring, paid month for one_time; pending rows unchanged.
- Frontend: vitest for the dialog (chains preview math, months clamp, RPC args)
  mirroring existing PaymentsPanel test patterns; ledger/PL hooks untouched.
- Manual smoke: prepay 2 months on a real recurring deal → Payments tab shows 2
  new paid rows, Report shows each month's amount in its own month, deal stays
  Paid In Full, job due = new horizon.

## Changes / Revert

- **Changes:** migration 1 (ledger view redefinition — capture live view def
  first), migration 2 (RPC + grant to authenticated, execute revoked from anon
  per grant-boundary rule), frontend commit (button + dialog + tests).
- **Revert:** restore the captured pre-change `accounting_ledger_v` definition;
  `drop function public.accounting_prepay_months(uuid, int)`; revert the
  frontend commit. Any periods already created by the RPC are ordinary
  deal_payments rows — they stay (delete manually per deal if ever needed).
