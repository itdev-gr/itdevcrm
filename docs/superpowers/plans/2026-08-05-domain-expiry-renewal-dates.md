# Domain Expiry → Renewal Due Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-date the 27 `domains` recurring-yearly billing rows so each one comes due on the domain's real registry expiry date instead of the arbitrary deal-creation date the seeder wrote.

**Architecture:** A one-off data migration in the repo's established backfill style — a timestamped backup table, one set-based `UPDATE ... FROM (VALUES ...)`, and a verification query that must return zero rows. No function bodies, no schema changes, no frontend changes. The existing `deal_payments_reconcile_stage` trigger does the downstream work (accounting-stage recompute, job unblocking) automatically as a consequence of the `UPDATE`.

**Tech Stack:** PostgreSQL 15 (Supabase), pgTAP for the regression test, Supabase Management API for applying to prod (this machine has no psql / supabase CLI — see `memory/crm-supabase-project.md`).

## Global Constraints

- Production project ref: **`xujlrclyzxrvxszepquy`**. Queries and migrations go through
  `POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query` with a `sbp_…`
  PAT in `Authorization: Bearer`. Use **curl**, not python `urllib` (Cloudflare returns `403 error code: 1010`).
- A whole migration file may be posted as a single `query`; Postgres runs it in one implicit
  transaction, so any error rolls the entire file back.
- **Never write `jobs.period_start_date` / `jobs.period_due_date` directly.** They are derived by
  `recompute_job_period_dates()` from the most recent **paid** `deal_payments` row. Hand-written
  values drift and get overwritten. (`20260701020000_jobs_period_dates.sql`, design note 1.)
- The due date the CRM acts on is **`deal_payments.start_date` of the unpaid row** — that is what
  `deal_next_due()` reads and what `target_accounting_stage()` turns into `on_hold` /
  `awaiting_payment`. `end_date` is the period close and drives `ensure_recurring_payments()`
  and `mark_overdue_payments()`.
- Every `domains` row is `billing_type = 'recurring_yearly'`, so `end_date = start_date + 1 year`.
- Migration filenames must sort **after** `20260806090000_job_billing_pause_ok_contract.sql`,
  the last applied migration. Use the `20260806100000` prefix.
- Repo convention: record pre/post state in the migration header, and drift-check
  `md5(pg_get_functiondef(oid))` before editing any function. **This plan edits no functions**, so
  no drift check is required — state that explicitly in the header rather than omitting it.

---

## Background — what discovery found (2026-08-05)

Read this before touching anything; it is the whole justification for the change.

**The source file.** `~/Downloads/Domains_Expiry_List_Final.xlsx` holds 48 domains in three columns
(`Domain`, `Expiry Date`, `Had Deal`). 21 rows carry `Had Deal = no` — no deal ever existed, so
there is nothing in accounting to correct; **they are out of scope** (owner decision, 2026-08-05).
The remaining 27 rows have a blank `Had Deal` cell and are the targets.

**The match.** Prod has exactly **27 non-archived `jobs` rows with `service_type = 'domains'`**, and
they map one-to-one onto the 27 target rows — a perfect bijection, no leftovers on either side.
`jobs.details` is `{}` on all 27 (the `domain` info field defined in
`src/features/jobs/serviceInfoFields.ts:57` was never filled in), so the match is made on
`clients.website`, corroborated independently by `deal_payments.label` (see below). Four needed
context rather than a URL comparison:

| Domain | Matched to | Why |
|---|---|---|
| `navergo.gr` | 000079 — NAVERGO ΝΑΥΠΗΓΟΕΠΙΣΚΕΥΑΣΤΙΚΗ Ε.Ε. | `clients.website` is null; client name + label `05/06/2028` matches the sheet exactly |
| `opawey.com` | 000404 — OPAWEY E E | `clients.website` is null; client name + label `29/03/2029` matches the sheet exactly |
| `servistasathens.gr` | 000431 — SERVISTAS Ι.Κ.Ε. | `clients.website` is `https://servistas.gr/` (different domain, same client); label `04/11/2027` matches the sheet exactly |
| `transfertoursthassos.com` | 000261 — ΧΡΙΣΤΟΔΟΥΛΟΥ ΗΛΙΑΝΑ | `clients.website` is `http://www.taxi-thassos.gr/` (different domain, same client); label `10/07/2027` matches the sheet exactly |

**The defect.** All 27 rows were seeded with `start_date` = roughly the deal-creation date
(2026-04-30 … 2026-08-05) and `end_date = start_date + 1 year`. None of those dates has anything to
do with when the domain actually expires. Consequences visible in prod today:

- 26 of 27 rows are `status = 'overdue'`, 1 is `pending`. All 27 are unpaid, €20.00 net each.
- `deal_next_due()` therefore returns a **past** date for all 27 deals.
- **18 of the 27 deals sit in `on_hold`**, and for **15 of them the domains row is the only reason**
  — there is no other unpaid non-`domains` row with a past due date. Their jobs are blocked and
  their clients are being chased for €20 that is not yet owed.
- All 27 jobs show a blank "Renewal due" column on the Domains board, because
  `period_due_date` derives from a **paid** row and none of these has ever been paid.

Note `mark_overdue_payments()` only flips `pending → overdue` when `end_date < current_date`
(`20260610000004`, section 3), and every `end_date` here is in 2027. So the `overdue` status was not
set by that cron — it was set at seed time or by hand, and **nothing in the system ever flips it
back**. The migration must reset it explicitly.

