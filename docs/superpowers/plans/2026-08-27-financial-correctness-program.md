# Financial Correctness Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CRM's financial data structurally unable to go wrong: truthful payment dates at entry, locked closed months, guarded status transitions, VAT derived from one rule, continuous money-side integrity detection with a UI someone actually sees — plus repair of the ~130 historical rows whose reported month is wrong today.

**Architecture:** Three layers of defense. **Entry**: the UI and DB collect the *real* payment date and refuse impossible transitions, so wrong data cannot be created. **Locks**: closed months are frozen at the database level, so history cannot silently change (the B2/E-audit mutation class dies here). **Watch**: nightly integrity checks now look at `deal_payments`/`expenses` themselves (not just jobs) and surface into an alerts page with a resolve button, so anything that slips through is seen within 24h instead of never.

**Why this exists (root-cause analysis the owner asked for):** The ΓΑΒΡΙΗΛΙΔΗΣ case (deal 000205: paid 02/04, reported in August) happened because `paid_at` records *when staff clicked paid*, not when money arrived — and nothing asked for the real date. The same class produced the 19-26/06 wave (86 rows, €28k of Jan–May income reported as June). Every audit finding traces to one of three systemic gaps: (1) entry points that silently substitute system time/defaults for facts (paid_at:=now, vat:=country-only, expenses vat default ignored); (2) zero immutability — any paid row editable/deletable forever; (3) detection pointed at `jobs` while money lives in `deal_payments` (0 of 27 checks saw A0), with 342 alerts in a table no UI reads. This plan closes all three gaps.

**Tech Stack:** Supabase Postgres (migrations via Management API, md5 pre/post on redefinitions, `-- ROLLBACK:` blocks), React+TS frontend (vitest), pg_cron. House patterns: security definer + explicit grants, `data_integrity_alerts` sink, `docs/data-fixes/` notes for every prod data edit.

## Global Constraints

- Every migration: capture `md5(pg_get_functiondef)` pre/post for any redefined function; `-- ROLLBACK:` block; new triggers named `<table>_<purpose>_trg`.
- Every prod data repair: separate `docs/data-fixes/2026-08-<dd>-<slug>.md` with per-row before/after and a rollback statement, committed with the code.
- Live E2E on prod with throwaway rows (ΔΟΚΙΜΗ-* vendors / TEST-titled deals) after each DB task, cleaned up sequentially (never in one CTE — deletes cascade through `log_activity`).
- `npm run typecheck` + `npx vitest run` green before every commit; commit per task.
- Statement timeout ~8s on the Management API — chunk any repair touching >200 rows.
- **Two policy defaults are enacted by approving this plan** (they were owner-gated in the audits; the owner's "δεν θα επιτρέπει να γίνονται λάθη" mandate + plan approval decides them): (a) `partial_payment` deals with overdue balance escalate to `on_hold` like everyone else (audit B1's recommended option — resolves A2); (b) a deal on `on_hold` whose balance reaches €0 auto-releases to `paid_in_full` again (restores the trigger dropped 2026-07-02, audit B5). Purely financial decisions that touch clients' money (refunds, re-charging VAT) remain in the Decisions Checklist at the end — NOT implemented here.
- Known live figures (2026-08-27): ~130 paid `deal_payments` rows with `paid_at::date > start_date + 30` (~€38k) concentrated on 2026-06-19/22/23/26 and 2026-08-06/11/13; `deal_payments` CHECKs today do NOT require `paid_at` when paid (0 violations live, but nothing prevents one); alerts table is `data_integrity_alerts(kind, subject_type, subject_id, details, detected_at, resolved_at, resolved_by)`.

---

### Task 1: Repair the misdated history (the ΓΑΒΡΙΗΛΙΔΗΣ class)

**Files:**
- Create: `docs/data-fixes/2026-08-27-paid-at-backdate-repair.md`
- Create: `scratchpad/repair-paid-at.mjs` (Management API, house pattern)

**Interfaces:**
- Consumes: nothing.
- Produces: repaired rows; the data-fix doc later tasks' E2E may reference. No code.

