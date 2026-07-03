# Accounting Alerts page — design

**Date:** 2026-07-03 · **Status:** Approved (brainstorm) — pending implementation plan

## Context

Billing/data anomalies (a €0 deal, a deal missing VAT, a duplicated billing month, a deal held while nothing's overdue, a recurring job that bills nothing) are today invisible unless someone stumbles on them or the cryptic nightly `payment_integrity_alert` notification fires. Accounting needs a single **Alerts** worklist that shows every anomaly the system can detect, links straight to the offending deal/job, and lets them work the list down one by one. It must always reflect the current data (no waiting on a nightly job) and be extensible — each check is one query, so new checks are cheap to add.

## Access

Route `/accounting/alerts`, inside the existing `RequireGroup(['accounting'])` tree (accounting group **+** admins, matching the rest of `/accounting/*`). Sidebar entry "Alerts" under the Accounting section with a **count badge** (open, non-dismissed alert count).

## Architecture

**Live check engine (no stored alerts).** One security-definer RPC:

```
accounting_integrity_alerts()
  returns table (check_key text, severity text, category text,
                 subject_type text, subject_id uuid, subject_code text,
                 title text, detail text, deal_id uuid, job_id uuid, signature text)
```

- Runs every check below as a `SELECT`, `UNION ALL`-ed. Always current.
- Guard at the top: `if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then return; end if;` Granted to `authenticated`.
- Excludes any row that has a matching **dismissal** (see below) on `(check_key, subject_id, signature)`.
- `signature` = a short per-check string capturing the *specific* instance (e.g. duplicate-period → `start:end`; odd-VAT → the rate; €0-deal → `''`). If the situation changes, the signature changes and the alert re-surfaces despite an old dismissal.
- Companion `accounting_integrity_alerts_count()` (or the page derives the count client-side from the list) for the sidebar badge.

**Dismissals (the "Ignore" button).**

```
integrity_alert_dismissals (id uuid pk, check_key text, subject_id uuid,
  signature text, note text, dismissed_by uuid, dismissed_at timestamptz default now())
unique (check_key, subject_id, signature)
```
RPCs `dismiss_integrity_alert(check_key, subject_id, signature, note)` and `undismiss_integrity_alert(id)`, both accounting/admin-gated. RLS: accounting/admin read; insert as self.

**Frontend.**
- `src/features/accounting/alerts/AlertsPage.tsx` — groups rows by `category`, red/amber/grey severity chip, subject code, `detail`, a **link to `/deals/:deal_id` or `/jobs/:job_id`**, and an **Ignore** button. A tab/toggle "Ignored" lists dismissed alerts with **Un-ignore**.
- Hooks: `useIntegrityAlerts()` (rpc), `useDismissAlert()` / `useUndismissAlert()`, `useDismissedAlerts()`.
- Pure presenter `alertPresenters.ts` — maps `check_key`→icon/label, `severity`→chip style, groups + sorts (severity desc, then category). Unit-tested.
- Sidebar: add "Alerts" under Accounting (in `Sidebar.tsx`) with a count badge from a lightweight `useAlertsCount()`.
- Notification: add a `payment_integrity_alert` presenter in `notification-presenters.tsx` → "Billing audit found {alerts_new} issue(s)" linking to `/accounting/alerts` (closes the earlier cryptic-notification gap).

## Check catalog (14) — exact conditions

Scope word "active deal" = `not archived` and accounting stage not in (`closed`,`done`). All checks exclude archived rows.

**💰 Money correctness**
1. `deal_zero_value` (amber) — active deal, `coalesce(one_time_value,0)=0 and coalesce(recurring_monthly_value,0)=0`.
2. `recurring_job_zero` (red) — job `billing_active`, not archived, `parent_job_id is null`, `billing_type in ('recurring_monthly','recurring_yearly')`, `coalesce(amount_net,0)=0`.
3. `vat_missing` (amber) — job not archived, `coalesce(amount_net,0)>0`, `vat_rate=0`, deal `payment_method` is not the cash-no-VAT case (`not (payment_method='cash' and not coalesce(cash_charge_vat,false))`), and client `country` not ilike `'cyprus'`.
4. `vat_odd_rate` (grey) — job not archived, `vat_rate is not null and vat_rate not in (0,24)`.
5. `aiseo_child_amount` (red) — job `parent_job_id is not null` and `(coalesce(amount_net,0)>0 or coalesce(monthly_amount,0)>0 or coalesce(one_time_amount,0)>0)`.

**🔁 Payment / lifecycle consistency**
6. `duplicate_period` (red) — reuse `reconcile_payment_integrity`'s dup query: same `deal_id, service_type, billing_type, start_date, end_date` with `>=2` non-cancelled `deal_payments`. `signature = start:end:service`.
7. `paid_in_full_but_owes` (red) — deal stage `paid_in_full` with a `deal_payments` row `status not in ('paid','cancelled') and start_date < current_date`.
8. `on_hold_not_overdue` (amber) — deal stage `on_hold`, active, with **no** `deal_payments` row `status not in ('paid','cancelled') and start_date < current_date`.
9. `stale_block` (amber) — job `is_blocked`, `blocked_reason='account_on_hold'`, not archived, deal accounting stage `<> 'on_hold'`.
10. `renewal_past_due` (grey) — job in a stage with code `renewal`, not archived, `period_due_date < current_date`. (Mostly = genuinely unpaid after the 2026-07-03 recompute fix.)
11. `billing_gap` (red) — deal active, not in (`closed`,`done`,`on_hold`), has a `billing_active` recurring job, and **no** `deal_payments` row with `status <> 'cancelled' and start_date >= current_date` (no upcoming period scheduled).

**🧹 Missing info**
12. `no_payment_method` (amber) — active deal, `nullif(trim(coalesce(payment_method,'')),'') is null`.
13. `bad_email` (amber) — client (active, status `<> 'done'`) with email null/empty, malformed (`email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'`), or double (`email like '% - %'`).
14. `won_deal_no_services` (amber) — active deal with `coalesce(jsonb_array_length(services_planned),0)=0` and no non-archived jobs.

Severity ordering for display: red → amber → grey.

## Testing
- **pgTAP** (`supabase/tests/accounting_integrity_alerts.sql`): seed a €0 deal, a no-VAT Greek job, and a duplicate-period pair → the RPC returns exactly those `check_key`s; `dismiss_integrity_alert` on one → it disappears; a non-accounting/non-admin role → RPC returns empty.
- **Unit** (`alertPresenters.test.ts`): grouping + severity sort + `check_key`→label mapping; count derivation.

## Changes / Revert
**Changes** — migration: `integrity_alert_dismissals` table + RLS; `accounting_integrity_alerts()` + `..._count()` + `dismiss_/undismiss_integrity_alert` RPCs + grants. Frontend: route in `router.tsx`, `AlertsPage` + hooks + `alertPresenters`, sidebar entry + badge, `payment_integrity_alert` notification presenter, types.
**Revert** — drop the four functions + the table (ROLLBACK in the migration); revert the frontend files + the router/sidebar/notification edits.