**Where the real dates were hiding.** Someone had already recorded the true expiry by typing it into
the free-text `deal_payments.label` field (editable at `src/features/deals/PaymentsPanel.tsx:108`).
26 of the 27 rows carry a `dd/mm/yyyy` string there. That gives an independent second source, and it
agreed with the spreadsheet on **20 of the 21 rows where both are unambiguous**.

**The six disagreements — and why five of them are an Excel bug, not a data conflict.** Exactly five
cells in the spreadsheet are stored as *numbers* (Excel serials) rather than text. All five decode
to the CRM label read **US-style (m/d/yyyy)** — 5 out of 5, exact:

| Serial | Sheet decodes to | CRM label | Label read m/d | Match | True dd/mm |
|---|---|---|---|---|---|
| 46907 | 2028-06-03 | `06/03/2028` | 2028-06-03 | ✅ | **2028-03-06** |
| 47001 | 2028-09-05 | `09/05/2028` | 2028-09-05 | ✅ | **2028-05-09** |
| 46574 | 2027-07-06 | `07/06/2027` | 2027-07-06 | ✅ | **2027-06-07** |
| 46699 | 2027-11-08 | `11/08/2027` | 2027-11-08 | ✅ | **2027-08-11** |
| 47062 | 2028-11-05 | `11/05/2028` | 2028-11-05 | ✅ | **2028-05-11** |

These five are precisely the rows where **both** day and month are ≤ 12 — the only case where Excel
can silently reinterpret a `dd/mm/yyyy` string as a date. Rows like `28/11/2027` (day 28 > 12) could
not be reparsed and stayed text, which is exactly why only these five became serials. Owner decision
2026-08-05: **the CRM label wins for these five.**

The sixth, `tasy.gr` (deal 000247), is a genuine content difference — sheet `15/07/2027` vs label
`27/07/2027`, both plain text, nothing misparsed. Owner decision 2026-08-05: **the spreadsheet wins**
(2027-07-15).

---

## The resolved mapping (authoritative — 27 rows)

`new due` is the value written to `deal_payments.start_date`; `new end` to `end_date`.
`src` records which source won.

| Deal | Domain | payment id | old due | **new due** | new end | src |
|---|---|---|---|---|---|---|
| 000041 | `allinmykonos.com` | `a8a611ec-b93e-4b41-9f32-f7963c16ddeb` | 2026-05-28 | **2027-05-28** | 2028-05-28 | sheet |
| 000054 | `bluesearestaurantafitos.com` | `8d41caad-0d4f-489f-b7e1-9a06ab23e8fe` | 2026-08-05 | **2026-09-03** | 2027-09-03 | sheet |
| 000079 | `navergo.gr` | `0df209c8-da86-4795-9f07-fb8b13a19f5e` | 2026-05-11 | **2028-06-05** | 2029-06-05 | sheet |
| 000090 | `dctrade.gr` | `b5b9c215-2d79-40cc-afd7-dbed82f501e3` | 2026-05-29 | **2027-11-28** | 2028-11-28 | sheet |
| 000114 | `authenticsantorinitours.com` | `a3cc1fbc-112e-42cd-a584-2b4c09aa6b61` | 2026-06-10 | **2027-03-09** | 2028-03-09 | sheet |
| 000136 | `themaedu.gr` | `7a55543a-861f-42db-8026-9de407dcedb2` | 2026-06-08 | **2028-03-14** | 2029-03-14 | sheet |
| 000178 | `eleftheriadisteletes.gr` | `22ba9ca5-442c-43a7-9412-a0abd4c415a6` | 2026-06-18 | **2028-03-17** | 2029-03-17 | sheet |
| 000205 | `resetgym.gr` | `611bc893-21b3-4b60-82ec-98c6cd8c219e` | 2026-06-05 | **2028-03-17** | 2029-03-17 | sheet |
| 000222 | `juniorcatering.gr` | `bb3a97cf-285d-45b4-8ddf-54877173e208` | 2026-06-17 | **2028-03-06** | 2029-03-06 | **label** |
| 000247 | `tasy.gr` | `b96ce006-dccd-4411-a715-22a0aa8c04d9` | 2026-06-10 | **2027-07-15** | 2028-07-15 | sheet |
| 000249 | `epikentroedu.gr` | `5837cd06-78a9-4e75-8f2f-52c6f51ea1c5` | 2026-04-30 | **2028-06-19** | 2029-06-19 | sheet |
| 000261 | `transfertoursthassos.com` | `5843f008-aac4-4d0b-b474-272de124ed69` | 2026-06-10 | **2027-07-10** | 2028-07-10 | sheet |
| 000270 | `rentaboatzakynthos.com` | `801b5305-dee9-426e-8f77-ff86e181785e` | 2026-05-22 | **2027-03-27** | 2028-03-27 | sheet |
| 000277 | `interoil.gr` | `f8cedeb0-2f4f-462a-88c4-328ae7732cb6` | 2026-06-12 | **2026-11-19** | 2027-11-19 | sheet |
| 000289 | `thronosyachtingserifos.gr` | `ecc8fe0b-67f4-490a-a8c2-30a31718b993` | 2026-05-13 | **2028-05-09** | 2029-05-09 | **label** |
| 000294 | `imperialsantorini.com` | `20534b79-c2c0-485e-8689-347cd2d0df66` | 2026-06-03 | **2027-05-21** | 2028-05-21 | sheet |
| 000298 | `funeralskostas.com` | `9b2cefe6-9d2d-47f0-8f18-c8385fbf8068` | 2026-05-06 | **2027-04-23** | 2028-04-23 | sheet |
| 000314 | `aegeansafran.com` | `ab76a3c2-fe42-47b4-86bc-7a54fe383baf` | 2026-05-18 | **2027-06-07** | 2028-06-07 | **label** |
| 000316 | `drkarakalpakis.gr` | `6e91fc7c-0fb7-49f0-826f-31ae632d7a92` | 2026-05-13 | **2027-08-11** | 2028-08-11 | **label** |
| 000338 | `tritonasmarinepatmos.gr` | `9edfce7c-970f-4fa0-87dd-149a3af99683` | 2026-05-21 | **2028-05-11** | 2029-05-11 | **label** |
| 000404 | `opawey.com` | `63c5b02a-b032-4bdb-8012-f3296812767e` | 2026-05-26 | **2029-03-29** | 2030-03-29 | sheet |
| 000406 | `emamonoseis.gr` | `fec3c44c-eeac-4966-8c46-c8699bb739b4` | 2026-06-17 | **2027-02-24** | 2028-02-24 | sheet |
| 000431 | `servistasathens.gr` | `537e8414-1896-4c27-9617-40c13476bcd0` | 2026-06-15 | **2027-11-04** | 2028-11-04 | sheet |
| 000447 | `transferincorfu.com` | `6707755a-0131-4c0c-b91e-2be167456f77` | 2026-06-17 | **2027-05-19** | 2028-05-19 | sheet |
| 000473 | `freedomwheels.gr` | `32f81a51-6f6b-40ea-9eae-2f1aa3bf9657` | 2026-05-29 | **2027-05-13** | 2028-05-13 | sheet |
| 000513 | `vassilisexarchos.com` | `3f54c93c-9a4b-4a78-9c31-c3c372c09ee4` | 2026-06-11 | **2027-06-08** | 2028-06-08 | sheet |
| 005042 | `mpfurs.com` | `d74be127-b1bd-4db5-9cd2-4414c4c38e8f` | 2026-07-03 | **2028-02-15** | 2029-02-15 | sheet |