- [ ] **Step 1: Capture the before-state** (rows where `status='paid' and paid_at::date > start_date + 30`, expected ~130 / ~€38k):

```sql
select dp.id, d.code, dp.service_type, dp.amount_net::text, dp.start_date::text,
       dp.paid_at::text as old_paid_at
from public.deal_payments dp join public.deals d on d.id = dp.deal_id
where dp.status = 'paid' and dp.paid_at::date > dp.start_date + 30
order by dp.paid_at, d.code;
```

Save the full list into the data-fix doc (this IS the rollback map).

- [ ] **Step 2: Repair** — same convention autopay uses (attribute to the real payment date, midnight UTC):

```sql
update public.deal_payments
   set paid_at = start_date::timestamptz
 where status = 'paid' and paid_at::date > start_date + 30;
```

(One statement; ~130 rows is fine. The `deal_payments_recompute_job_dates` trigger only reacts to status/date-column changes on start/end — paid_at is not among them; verify in the run output that no job period dates moved.)

- [ ] **Step 3: Verify**: re-run Step 1's query (must return 0 rows); re-run `select * from public.pl_summary_for_range('2026-04-01','2026-04-30')` and confirm April's income now includes deal 000205's €322.58 net; June's total dropped by ~the 19-26/06 cohort. Snapshot the new month-by-month table into the doc.
- [ ] **Step 4: Also repair the same class on `expenses`** (same rule, expected small count — measure first, include in the doc).
- [ ] **Step 5: Commit** the data-fix doc: `git commit -m "docs(accounting): repair paid_at month attribution for backfilled payments"`.

---

### Task 2: Truthful paid dates at entry — the date is asked, never assumed

**Files:**
- Create: `supabase/migrations/<ts>_paid_requires_paid_at.sql`
- Modify: `src/features/deals/PaymentsPanel.tsx` (toggleStatus ~line 101), `src/features/accounting_report/hooks/useMarkExpensePaid.ts`, `src/features/accounting_report/components/ExpenseDetailDialog.tsx` (mark-paid section ~194-225), `src/features/accounting_report/ExpensesPage.tsx` (bulk mark-paid)
- Test: extend `src/features/accounting_report/hooks/useMarkExpensePaid.test.tsx`; new `src/features/deals/paymentsPaidDate.test.ts` (pure helper)

**Interfaces:**
- Produces: each mark-paid surface carries a local date state (default today) submitted as `paid_at: '<date>T00:00:00Z'`; `useMarkExpensePaid` gains an optional `paidDate?: string` arg (ISO yyyy-mm-dd, defaults to today inside the hook). DB guard triggers `deal_payments_paid_needs_date_trg` / `expenses_paid_needs_date_trg` (shared fn `money_paid_needs_date()`).

- [ ] **Step 1: DB guard (write the migration first)** — a row can never become `paid` without a real `paid_at`, and never dated in the future:

```sql
create or replace function public.money_paid_needs_date()
returns trigger language plpgsql as $$
begin
  if new.status = 'paid' then
    if new.paid_at is null then
      raise exception 'paid rows require paid_at (the real payment date)';
    end if;
    if new.paid_at::date > current_date + 1 then
      raise exception 'paid_at cannot be in the future';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists deal_payments_paid_needs_date_trg on public.deal_payments;
create trigger deal_payments_paid_needs_date_trg
  before insert or update on public.deal_payments
  for each row execute function public.money_paid_needs_date();
drop trigger if exists expenses_paid_needs_date_trg on public.expenses;
create trigger expenses_paid_needs_date_trg
  before insert or update on public.expenses
  for each row execute function public.money_paid_needs_date();
-- ROLLBACK: drop both triggers + the function.
```

- [ ] **Step 2: Frontend — every mark-paid asks for the date** (default today, editable): `PaymentsPanel.toggleStatus` marking paid sets `paid_at` from a small inline date input (default today) instead of blind `new Date().toISOString()`; same for `ExpenseDetailDialog`'s mark-paid and the bulk action (one date applied to the selected rows, prompted once). Write the failing tests first (mark-paid called with chosen date → mutation payload carries `paid_at: '<date>T00:00:00Z'`).
- [ ] **Step 3: E2E on prod**: try `update ... set status='paid', paid_at=null` on a ΔΟΚΙΜΗ row → must raise; with future date → must raise; with real date → works. Clean up.
- [ ] **Step 4: typecheck + vitest; commit.**

---

### Task 3: Status-transition guards — cancelled can't be revived by accident, badges tell the truth

**Files:**
- Create: `supabase/migrations/<ts>_cancelled_transition_guard.sql`
- Modify: `src/features/deals/PaymentsPanel.tsx` (toggleStatus), `src/features/accounting/AccountingKanbanCard.tsx:18`
- Test: `src/features/accounting/accountingKanbanBadge.test.ts` (extract the badge computation into `accountingKanbanBadge.ts` pure helper), extend PaymentsPanel test

- [ ] **Step 1: DB guard**: direct `cancelled → paid` raises; a cancelled row must first be restored to `pending` (deliberate two-step):

```sql
create or replace function public.deal_payments_block_cancel_revive()
returns trigger language plpgsql as $$
begin
  if old.status = 'cancelled' and new.status = 'paid' then
    raise exception 'cancelled payment cannot become paid directly — restore it to pending first';
  end if;
  return new;
end $$;
create trigger deal_payments_cancel_revive_trg before update on public.deal_payments
  for each row execute function public.deal_payments_block_cancel_revive();
```

- [ ] **Step 2: PaymentsPanel**: a cancelled row's action becomes "Επαναφορά σε εκκρεμές" (sets pending) with a confirm dialog; paid/pending toggle unchanged for other rows.
- [ ] **Step 3: Kanban badge fix (audit B11/F28)**: extract `paidBadge(payments)` into `accountingKanbanBadge.ts` — denominator excludes `cancelled`; test: 2 paid + 1 cancelled → "Paid", not "Partial". Wire into `AccountingKanbanCard`.
- [ ] **Step 4: E2E** (ΔΟΚΙΜΗ row: cancel → try direct paid → raises; → pending → paid → ok; cleanup); typecheck + vitest; commit.

---

### Task 4: Period locks — closed months are physically frozen

**Files:**
- Create: `supabase/migrations/<ts>_accounting_period_locks.sql`
- Create: `src/features/accounting_report/hooks/usePeriodLocks.ts`, `src/features/accounting_report/components/PeriodLockControl.tsx`
- Modify: `src/features/accounting_report/ReportPage.tsx` (render the control for admins)
- Test: `usePeriodLocks.test.tsx`, `PeriodLockControl.test.tsx`

**Interfaces:**
- Produces: table `accounting_period_locks(period text pk 'YYYY-MM', locked_at, locked_by)`; RPCs `lock_accounting_period(p_period text)` / `unlock_accounting_period(p_period text)` (admin-guarded, security definer, log to `activity_log` via normal triggers); enforcement fn `money_period_lock_guard()` used by BEFORE UPDATE/DELETE triggers on both money tables.

- [ ] **Step 1: Migration** — the core guarantee:

```sql
create table public.accounting_period_locks (
  period text primary key check (period ~ '^\d{4}-\d{2}$'),
  locked_at timestamptz not null default now(),
  locked_by uuid
);
alter table public.accounting_period_locks enable row level security;
create policy period_locks_admin_all on public.accounting_period_locks
  for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create or replace function public.money_period_lock_guard()
returns trigger language plpgsql as $$
declare v_period text;
begin
  -- The row's reporting month (same attribution as accounting_ledger_v).
  v_period := to_char(coalesce(old.paid_at::date, old.start_date), 'YYYY-MM');
  if old.status = 'paid'
     and exists (select 1 from public.accounting_period_locks l where l.period = v_period) then
    if tg_op = 'DELETE' then
      raise exception 'period % is locked — paid rows cannot be deleted (unlock the month first)', v_period;
    end if;
    -- Money-relevant fields frozen; harmless fields (notes, receipt, autopay) stay editable.
    if new.amount_net is distinct from old.amount_net
       or new.vat_rate is distinct from old.vat_rate
       or new.status is distinct from old.status
       or new.paid_at is distinct from old.paid_at
       or new.start_date is distinct from old.start_date
       or new.service_type is distinct from old.service_type then
      raise exception 'period % is locked — unlock the month before editing paid rows', v_period;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger deal_payments_period_lock_trg before update or delete on public.deal_payments
  for each row execute function public.money_period_lock_guard();
create trigger expenses_period_lock_trg before update or delete on public.expenses
  for each row execute function public.money_period_lock_guard();
```