**Out of scope — the 21 `Had Deal = no` domains** (recorded so a future reader knows they were
considered, not missed): `pawsly.gr`, `ourfarmoils.com`, `dncandles.gr`, `crazy-fireworks.gr`,
`lueurclothes.gr`, `mykonoscar-rental.com`, `gotruckhellas.gr`, `theatroathinonothespis.gr`,
`ebrandone.gr`, `panstelvillas.gr`, `aristavern.gr`, `andreasvapsimata.gr`, `apofraxeiszyfis.gr`,
`nasupremeservices.com`, `sfakianakiselectric.gr`, `transferspleasure.com`, `myluggagespotspata.com`,
`rentavanathens.com`, `garagecaferhodes.com`, `lptaxinheraklio.com`, `arginontasunset.com`.

---

## ⚠️ Corrected — this prediction did not happen (see "Applied to prod" below)

**This section originally predicted roughly 15 deals would leave `on_hold` when this migration
applied. That did not happen — 0 did — and the prediction was wrong, not the migration.**
`reconcile_deal_stage()` has never auto-lifted a hold since
`20260702150150_reconcile_deal_stage_respect_holds.sql` (lines 26-29): a deal already in `on_hold`
returns `false` immediately and only re-runs `block_deal_jobs()` — "never auto-lift a hold. Keep
jobs blocked; leave the column to the accountant." The `deal_payments_reconcile_stage` trigger does
fire `AFTER UPDATE` on every row this migration touches, and `deal_next_due()` does change, but the
guard above means `target_accounting_stage()` is never consulted for an already-`on_hold` deal, so
none of the 18 held deals moved. The one stage move in the whole migration was **000054**
(`awaiting_payment` → `paid_in_full`, a deal that was never on hold). See "Applied to prod" below
for the full before/after breakdown and the accountant hand-off in
`docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md`.

The **000289** (2026-06-30) genuinely-past-due claim below was also wrong — 000289 has no unpaid
non-`domains` row today; it is one of the 16 held deals that now owe nothing (see "Applied to prod"),
not one of the two genuinely held deals (000090, 000205).

Two deals did not move at all, for known reasons — this part of the prediction was correct:
- **000041** is in `partial_payment`, which `reconcile_deal_stage` does not allow-list — open
  finding **A2** in `docs/system-analysis/2026-08-04-accounting-full-audit.md`. Its dates still get
  corrected; only the stage move is suppressed. Expected, not a failure.
- **000298** is in `closed`. Same — dates corrected, no stage move.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md` | **Create.** The evidence record: source file, the 27↔27 match with its four context-based matches, the Excel-serial analysis, the two owner decisions, and the 21 skipped domains. The migration header points here instead of restating it. |
| `supabase/migrations/20260806100000_domain_expiry_renewal_dates.sql` | **Create.** Backup table + the single set-based `UPDATE` + inline post-condition assertion. |
| `supabase/tests/domains_renewal_due_dates.sql` | **Create.** pgTAP regression test for the invariant "an unpaid `domains` row is never due in the past and always spans exactly one year". |
| `docs/superpowers/plans/2026-08-05-domain-expiry-renewal-dates.md` | **Modify.** This file — Task 5 appends the applied-to-prod record. |

---

### Task 1: Freeze the reconciliation evidence

Nothing is changed in the database. This task exists so the *reasoning* is reviewable
independently of the SQL — a reviewer can reject the mapping without rejecting the migration.

**Files:**
- Create: `docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the authoritative 27-row mapping table (deal code → payment id → new due date → source),
  referenced by name from the migration header in Task 3.