`service_type` guard applies only to `deal_payments` (expenses have no such column) — implement as two thin wrapper functions or a `TG_TABLE_NAME` branch; the migration must compile against both tables.

`lock_accounting_period` / `unlock_accounting_period`: security definer, `if not public.current_user_is_admin() then raise exception 'admin only'`, insert/delete the lock row recording `auth.uid()`.

- [ ] **Step 2: UI**: `PeriodLockControl` on the Report page (admin-only): month list with 🔒 state + lock/unlock buttons calling the RPCs; the E22-style month table in ReportHeader is untouched.
- [ ] **Step 3: E2E on prod**: lock `2000-01` (safe past month with a ΔΟΚΙΜΗ paid row planted at that period) → edit amount raises, delete raises, notes edit succeeds, unlock → edit succeeds; cleanup + unlock. Verify the repairs of Task 1 happened BEFORE any lock exists (order matters).
- [ ] **Step 4: typecheck + vitest; commit.** Do NOT lock real months in this task — locking actual history is the owner's button to press (after they confirm the月 figures; noted in Decisions Checklist).

---

### Task 5: Watch the money itself — deal_payments/expenses integrity checks

**Files:**
- Create: `supabase/migrations/<ts>_money_integrity_checks.sql` (redefines `accounting_integrity_alerts` — base `20260806170000_invisible_card_alert.sql`, 25 checks; md5 pre/post, body copied verbatim + new checks appended)
- Test: E2E probes (SQL) — the checks run against live data

**Interfaces:**
- Produces: checks 26–30 in `accounting_integrity_alerts()` (the same function the 04:00 cron persists into `data_integrity_alerts`), kinds: `payment_vat_mismatch`, `paid_backdate_gap`, `payment_missing_dates`, `expense_stale_pending`, `expense_zero_vat_streak`. Helper `public.deal_vat_rate(p_deal_id uuid) returns numeric` — THE single VAT rule.

- [ ] **Step 1: `deal_vat_rate` helper** (one place encodes cash/country):

```sql
create or replace function public.deal_vat_rate(p_deal_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(c.country) end
  from public.deals d join public.clients c on c.id = d.client_id
  where d.id = p_deal_id;
$$;
```

Refactor `seed_deal_payments` + `ensure_recurring_payments`'s cash-guard (from 20260826150000) to call it (md5 pre/post both).

- [ ] **Step 2: New checks appended to `accounting_integrity_alerts`** (verbatim body + these):
  - **26 `payment_vat_mismatch`**: non-cancelled `deal_payments` rows where `vat_rate <> public.deal_vat_rate(deal_id)` — the check A0 proved was missing (0 of 27 could see it). Expect it to fire for the 19 known paid rows + the B3 pair until the owner decides those (that is correct behavior: visible ≠ forgotten).
  - **27 `paid_backdate_gap`**: `status='paid' and paid_at::date > start_date + 30` — the ΓΑΒΡΙΗΛΙΔΗΣ class can never silently return.
  - **28 `payment_missing_dates`**: non-cancelled rows with `start_date is null` (the 13 dateless rows surface daily until fixed).
  - **29 `expense_stale_pending`**: pending expenses with `end_date < current_date - 60`.
  - **30 `expense_zero_vat_streak`**: expenses inserted in the last 7 days with `vat_rate = 0` in categories `software/ads_spend/hosting_domains` (nudges the E5 question at entry time).