- [ ] **Step 1: Write the reconciliation document**

Copy the following sections of *this plan* into the new file, verbatim, under a
`# Domain expiry reconciliation — 2026-08-05` heading:
1. the whole "Background — what discovery found" section,
2. the whole "The resolved mapping (authoritative — 27 rows)" section including the 21-domain
   out-of-scope list,
3. the "⚠️ Expected side effect" section.

Add a `## Source file` line at the top recording the exact input:
`~/Downloads/Domains_Expiry_List_Final.xlsx`, sheet 1, 48 data rows, read 2026-08-05.

- [ ] **Step 2: Verify the mapping is still a bijection before committing it**

Run against prod (this is a read-only check — it re-derives the count from live data rather than
trusting the table above):

```sql
select
  (select count(*) from public.jobs
    where service_type='domains' and not archived)                      as domains_jobs,
  (select count(*) from public.deal_payments
    where service_type='domains' and billing_type='recurring_yearly')   as domains_payment_rows,
  (select count(distinct deal_id) from public.deal_payments
    where service_type='domains')                                       as distinct_deals;
```

Expected: `27 | 27 | 27`. If any number differs, **stop** — a domains service was added or removed
since discovery and the mapping table must be re-derived before going further.

- [ ] **Step 3: Commit**

```bash
git add docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md
git commit -m "docs(domains): record the domain-expiry reconciliation and its two owner decisions"
```

---

### Task 2: Red — prove the defect with the verification query

The migration's correctness condition is "no unpaid `domains` row is due in the past". Write that
query **first** and watch it fail, so the green run in Task 3 means something.

**Files:**
- No files. This is a live read-only query; its output goes into the Task 3 commit message.

**Interfaces:**
- Consumes: nothing.
- Produces: `VERIFY_SQL` — the exact query text reused unchanged in Task 3 Step 5 and Task 5 Step 3.

- [ ] **Step 1: Run the verification query against prod**

```sql
-- VERIFY_SQL — must return zero rows once the migration has been applied.
select d.code as deal_code, dp.id, dp.start_date, dp.end_date, dp.status,
       case
         when dp.start_date <= current_date              then 'due in the past'
         when dp.end_date <> dp.start_date + interval '1 year' then 'period is not one year'
         when dp.status not in ('pending','paid')        then 'stale status'
       end as violation
  from public.deal_payments dp
  join public.deals d on d.id = dp.deal_id
 where dp.service_type = 'domains'
   and dp.status <> 'paid'
   and (dp.start_date <= current_date
        or dp.end_date <> dp.start_date + interval '1 year'
        or dp.status not in ('pending','paid'))
 order by d.code;
```

Expected **now**: **27 rows**. 26 report `due in the past` with `status = 'overdue'`; 000054 reports
`due in the past` with `status = 'pending'` (its `start_date` is 2026-08-05, i.e. today, and
`target_accounting_stage()` treats `next_due <= today` as `on_hold`).

- [ ] **Step 2: Record the count**

Save the row count. It is asserted as the "before" figure in the migration header (Task 3) and must
drop to 0 in Task 5. If it is not 27, re-derive the mapping before continuing.

---

### Task 3: The migration

**Files:**
- Create: `supabase/migrations/20260806100000_domain_expiry_renewal_dates.sql`

**Interfaces:**
- Consumes: the 27-row mapping from Task 1; `VERIFY_SQL` from Task 2.
- Produces: table `public.deal_payments_domain_expiry_backup_20260805(payment_id uuid, deal_code
  text, old_start_date date, old_end_date date, old_status text, old_label text, backed_up_at
  timestamptz)` — the rollback source, referenced by the ROLLBACK block in the header.

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================================
-- Domain expiry → renewal due dates. One-off data fix, 27 rows.
-- Evidence + full mapping: docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md
-- Plan:                    docs/superpowers/plans/2026-08-05-domain-expiry-renewal-dates.md
--
-- WHY: all 27 'domains' recurring_yearly rows were seeded with start_date = the
--   deal-creation date and end_date = +1 year. Neither has any relation to the
--   domain's registry expiry. Because deal_next_due() reads min(start_date) of
--   the unpaid rows, all 27 deals reported a past-due €20 they do not yet owe;
--   18 sat in on_hold, 15 of them for that reason alone.
--
-- WHAT: rewrite start_date (= the date the client must pay us again, per
--   deal_next_due/target_accounting_stage) to the real expiry, end_date to
--   expiry + 1 year, and reset the stale 'overdue' status. 26 of 27 rows are
--   'overdue' even though mark_overdue_payments() only flips rows whose
--   end_date is already past (20260610000004 §3) and every end_date here is in
--   2027 — the status was seeded/hand-set and nothing ever resets it, so this
--   migration must.
--
-- SOURCE OF TRUTH: Domains_Expiry_List_Final.xlsx (48 rows) for 22 of the 27;
--   deal_payments.label for 5 rows whose spreadsheet cells are Excel serials
--   decoding to the label misread US-style (5/5 exact — see the reconciliation
--   doc). The 21 'Had Deal = no' domains are out of scope.
--
-- NO FUNCTION BODIES ARE TOUCHED, so the usual md5(pg_get_functiondef) drift
--   check does not apply to this migration.
--
-- EXPECTED SIDE EFFECT: deal_payments_reconcile_stage fires AFTER UPDATE and
--   releases deals whose only past-due row was this one — ~15 deals leave
--   on_hold, their jobs unblock and SEO cards move to 'renewal'. That is the
--   intended correction. 000041 (partial_payment, open finding A2) and 000298
--   (closed) get corrected dates but no stage move.
--
-- ROLLBACK:
--   update public.deal_payments dp
--      set start_date = b.old_start_date,
--          end_date   = b.old_end_date,
--          status     = b.old_status,
--          label      = b.old_label
--     from public.deal_payments_domain_expiry_backup_20260805 b
--    where dp.id = b.payment_id;
--   drop table public.deal_payments_domain_expiry_backup_20260805;
--   (Stage moves triggered by the forward run do NOT roll back automatically;
--    re-running reconcile_deal_stage per deal restores them.)
-- =============================================================================

-- 1. Backup ------------------------------------------------------------------
create table if not exists public.deal_payments_domain_expiry_backup_20260805 (
  payment_id     uuid primary key,
  deal_code      text,
  old_start_date date,
  old_end_date   date,
  old_status     text,
  old_label      text,
  backed_up_at   timestamptz not null default now()
);

insert into public.deal_payments_domain_expiry_backup_20260805
  (payment_id, deal_code, old_start_date, old_end_date, old_status, old_label)
select dp.id, d.code, dp.start_date, dp.end_date, dp.status, dp.label
  from public.deal_payments dp
  join public.deals d on d.id = dp.deal_id
 where dp.service_type = 'domains'
on conflict (payment_id) do nothing;

-- 2. The re-dating -----------------------------------------------------------
-- start_date = registry expiry (the date the client must pay us again).
-- end_date   = expiry + 1 year (recurring_yearly period close).
-- status     : 'overdue' is stale once the due date is in the future.
-- label      : held the expiry as free text because start_date was wrong. Now
--              redundant and, on 6 rows, actively contradictory — rewritten to
--              match. Drop this one assignment if you want labels left alone.
with fix (payment_id, new_start, new_end) as (values
  ('a8a611ec-b93e-4b41-9f32-f7963c16ddeb'::uuid, date '2027-05-28', date '2028-05-28'),  -- 000041 allinmykonos.com
  ('8d41caad-0d4f-489f-b7e1-9a06ab23e8fe'::uuid, date '2026-09-03', date '2027-09-03'),  -- 000054 bluesearestaurantafitos.com
  ('0df209c8-da86-4795-9f07-fb8b13a19f5e'::uuid, date '2028-06-05', date '2029-06-05'),  -- 000079 navergo.gr
  ('b5b9c215-2d79-40cc-afd7-dbed82f501e3'::uuid, date '2027-11-28', date '2028-11-28'),  -- 000090 dctrade.gr
  ('a3cc1fbc-112e-42cd-a584-2b4c09aa6b61'::uuid, date '2027-03-09', date '2028-03-09'),  -- 000114 authenticsantorinitours.com
  ('7a55543a-861f-42db-8026-9de407dcedb2'::uuid, date '2028-03-14', date '2029-03-14'),  -- 000136 themaedu.gr
  ('22ba9ca5-442c-43a7-9412-a0abd4c415a6'::uuid, date '2028-03-17', date '2029-03-17'),  -- 000178 eleftheriadisteletes.gr
  ('611bc893-21b3-4b60-82ec-98c6cd8c219e'::uuid, date '2028-03-17', date '2029-03-17'),  -- 000205 resetgym.gr
  ('bb3a97cf-285d-45b4-8ddf-54877173e208'::uuid, date '2028-03-06', date '2029-03-06'),  -- 000222 juniorcatering.gr      [label]
  ('b96ce006-dccd-4411-a715-22a0aa8c04d9'::uuid, date '2027-07-15', date '2028-07-15'),  -- 000247 tasy.gr
  ('5837cd06-78a9-4e75-8f2f-52c6f51ea1c5'::uuid, date '2028-06-19', date '2029-06-19'),  -- 000249 epikentroedu.gr
  ('5843f008-aac4-4d0b-b474-272de124ed69'::uuid, date '2027-07-10', date '2028-07-10'),  -- 000261 transfertoursthassos.com
  ('801b5305-dee9-426e-8f77-ff86e181785e'::uuid, date '2027-03-27', date '2028-03-27'),  -- 000270 rentaboatzakynthos.com
  ('f8cedeb0-2f4f-462a-88c4-328ae7732cb6'::uuid, date '2026-11-19', date '2027-11-19'),  -- 000277 interoil.gr
  ('ecc8fe0b-67f4-490a-a8c2-30a31718b993'::uuid, date '2028-05-09', date '2029-05-09'),  -- 000289 thronosyachtingserifos.gr [label]
  ('20534b79-c2c0-485e-8689-347cd2d0df66'::uuid, date '2027-05-21', date '2028-05-21'),  -- 000294 imperialsantorini.com
  ('9b2cefe6-9d2d-47f0-8f18-c8385fbf8068'::uuid, date '2027-04-23', date '2028-04-23'),  -- 000298 funeralskostas.com
  ('ab76a3c2-fe42-47b4-86bc-7a54fe383baf'::uuid, date '2027-06-07', date '2028-06-07'),  -- 000314 aegeansafran.com        [label]
  ('6e91fc7c-0fb7-49f0-826f-31ae632d7a92'::uuid, date '2027-08-11', date '2028-08-11'),  -- 000316 drkarakalpakis.gr       [label]
  ('9edfce7c-970f-4fa0-87dd-149a3af99683'::uuid, date '2028-05-11', date '2029-05-11'),  -- 000338 tritonasmarinepatmos.gr [label]
  ('63c5b02a-b032-4bdb-8012-f3296812767e'::uuid, date '2029-03-29', date '2030-03-29'),  -- 000404 opawey.com
  ('fec3c44c-eeac-4966-8c46-c8699bb739b4'::uuid, date '2027-02-24', date '2028-02-24'),  -- 000406 emamonoseis.gr
  ('537e8414-1896-4c27-9617-40c13476bcd0'::uuid, date '2027-11-04', date '2028-11-04'),  -- 000431 servistasathens.gr
  ('6707755a-0131-4c0c-b91e-2be167456f77'::uuid, date '2027-05-19', date '2028-05-19'),  -- 000447 transferincorfu.com
  ('32f81a51-6f6b-40ea-9eae-2f1aa3bf9657'::uuid, date '2027-05-13', date '2028-05-13'),  -- 000473 freedomwheels.gr
  ('3f54c93c-9a4b-4a78-9c31-c3c372c09ee4'::uuid, date '2027-06-08', date '2028-06-08'),  -- 000513 vassilisexarchos.com
  ('d74be127-b1bd-4db5-9cd2-4414c4c38e8f'::uuid, date '2028-02-15', date '2029-02-15')   -- 005042 mpfurs.com
)
update public.deal_payments dp
   set start_date = f.new_start,
       end_date   = f.new_end,
       status     = case when dp.status = 'overdue' then 'pending' else dp.status end,
       label      = to_char(f.new_start, 'DD/MM/YYYY')
  from fix f
 where dp.id = f.payment_id
   and dp.status <> 'paid';   -- never rewrite a settled period