- [ ] **Step 3: E2E**: run `select * from public.accounting_integrity_alerts()` live — verify checks 26-28 fire on the known populations with the right counts; plant + clean a ΔΟΚΙΜΗ stale-pending expense for 29.
- [ ] **Step 4: typecheck + vitest (no src changes expected); commit.**

---

### Task 6: Alerts finally have a face — /accounting/alerts page + sidebar badge

**Files:**
- Create: `src/features/accounting/alerts/AlertsPage.tsx`, `hooks/useIntegrityAlerts.ts`, `hooks/useResolveAlert.ts` (+ tests for both hooks)
- Modify: `src/app/router.tsx` (route `alerts` under the accounting section, AdminGuard), `src/components/layout/Sidebar.tsx` (badge with open-alert count for admins)
- Create: `supabase/migrations/<ts>_alerts_resolve_rpc.sql`

**Interfaces:**
- Produces: RPC `resolve_integrity_alert(p_id uuid)` (admin-guarded security definer: sets `resolved_at = now(), resolved_by = auth.uid()`); `useIntegrityAlerts()` → open alerts grouped by kind (via `fetchAllPages` — 342 open rows today, over the cap soon); `useResolveAlert()` mutation.

- [ ] **Step 1: Migration** — RLS select for admins on `data_integrity_alerts` (verify current policy; add if absent) + the resolve RPC (raise if not admin).
- [ ] **Step 2: Page**: kinds as collapsible groups (count, oldest `detected_at`), rows show `subject_type`, deal code where resolvable (join client-side via details jsonb which carries it — inspect a live row's `details` shape first and render its keys generically), resolve button per row + "resolve all in group". Empty state: «Κανένα ανοιχτό θέμα». i18n el/en.
- [ ] **Step 3: Sidebar badge**: open-count chip on the Alerts entry (admins only), 5-minute refetch.
- [ ] **Step 4: The 342-alert backlog**: do NOT bulk-resolve programmatically — the page's group-resolve gives the owner the broom; note in the page's empty-help text that resolving means "I looked at this".
- [ ] **Step 5: typecheck + vitest; commit.**

---

### Task 7: Lifecycle repair — no deal stage is invisible to collections anymore

**Files:**
- Create: `supabase/migrations/<ts>_lifecycle_partial_and_release.sql` (redefines `reconcile_deal_stage` — base `20260702150150_reconcile_deal_stage_respect_holds.sql`; md5 pre/post; body verbatim except the two marked edits)
- Test: E2E probes on prod with a TEST deal

**Interfaces:**
- Consumes: policy defaults enacted by this plan's approval (Global Constraints).
- Produces: `reconcile_deal_stage` where (a) the handled-stage allow-list gains `'partial_payment'` — an overdue partial deal escalates to `on_hold` and thereby becomes remindable through the existing pipeline (closes audit B1's €24.5k blind spot for the partial bucket; `closed`/`done` stay terminal by design); (b) the `on_hold` early-return becomes: block jobs as today, THEN if outstanding balance (non-cancelled pending/overdue) = 0 → move to `paid_in_full` + unblock (restores the auto-release dropped 2026-07-02; deal 000233 unsticks the first night).

- [ ] **Step 1: Migration with the two edits**, commented `-- 2026-08-27 financial-correctness:` at each.
- [ ] **Step 2: E2E**: TEST deal in partial_payment with an overdue row → run `select public.reconcile_deal_stage(<id>)` → lands on_hold; mark rows paid → run again → paid_in_full; verify 000233 (real, stuck 5+ weeks, owes €0) — run reconcile for it and confirm it finally releases (this one is a real repair, record it in the commit message).
- [ ] **Step 3: Check the 15 partial_payment deals**: after deploy, list which moved to on_hold (expected: those with overdue rows) — reminders begin next 06:00 cron. Note the count in the commit.
- [ ] **Step 4: typecheck + vitest; commit.**

---

### Task 8: Expense entry honesty — VAT is a visible choice, receipts get a nudge

**Files:**
- Modify: `src/features/accounting_report/components/NewExpenseDialog.tsx` (~line 44 vat default + submit ~68-100)
- Test: extend `src/features/accounting_report/hooks/useCreateExpense.test.tsx` + NewExpenseDialog test

- [ ] **Step 1**: VAT field becomes an explicit segmented choice **0% / 24% / custom** with NO preselection — submit blocks until chosen (the current silent `'24'` default produced 135/135 rows at 0%, meaning staff always override; make the choice conscious instead). Also fix the dead `paidByUserId` (declared, never sent — audit found it): include it in the insert payload.
- [ ] **Step 2**: When saving with no receipt: non-blocking inline note «Χωρίς παραστατικό» (0/135 expenses have receipts today; a nudge, not a wall).
- [ ] **Step 3: typecheck + vitest; commit.**

---

### Task 9: Docs, memory, and the financial-controls contract

**Files:**
- Create: `docs/tech/accounting/financial-controls.md`
- Modify: `docs/tech/accounting/reporting.md` (link), `docs/tech/accounting/billing-model.md` (fix the stale 3-status line — audit E3/F1)

- [ ] **Step 1: Write `financial-controls.md`**: the three defense layers, every trigger/RPC this plan added with its exact name, the period-lock operating procedure (when to lock a month, how to unlock for a correction + data-fix note requirement), the alert kinds and what each means, and the rule list («paid needs a real date», «cancelled revives only through pending», «locked months are read-only», «VAT comes from deal_vat_rate», «reporting lists go through fetchAllPages»).
- [ ] **Step 2: Fix the stale docs** (billing-model status list → 4 values incl. cancelled with the pause semantics).
- [ ] **Step 3: Final verification sweep**: re-run the two audits' headline queries (A0 detector, misdate detector, stage-vs-money sweep) — expected: zero rows in every class this plan closed; the owner-gated populations (A0's 19 paid rows, the 13 dateless rows) still visible via their alerts, which is by design. Snapshot results into financial-controls.md's "verified at rollout" appendix.
- [ ] **Step 4: Commit; push everything; update memory (payment-fix-backlog: mark items DONE, list what remains owner-only).**

---

## Decisions Checklist (owner-only — money that touches clients; NOT implemented by this plan)

1. **Wrongly-collected VAT (A0)**: **25 rows / €1,297.78** per the live check-26 detector as of 2026-08-28 (the original, narrower audit figure was 19 rows / €977.11 — the live detector is broader: every non-cancelled row where `deal_vat_rate(deal_id)=0 and vat_rate>0`, including deals whose cash/no-VAT setting changed after the fact). Refund, credit, or write-off — alert `payment_vat_mismatch` will keep these rows visible until decided.
2. **B3 mirror (000229/000935 + bulk-import cohort ~€1,890)**: Greek online clients billed 0% — re-charging VAT raises their invoices; needs client communication first. Note: this half of check 26 is not static — `ensure_recurring_payments` copies `vat_rate` forward each renewal, so the count grows by roughly one row per affected deal per renewal until decided.
3. **Pending expense backlog: 105 rows / €61,917.66 gross** (2026-08-03 import, measured 2026-08-28): reconcile via the ExpensesPage bulk mark-paid (now with real dates from Task 2) — bookkeeping session; profit is optimistically skewed until done.
4. **The 19 dateless payment rows** (13 `pending` + **6 already `paid`**, measured 2026-08-28): need real due dates entered (alert `payment_missing_dates` nags daily). The 6 paid ones are worse — money already changed hands into a row no month can see.
5. **All-expenses-VAT-0 policy (E5)**: confirm whether正确 — Task 8 makes future entries a conscious choice either way.
6. **deal_payments RLS (E26)**: 20 non-admin accounts can read payment rows via sales/clients grants — tighten or accept.
7. **When to press "lock"** on months 2026-01 through 2026-07, once the Task 1 repair + the expense reconciliation settle their figures.
8. **000066 (ΦΟΥΡΝΑΡΗ)**: sales note says client pays VAT by bank transfer but deal is now cash/no-VAT — set «Χρέωση ΦΠΑ» flag or renewals bill 0%.