-- 3. Post-conditions (abort the whole file if either fails) ------------------
do $$
declare n int;
begin
  select count(*) into n
    from public.deal_payments_domain_expiry_backup_20260805;
  if n <> 27 then
    raise exception 'expected 27 backed-up domains rows, found %', n;
  end if;

  select count(*) into n
    from public.deal_payments dp
   where dp.service_type = 'domains'
     and dp.status <> 'paid'
     and (dp.start_date <= current_date
          or dp.end_date <> dp.start_date + interval '1 year'
          or dp.status not in ('pending','paid'));
  if n <> 0 then
    raise exception 'domains rows still violating the due-date invariant: %', n;
  end if;
end $$;
```

- [ ] **Step 2: Check the file parses and the dates are internally consistent**

Before touching prod, verify every `new_end` is exactly one year after its `new_start` and that
there are 27 distinct payment ids:

```bash
python3 - <<'PY'
import re, datetime
src = open('supabase/migrations/20260806100000_domain_expiry_renewal_dates.sql').read()
rows = re.findall(r"\('([0-9a-f-]{36})'::uuid, date '(\d{4}-\d\d-\d\d)', date '(\d{4}-\d\d-\d\d)'\)", src)
print('rows:', len(rows), '| distinct ids:', len({r[0] for r in rows}))
for pid, s, e in rows:
    d = datetime.date.fromisoformat(s)
    if datetime.date.fromisoformat(e) != d.replace(year=d.year + 1):
        print('MISMATCH:', pid, s, e)
PY
```

Expected: `rows: 27 | distinct ids: 27` and no `MISMATCH` lines.

- [ ] **Step 3: Commit the migration before applying it**

Committing first means the repo records the intent even if the apply fails halfway.

```bash
git add supabase/migrations/20260806100000_domain_expiry_renewal_dates.sql
git commit -m "fix(billing): re-date the 27 domain renewal rows to their real registry expiry

Seeded start_date was the deal-creation date, so deal_next_due() reported a
past-due €20 on all 27 domains services and held 15 deals in on_hold for no
real debt. VERIFY_SQL returned 27 violating rows before this change."
```

---

### Task 4: pgTAP regression test for the invariant

The migration is one-off, but the *invariant* is permanent: a domains renewal must never be due in
the past while unpaid, and its period must be exactly one year. Encode it so a future seeder bug is
caught by the suite instead of by a client complaint.

**Files:**
- Create: `supabase/tests/domains_renewal_due_dates.sql`

**Interfaces:**
- Consumes: nothing (reads live rows).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Follow the repo's pgTAP shape — `begin; select plan(n); … select * from finish(); rollback;`
(see `supabase/tests/web_seo_owner_web_only.sql`).

```sql
-- supabase/tests/domains_renewal_due_dates.sql
-- A domains renewal is billed once a year, in advance of the registry expiry.
-- An unpaid row due in the past means the client is being chased for a renewal
-- that has not come round yet (see 20260806100000_domain_expiry_renewal_dates).
begin;
select plan(3);

select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains' and status <> 'paid' and start_date <= current_date),
  0,
  'no unpaid domains renewal is due today or earlier');

select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains'
      and (end_date is null or end_date <> start_date + interval '1 year')),
  0,
  'every domains period spans exactly one year');

-- Guard the discriminating case: a row re-dated into the future must not keep
-- the 'overdue' status, because nothing in the system ever clears it
-- (mark_overdue_payments only sets it, and only when end_date is already past).
select is(
  (select count(*)::int from public.deal_payments
    where service_type = 'domains' and status = 'overdue' and end_date > current_date),
  0,
  'no domains row is marked overdue while its period is still open');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test against prod and watch it FAIL**

Post the file as a single query (it is wrapped in `begin … rollback`, so it cannot leave anything
behind). Expected **before** the migration is applied: **1 of 3 passing**.

| Assertion | Actual now | Expected | Result |
|---|---|---|---|
| 1 — none due in the past | 27 | 0 | **FAIL** |
| 2 — period spans one year | 0 | 0 | pass |
| 3 — no open row marked overdue | 26 | 0 | **FAIL** |

Assertion 2 passes today because the seeder did get the one-year span right; it is there to stop a
future regression, not to fail now. If assertion 1 reports anything other than 27, stop and
re-derive the mapping.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/domains_renewal_due_dates.sql
git commit -m "test(domains): assert unpaid domain renewals are never due in the past"
```

---

### Task 5: Apply to prod and verify

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-domain-expiry-renewal-dates.md` (this file — append the
  applied record at the bottom)

**Interfaces:**
- Consumes: the migration from Task 3, `VERIFY_SQL` from Task 2, the test from Task 4.
- Produces: the applied-to-prod record.

- [ ] **Step 1: Get explicit go-ahead**

This writes to production and will visibly move ~15 deals out of `on_hold`, unblocking their jobs
and moving SEO cards into the `renewal` lane. Confirm with the owner before posting. Do not batch
this with any other pending migration.

- [ ] **Step 2: Apply the migration as a single query**

POST the entire file contents as one `query` to the Management API. Postgres runs it in one implicit
transaction, so the `do $$ … raise exception … $$` post-conditions in section 3 roll the whole thing
back if anything is off.

Expected: HTTP 201 and no exception. If you get
`expected 27 backed-up domains rows, found N` or `domains rows still violating …`, nothing was
written — re-derive the mapping and start again.

- [ ] **Step 3: Green — re-run VERIFY_SQL**

Run the exact query from Task 2 Step 1 again.

Expected: **zero rows** (was 27).

- [ ] **Step 4: Re-run the pgTAP test**

Expected: **3 of 3 passing** (was 1 of 3).

- [ ] **Step 5: Spot-check the six contested rows**

These are the ones where the spreadsheet and the CRM label disagreed, so they deserve eyes on the
actual stored values rather than a count:

```sql
select d.code, dp.start_date, dp.end_date, dp.status, dp.label
  from public.deal_payments dp
  join public.deals d on d.id = dp.deal_id
 where dp.id in (
   'bb3a97cf-285d-45b4-8ddf-54877173e208',  -- 000222 juniorcatering.gr   -> 2028-03-06
   'ecc8fe0b-67f4-490a-a8c2-30a31718b993',  -- 000289 thronosyachting…    -> 2028-05-09
   'ab76a3c2-fe42-47b4-86bc-7a54fe383baf',  -- 000314 aegeansafran.com    -> 2027-06-07
   '6e91fc7c-0fb7-49f0-826f-31ae632d7a92',  -- 000316 drkarakalpakis.gr   -> 2027-08-11
   '9edfce7c-970f-4fa0-87dd-149a3af99683',  -- 000338 tritonasmarine…     -> 2028-05-11
   'b96ce006-dccd-4411-a715-22a0aa8c04d9')  -- 000247 tasy.gr             -> 2027-07-15
 order by d.code;
```

Expected: the six `start_date` values in the comments, all `status = 'pending'`, and `label`
matching `start_date` in `DD/MM/YYYY`.

- [ ] **Step 6: Append the applied record to this plan and commit**

Add at the bottom of this file:

```markdown
## Applied to prod

- **2026-08-05** — `20260806100000_domain_expiry_renewal_dates.sql`, HTTP 201.
  27 rows re-dated, 26 `overdue` → `pending`, 27 rows backed up in
  `deal_payments_domain_expiry_backup_20260805`.
  VERIFY_SQL 27 rows → 0. pgTAP `domains_renewal_due_dates` 1/3 → 3/3.
  Deals released from on_hold: <fill in from Task 6 Step 1>.
```

```bash
git add docs/superpowers/plans/2026-08-05-domain-expiry-renewal-dates.md
git commit -m "chore(migration): record the domain re-dating as applied and verified on prod"
```

---

### Task 6: Confirm the downstream effects landed correctly

The migration's real-world success is measured on the deals, not the payment rows. Verify the stage
moves actually happened and nothing was left half-released.

**Files:**
- Modify: `docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md` (append the outcome)

**Interfaces:**
- Consumes: nothing.
- Produces: the released-deal list quoted in Task 5 Step 6.

- [ ] **Step 1: List the current stage of all 27 deals**

```sql
select d.code,
       ps.code                        as acct_stage,
       public.deal_next_due(d.id)     as next_due,
       (select count(*) from public.jobs j
         where j.deal_id = d.id and not j.archived and j.is_blocked) as blocked_jobs
  from public.deals d
  left join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where d.id in (select deal_id from public.jobs
                 where service_type = 'domains' and not archived)
 order by ps.code, d.code;
```

Expected: no deal remains in `on_hold` **except** 000090, 000205 and 000289, each of which has a
genuinely past-due non-`domains` payment. 000041 stays `partial_payment` (finding A2) and 000298
stays `closed`; both are expected and are not regressions from this change.

Any *other* deal still in `on_hold` means its release failed — investigate before closing out.

- [ ] **Step 2: Confirm no job is still blocked without a past-due reason**

```sql
select d.code, j.code as job_code, j.service_type, j.blocked_reason,
       public.deal_next_due(d.id) as next_due
  from public.jobs j
  join public.deals d on d.id = j.deal_id
 where j.is_blocked and not j.archived
   and d.id in (select deal_id from public.jobs
                 where service_type = 'domains' and not archived)
   and coalesce(public.deal_next_due(d.id), current_date + 1) > current_date
 order by d.code;
```

Expected: **zero rows.** A row here is a job left blocked although its deal owes nothing today —
release it with the normal accounting flow and note it.

- [ ] **Step 3: Confirm the renewal generator will not fire early**

`ensure_recurring_payments()` creates the next period when `end_date <= current_date + 7 days`.
Every corrected `end_date` is at least a year out, so nothing should be queued:

```sql
select count(*) as would_generate
  from public.deal_payments dp
 where dp.service_type = 'domains'
   and dp.end_date <= current_date + interval '7 days';
```

Expected: `0`.

- [ ] **Step 4: Append the outcome and commit**

Record in the reconciliation doc: which deals left `on_hold`, which stayed and why, and the results
of steps 2 and 3.

```bash
git add docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md
git commit -m "docs(domains): record the post-apply stage releases and blocked-job sweep"
```

---

## Out of scope (deliberately)

- **The 21 `Had Deal = no` domains.** Listed above so a reader knows they were considered.
- **Filling `jobs.details->>'domain'`.** All 27 domains jobs have `details = {}`, which is why the
  match had to run through `clients.website`. Populating it would make every future reconciliation
  trivial, but it is a separate change with its own review.
- **The €20 / 24% VAT question.** Two of the 27 rows (000222, 000406) carry `vat_rate = 0.00` while
  the other 25 carry 24%. That is the shape of open finding **A0** (cash/no-VAT deals charged VAT)
  in `docs/system-analysis/2026-08-04-accounting-full-audit.md` and is not touched here.
- **Finding A2** (`partial_payment` has no automatic exit), which is why 000041 will not change
  stage. Tracked in the accounting-fixes plan.

---

## Applied to prod

- **2026-08-05** — `20260806100000_domain_expiry_renewal_dates.sql`, HTTP 201, posted as a single
  Management API query (one implicit transaction). No exception raised.
  27 rows re-dated, 26 `overdue` → `pending`, 27 rows backed up in
  `deal_payments_domain_expiry_backup_20260805`.
  VERIFY_SQL 27 rows → 0. pgTAP `domains_renewal_due_dates` could not run (pgtap is available but
  not installed on this project — `function plan(integer) does not exist`); its three assertions were
  run as bare counts instead and went 27 / 0 / 26 → **0 / 0 / 0**.
  Six contested rows spot-checked: all six `start_date` values match the mapping, all `status =
  'pending'`, all `label` = `start_date` in `DD/MM/YYYY` (000247 corrected `27/07/2027` → `15/07/2027`).
  The out-of-scope 28th row (deal 002154, `status='paid'`) was untouched, as designed.

  **Deals released from `on_hold`: none — 18 before, 18 after.** The plan's "~15 deals leave
  `on_hold`" side effect did **not** occur, and the migration is not at fault. Since
  `20260702150150_reconcile_deal_stage_respect_holds`, `reconcile_deal_stage()` returns early for any
  deal already in `on_hold` ("never auto-lift a hold … leave the column to the accountant") and
  re-runs `block_deal_jobs()`. The trigger fired on all 27 updates; it simply cannot move a held deal.
  The one stage move was **000054**, `awaiting_payment` → `paid_in_full` (its due date moved from
  today to 2026-09-03).

  Stage distribution across the 28 live `domains` deals, before → after:

  | accounting stage | before | after |
  |---|---|---|
  | `on_hold` | 18 | 18 |
  | `done` | 6 | 6 |
  | `partial_payment` | 2 (000041, 002154) | 2 (000041, 002154) |
  | `awaiting_payment` | 1 (000054) | 0 |
  | `closed` | 1 (000298) | 1 (000298) |
  | `paid_in_full` | 0 | 1 (000054) |

  (The plan's earlier "done 7 / partial_payment 1" reference was off by one: the out-of-scope 28th
  deal 002154 sits in `partial_payment`, not `done`. Totals match at 28 either way.)

  **Follow-up now owed to the accountant.** 16 of the 18 held deals no longer have any past-due row
  and are eligible for a manual stage move; their jobs stay blocked until someone makes it:

  - would compute to `paid_in_full` (13): 000136, 000178, 000247, 000249, 000261, 000270, 000289,
    000294, 000314, 000404, 000406, 000473, 005042
  - would compute to `awaiting_payment` (3): 000114 (due 2026-08-10), 000277 (2026-08-12),
    000431 (2026-08-10)
  - legitimately still `on_hold` (2): **000090** (three unpaid `web_seo`/`social_media` rows past due
    from 2026-05-29) and **000205** (unpaid row due 2026-06-05) — unrelated to domains.

  This is Task 6's work, not a defect in this migration.
