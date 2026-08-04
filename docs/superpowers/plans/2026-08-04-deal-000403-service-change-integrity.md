# Deal 000403 Service-Change Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore deal 000403's SEO service to a correct, billable, board-visible state, and close the two systemic gaps that let a hand-made service change silently kill billing for two months.

**Architecture:** Three layers, in order. (1) A one-off, backed-up data repair of 000403 in prod. (2) `convert_job_service_type` gains the missing step — re-keying the deal's billing rows to the new service — so the supported path can never orphan billing again. (3) A new `accounting_integrity_alerts` check that makes "live service card, dead billing" visible the same day instead of after two unbilled months.

**Tech Stack:** Postgres 17 / Supabase (`public` schema, SECURITY DEFINER RPCs, pgTAP tests under `supabase/tests/`), React + TanStack Query frontend, i18n `en`/`el`.

## Global Constraints

- **This machine has no node/npm, no supabase CLI, no psql, and no `node_modules`.** SQL reaches prod only through the Management API: `POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query` with `{"query": "..."}` and a `sbp_…` bearer token, sent **with curl** (python `urllib` gets `403 error code: 1010` from Cloudflare). A whole migration file posted as one `query` runs in a single implicit transaction — any error rolls the file back.
- **`auth.uid()` is NULL over that API**, so permission-gated RPCs (`current_user_is_admin()`, `current_user_can(...)`) refuse. One-off fixes run the equivalent SQL directly.
- **Drift-check before editing any function:** read `md5(pg_get_functiondef(oid))` live and compare with the last repo emission; record pre/post md5 in the migration header. Repo emissions were verified clean on 2026-08-04.
- **Every migration carries a `ROLLBACK:` comment block.** Migration filenames are `YYYYMMDDHHMMSS_snake_name.sql`; the latest applied is `20260804091000`.
- **Never re-introduce a date heuristic to decide "same cycle or next?"** — that rule is now `jobs.renewed_for_period` (see `20260804090000` and `docs/tech/accounting/renewal-close.md`).
- **`activity_log.action` is CHECK-limited to `insert`/`update`/`delete`**; the semantic name goes in `changes->>'kind'`.
- Money columns are `numeric(12,2)`; VAT on this deal is 24%.

## Verified starting state (read live 2026-08-04, do not re-derive)

Deal `000403` — ΥΔΡΑΙΟΣ ΙΩΑΝΝΗΣ ΕΜΜΑΝΟΥΗΛ, accounting stage `paid_in_full`, `payment_method='online'`, `one_time_value=400.00`, `recurring_monthly_value=0.00`, `services_planned=[{service_type: web_seo, billing_type: recurring_monthly, monthly_amount: 0, one_time_amount: 0, setup_fee: 0}]`.

| job | service | billing | amount_net | billing_active | status | stage | period_start | onboarded |
|---|---|---|---|---|---|---|---|---|
| `000403-WEBDEV` | web_dev | one_time | 400.00 | true | active | web_dev/`live` | 2026-05-08 | — |
| `000403-LOCALSEO` | local_seo | recurring_monthly | 250.00 | **false** | completed | local_seo/`closed` | 2026-05-08 | 2026-06-22 |
| `000403-WEBSEO` | web_seo | recurring_monthly | 250.00 | **false** | completed | web_seo/`stuck` | **NULL** | 2026-06-22 |

Payments (`deal_payments`), both `paid`, **no successor rows exist**:

| id | service | billing | net | period | line → job |
|---|---|---|---|---|---|
| `1545cd84-eb21-47be-b606-9ecd13ddb7b0` | web_dev | one_time | 400.00 | 2026-05-08 → 2026-05-08 | `000403-WEBDEV` |
| `17204d4c-6b13-4fdc-9dd4-fb2ede3252cc` | **local_seo** | recurring_monthly | 250.00 | 2026-05-08 → 2026-06-08 | `000403-LOCALSEO` |

Both SEO payment rows have `invoice_number IS NULL` — **no issued invoice contradicts a re-key.**

What actually happened (from `activity_log`): both SEO jobs were **inserted 38 seconds apart at onboarding** on 2026-06-22 (`10:37:24` local, `10:38:02` web). There is **no `service_type_converted` entry** — `convert_job_service_type` was never used. Someone edited `services_planned` to `web_seo` by hand, closed the local card (its note reads `δεν ειναι λοκαλ`), and left the web card. Nothing moved the billing: the paid period is still keyed `local_seo`, both SEO jobs ended up `billing_active=false`, and `ensure_recurring_payments()` only extends periods that have a `billing_active` job of the same `service_type` + `billing_type` — so no period has been generated since **2026-06-08**. At €250/month that is ~2 months unbilled and counting, invisible to the `billing_gap` alert (which requires a `billing_active` recurring job to exist) and to the recurring-clients view (`0` billing_active recurring jobs on this deal).

## File Structure

- `supabase/migrations/20260805090000_convert_job_service_type_billing.sql` — re-emit `convert_job_service_type` with the billing re-key step. One responsibility: the supported convert path.
- `supabase/migrations/20260805091000_service_card_not_billing_alert.sql` — re-emit `accounting_integrity_alerts` with check 24. One responsibility: visibility.
- `supabase/tests/convert_job_service_type_billing.sql` — pgTAP cover for the re-key.
- `docs/data-fixes/2026-08-04-deal-000403-service-change.md` — what was wrong on 000403, the SQL applied, the verification output.
- `docs/tech/technical/service-boards.md` — add the "changing a service on a live deal" runbook section.

---

### Task 1: Repair deal 000403 in prod

No code ships in this task. It is a gated, backed-up data fix, and it is the task that answers "does 000403 work 100% correctly".

**Files:**
- Create: `docs/data-fixes/2026-08-04-deal-000403-service-change.md` (written in Task 4 — this task produces the evidence it records)
- Modify: prod rows only

**Interfaces:**
- Consumes: nothing.
- Produces: a repaired 000403 whose web_seo job owns the billing — Task 3's alert must return **zero** rows for this deal afterwards.

- [ ] **Step 1: Get owner sign-off on the two irreversible-in-spirit decisions**

Ask the owner, in these words, and record the answers in the data-fix doc:

1. *"The €250 period 08/05→08/06 was billed as Local SEO but the service delivered is Web SEO, and no invoice number was ever issued for it. Re-key that paid row to `web_seo` so the SEO history is continuous?"* — Recommended: **yes**. The alternative (leave it on the closed local card) means the web card starts with no billing history and the May period stays attached to a dead service.
2. *"Re-activating billing generates the missing periods 08/06→08/07 and 08/07→08/08 as **unpaid and already past due** (~€500 + VAT). The deal will drop out of Paid In Full, and `daily_payment_reminders` (06:00 UTC cron) may email the client about them. Proceed, or create them only after accounting has contacted the client?"*

Do not continue until both are answered.

- [ ] **Step 2: Snapshot every row this fix touches**

Run:

```sql
create table if not exists public.deal_000403_service_change_backup_20260804 as
select 'deal'::text as kind, to_jsonb(d) as row_data
  from public.deals d where d.code = '000403'
union all
select 'job', to_jsonb(j) from public.jobs j
 where j.deal_id = (select id from public.deals where code = '000403')
union all
select 'payment', to_jsonb(p) from public.deal_payments p
 where p.deal_id = (select id from public.deals where code = '000403')
union all
select 'line', to_jsonb(l) from public.deal_payment_lines l
 where l.payment_id in (select id from public.deal_payments
                         where deal_id = (select id from public.deals where code = '000403'));

select kind, count(*) from public.deal_000403_service_change_backup_20260804 group by kind order by 1;
```

Expected: `deal 1`, `job 3`, `line 2`, `payment 2`. If any count differs, stop — the starting state above no longer holds and this plan must be re-derived.

- [ ] **Step 3: Re-key the paid SEO period and its line to the web_seo job**

Run:

```sql
update public.deal_payments
   set service_type = 'web_seo'
 where id = '17204d4c-6b13-4fdc-9dd4-fb2ede3252cc'
   and service_type = 'local_seo'
   and invoice_number is null;

update public.deal_payment_lines
   set job_id = (select id from public.jobs where code = '000403-WEBSEO')
 where payment_id = '17204d4c-6b13-4fdc-9dd4-fb2ede3252cc';
```

- [ ] **Step 4: Make the web_seo job the live billing owner**

Run:

```sql
update public.jobs
   set billing_active = true,
       status = 'active'
 where code = '000403-WEBSEO';
```

Leave `monthly_amount` at `0.00` — `amount_net = 250.00` is the column every alert, the recurring generator and `jobAmount.ts` read; writing both risks double-counting.

- [ ] **Step 5: Verify the deal header picked up the value**

`jobs_sync_deal_pricing` may have synced it already. Run:

```sql
select recurring_monthly_value, one_time_value, services_planned
  from public.deals where code = '000403';
```

If `recurring_monthly_value` is still `0.00`, run:

```sql
update public.deals
   set recurring_monthly_value = 250.00,
       services_planned = jsonb_build_array(jsonb_build_object(
         'service_type','web_seo','billing_type','recurring_monthly',
         'monthly_amount',250,'one_time_amount',0,'setup_fee',0))
 where code = '000403';
```

Expected end state either way: `recurring_monthly_value = 250.00`, `services_planned` carries `monthly_amount: 250`.

- [ ] **Step 6: Recompute period dates and confirm the ledger will not surprise anyone**

Run:

```sql
select public.recompute_deal_job_period_dates((select id from public.deals where code = '000403'));

select j.code, s.code as stage, j.period_start_date, j.period_due_date,
       j.renewed_for_period, j.billing_active, j.status
  from public.jobs j
  left join public.pipeline_stages s on s.id = j.stage_id
 where j.deal_id = (select id from public.deals where code = '000403')
 order by j.code;
```

Expected: `000403-WEBSEO` now has `period_start_date = 2026-05-08`, `period_due_date = 2026-06-08`; `000403-LOCALSEO` has both **NULL** (its payment moved away). The card does **not** jump to Renewal — `seo_sync_renewal_job`'s first-cycle floor is `onboarded_at + 14d = 2026-07-06`, and `2026-05-08` is earlier. It will move to Renewal by itself the moment a period starting after 2026-07-06 is marked paid, which is the correct behaviour.

- [ ] **Step 7: Generate the missing periods (only if Step 1 answer 2 was "proceed")**

`ensure_recurring_payments()` creates **one** successor period per call. Run it and read the returned count:

```sql
select public.ensure_recurring_payments();
```

Repeat until it returns `0` **or** until a period covers today, checking after each call:

```sql
select service_type, billing_type, status, start_date, end_date, amount_net
  from public.deal_payments
 where deal_id = (select id from public.deals where code = '000403')
 order by start_date;
```

Expected after the catch-up: `web_seo` rows `2026-06-08→2026-07-08` and `2026-07-08→2026-08-08` (both `pending`), plus `2026-08-08→2026-09-08` once the 7-day look-ahead window opens. Each carries `amount_net = 250.00`, `vat_rate = 24`, and a `deal_payment_lines` row pointing at `000403-WEBSEO`.

If a call returns `0` before any period is created, the guard that failed is `exists (job with same service_type + billing_type and billing_active)` — re-check Step 4 landed.

- [ ] **Step 8: Verify the web SEO board side**

Run:

```sql
select j.code, s.board, s.code as stage, s.is_terminal, j.status, j.owner_user_id is not null as has_owner,
       g.code as assigned_group
  from public.jobs j
  join public.pipeline_stages s on s.id = j.stage_id
  left join public.groups g on g.id = j.assigned_group_id
 where j.code = '000403-WEBSEO';
```

Expected: `board = web_seo`, `is_terminal = false`, `status = active`, `has_owner = true` (Efstathiadis Pavlos), `assigned_group = web_seo`. The lane is `stuck`; that is the team's call, not this fix's — but flag it to the Web SEO lead, because a card parked in `stuck` with live billing is work nobody is doing.

- [ ] **Step 9: Confirm the deal's accounting stage settled where expected**

Run:

```sql
select ps.code as accounting_stage, public.deal_next_due(d.id) as next_due
  from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where d.code = '000403';
```

If Step 7 ran, the deal now has past-due unpaid rows, so `reconcile_block_lifecycle` (02:20 UTC) or `mark-overdue-payments` (02:15 UTC) will move it off `paid_in_full` to `awaiting_payment`/`on_hold` on the next run. That is correct — the client genuinely owes those periods. Record the expected transition in the data-fix doc so nobody "fixes" it back.

- [ ] **Step 10: Commit the evidence**

No repo files changed yet; this step just records the run. Paste every query's output into the scratch notes that Task 4 turns into the data-fix doc.

---

### Task 2: `convert_job_service_type` re-keys the deal's billing

**Files:**
- Create: `supabase/migrations/20260805090000_convert_job_service_type_billing.sql`
- Create: `supabase/tests/convert_job_service_type_billing.sql`
- Reference (do not edit): `supabase/migrations/20260803170000_ai_seo_conversion.sql` — **this**, not `20260803160000`, is the newest emission of `convert_job_service_type`; it added the AI-SEO trio branch. Copying the older body would silently revert that feature.
- Base to copy verbatim: `.superpowers/sdd/2026-08-04-deal-000403-service-change-integrity/live-convert_job_service_type.sql` — the live body read from prod on 2026-08-04, md5 `7b1f8f534b6bc7622a2181cc3984e5fe`.

**Interfaces:**
- Consumes: `public.convert_job_service_type(p_job_id uuid, p_target text) returns public.jobs` — existing signature, unchanged.
- Produces: after a convert, every `deal_payments` row that billed the job's **old** service on that deal now carries the **new** `service_type`, so `recompute_job_period_dates` (which matches on `service_type` **and** `billing_type`) keeps finding it.

- [ ] **Step 1: Drift-check — already done by the controller, do not repeat**

The controller read the live body on 2026-08-04 (md5 `7b1f8f534b6bc7622a2181cc3984e5fe`, 9846 chars) and saved it to `.superpowers/sdd/2026-08-04-deal-000403-service-change-integrity/live-convert_job_service_type.sql`. It matches the `20260803170000_ai_seo_conversion.sql` emission in shape, including the AI-SEO trio branch and the `grpA`/`grpB` arrays.

**That saved file is the base you copy verbatim.** You have no database access; do not attempt to read the function from prod.

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/convert_job_service_type_billing.sql`:

```sql
-- supabase/tests/convert_job_service_type_billing.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(3);

do $$
declare
  v_deal uuid; v_client uuid; v_job uuid; v_pay uuid; v_stage uuid;
begin
  select id, client_id into v_deal, v_client from public.deals where code is not null limit 1;
  delete from public.jobs where deal_id = v_deal and service_type in ('local_seo','web_seo');
  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'done' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', false, now(),
            (select code from public.deals where id = v_deal)||'-CONV', true)
    returning id into v_job;

  insert into public.deal_payments (deal_id, service_type, billing_type, amount_net, vat_rate,
                                    status, start_date, end_date)
    values (v_deal, 'local_seo', 'recurring_monthly', 250, 24,
            'paid', current_date - 30, current_date)
    returning id into v_pay;
  insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
    values (v_pay, v_job, 'Local SEO', 250, 24);

  perform set_config('t.job', v_job::text, true);
  perform set_config('t.pay', v_pay::text, true);
  perform public.convert_job_service_type(v_job, 'web_seo');
end $$;

select is((select service_type from public.jobs where id = current_setting('t.job')::uuid),
          'web_seo', 'job carries the new service');
select is((select service_type from public.deal_payments where id = current_setting('t.pay')::uuid),
          'web_seo', 'the payment that billed this job follows the convert');
select isnt((select period_start_date from public.jobs where id = current_setting('t.job')::uuid),
            null, 'the converted job still resolves a billing period');

rollback;
```

- [ ] **Step 3: Record why the test cannot be run here**

`supabase test db --file supabase/tests/convert_job_service_type_billing.sql` is the command that runs it. **This environment has no supabase CLI, no node, and no database access**, so you cannot execute it — do not fake a result or claim a run that did not happen. Write in your report: the command, that it was not run, and why. The controller verifies the migration against prod inside a rolled-back transaction after your work lands.

Expected behaviour once someone can run it: against the **current** function, assertions 2 and 3 FAIL — the payment stays `local_seo` and the job's period goes NULL, which is exactly the 000403 defect. Against your migrated function, 3/3 PASS.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260805090000_convert_job_service_type_billing.sql`. Copy the live body from the saved file named in Step 1 verbatim — **including the AI-SEO trio branch** — and insert this block immediately after the existing `-- 2) service_type + 3) stage remap` update (which sets `jobs.service_type = p_target`) **in the standalone-convert path only**, keeping every other line byte-identical:

```sql
  -- 2b) Billing follows the service (2026-08-05). recompute_job_period_dates
  --     matches a payment to a job on service_type AND billing_type, so a convert
  --     that leaves deal_payments on the OLD service strands the job with no
  --     period for ever — no renewal, no due chip, no reminder (deal 000403,
  --     two unbilled months). Re-key (a) every row line-linked to this job and
  --     (b) rows still keyed to the old service on this deal, but only while no
  --     OTHER live job of the old service is left to own them.
  update public.deal_payments p
     set service_type = p_target
   where p.deal_id = j.deal_id
     and p.billing_type = j.billing_type
     and (
       exists (select 1 from public.deal_payment_lines l
                where l.payment_id = p.id and l.job_id = p_job_id)
       or (
         p.service_type = j.service_type
         and not exists (select 1 from public.jobs j2
                          where j2.deal_id = j.deal_id and j2.id <> p_job_id
                            and not j2.archived and j2.service_type = j.service_type)
       )
     );
```

`j` is the record the function already loads at the top and never refreshes until the final `select … into j`, so it holds the **old** `service_type`/`billing_type`/`deal_id` throughout; `p_target` is the new service.

Two more edits are required for this to actually work:

**(a)** Add `v_rekeyed int;` to the function's `declare` block and capture the real count right after the update above:

```sql
  get diagnostics v_rekeyed = row_count;
```

Then extend the existing `activity_log` insert's `changes` object with `'payments_rekeyed', v_rekeyed`.

**(b)** Recompute the period dates before returning — **without this the test's third assertion still fails.** `deal_payments_recompute_job_dates_trg` only reacts to a `status` change or to dates moving on a `paid` row; re-keying `service_type` alone fires nothing, so the job would keep NULL period dates until some unrelated write happened to trigger a recompute. Add this immediately before the closing `select * into j from public.jobs where id = p_job_id;`:

```sql
  -- The re-key changed which payment matches this job; nothing else recomputes
  -- on a service_type-only update.
  perform public.recompute_deal_job_period_dates(j.deal_id);
```

Head the file with purpose, the pre-change md5 `7b1f8f534b6bc7622a2181cc3984e5fe`, and a `ROLLBACK:` block that re-applies the `20260803170000_ai_seo_conversion.sql` body.

- [ ] **Step 5: Self-check the migration by reading it**

You cannot execute SQL here. Instead, re-read your migration end to end and confirm: the AI-SEO branch survived intact; `v_rekeyed` is declared; the `get diagnostics` line follows the new update; `perform public.recompute_deal_job_period_dates(j.deal_id);` sits before the final `select * into j`; the header carries the pre-change md5 and a ROLLBACK block. State each check's result in your report.

- [ ] **Step 6: Leave prod application to the controller**

Do **not** apply anything to prod — you have no credentials and must not ask for them. The controller applies the migration and records the post-change md5 in the header.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805090000_convert_job_service_type_billing.sql \
        supabase/tests/convert_job_service_type_billing.sql
git commit -m "fix(convert): re-key deal payments to the new service on job convert"
```

---

### Task 3: `service_card_not_billing` integrity alert

**Files:**
- Create: `supabase/migrations/20260805091000_service_card_not_billing_alert.sql`
- Reference (copy the base body from): `supabase/migrations/20260804091000_renewal_integrity_alerts.sql`

**Interfaces:**
- Consumes: `public.accounting_integrity_alerts()` — the 23-check body applied on 2026-08-04, live md5 `d5a886e95dfeb92673258d035cd6a818`.
- Produces: check 24 `service_card_not_billing`, same output columns as every other check (`check_key, severity, category, subject_type, subject_id, subject_code, title, detail, deal_id, job_id, signature`), surfaced by the existing accounting Alerts panel with no frontend change.

- [ ] **Step 1: Read the measurement the controller already took — do not re-measure**

You have no database access. The controller ran the tuning on prod on 2026-08-04 and the predicate below is the settled result. The numbers, for the migration header:

| variant | rows |
|---|---|
| naive (live lane, recurring, not `billing_active`, no `billing_active` sibling of the same service) | **131** |
| \+ exclude `parent_job_id is not null` | 35 |
| \+ exclude deals with a `billing_active` `ai_seo` parent | 33 |
| \+ require `amount_net > 0` | 31 |
| \+ exclude deals whose accounting stage is `closed`/`done` | 11 |
| \+ require `j.status = 'active'` → **shipped variant** | **10** |

The 96 rows the first exclusion removes were AI-SEO trio children: their billing sits on the `ai_seo` parent by design, so they are not defects. The `closed`/`done` exclusion matches how checks 1, 12 and 14 already scope themselves.

Severity is `red`: at 10 rows it is a short, actionable list, and every row is a service being delivered with nobody billing it. The 10 deals are `000039`, `000082`, `000122`, `000150`, `000289`, `000306`, `000328`, `000362`, `005497`, `005557` — put that list in the migration header so the backlog is visible rather than implied.

- [ ] **Step 2: Confirm the base body you copy**

The base is `supabase/migrations/20260804091000_renewal_integrity_alerts.sql` — the 23-check body, live md5 `d5a886e95dfeb92673258d035cd6a818` as applied on 2026-08-04. Copy it verbatim; checks 1-23 must come through byte-identical.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260805091000_service_card_not_billing_alert.sql`. Copy the entire `accounting_integrity_alerts()` body from `20260804091000_renewal_integrity_alerts.sql` verbatim, and append this check after check 23, immediately before the closing `)` of the `alerts` CTE:

```sql
    union all
    -- 24 service_card_not_billing: a live card whose service nobody bills.
    --     ensure_recurring_payments() only extends a period when a NON-archived,
    --     billing_active job of the same service_type + billing_type exists, so
    --     clearing billing_active on the last such job stops the schedule for
    --     ever — silently, because billing_gap (check 11) needs a billing_active
    --     recurring job to fire at all. Deal 000403 ran two months this way.
    --     Exclusions, each measured on prod 2026-08-04 (131 -> 10 rows):
    --       parent_job_id / billing_only  AI-SEO trio children bill on the parent (-96)
    --       ai_seo parent on the deal     same structure, seen from the child (-2)
    --       amount_net = 0                bundled or free, nothing to bill (-2)
    --       deal stage closed/done        finished engagement, stale card (-20)
    --       status <> 'active'            the team ended the work (-1)
    select 'service_card_not_billing','red','lifecycle','job', j.id, j.code,
           'Live service card with no active billing',
           'Card is live and bills EUR '||j.amount_net::text||'/period, but no '||
             'billing_active recurring job covers '||j.service_type||' on this deal',
           j.deal_id, j.id, ''
      from jobs j
      join pipeline_stages s on s.id = j.stage_id
      join deals d on d.id = j.deal_id
      join pipeline_stages ps on ps.id = d.accounting_stage_id
     where not j.archived and not d.archived and not s.is_terminal
       and ps.code not in ('closed','done')
       and j.status = 'active'
       and j.service_type in ('web_seo','local_seo','ads','social_media','maintenance')
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and not j.billing_active
       and j.parent_job_id is null
       and not coalesce(j.billing_only, false)
       and coalesce(j.amount_net, 0) > 0
       and not exists (select 1 from jobs j2
                        where j2.deal_id = j.deal_id and not j2.archived
                          and j2.service_type = j.service_type and j2.billing_active)
       and not exists (select 1 from jobs p
                        where p.deal_id = j.deal_id and not p.archived
                          and p.billing_active and p.service_type = 'ai_seo')
```

Head the file with purpose, the pre-change md5 `d5a886e95dfeb92673258d035cd6a818`, the Step 1 tuning table and the 10 deal codes, and a `ROLLBACK:` block that re-applies the `20260804091000` body.

- [ ] **Step 4: Self-check by reading it**

You cannot execute SQL. Re-read the migration and confirm: checks 1-23 are byte-identical to the base file; check 24 sits inside the `alerts` CTE, after check 23 and before the closing `)`; the `union all` that joins it is present; the dismissal filter and the `order by` at the end are untouched. State each check's result in your report. Leave prod application to the controller.

- [ ] **Step 5: Note the expected verification (controller runs it)**

After the controller applies the migration, the check must return exactly the 10 deals listed in Step 1, and **zero rows for 000403** — Task 1 made `000403-WEBSEO` the billing owner. Record that expectation in your report.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805091000_service_card_not_billing_alert.sql
git commit -m "feat(alerts): flag live service cards with no active billing"
```

---

### Task 4: Runbook and data-fix record

**Files:**
- Create: `docs/data-fixes/2026-08-04-deal-000403-service-change.md`
- Modify: `docs/tech/technical/service-boards.md`

**Interfaces:**
- Consumes: the query outputs captured in Task 1 and the counts from Task 3 Step 1.
- Produces: the written record the next investigator reads instead of re-deriving 000403 from `activity_log`.

- [ ] **Step 1: Write the data-fix record**

Create `docs/data-fixes/2026-08-04-deal-000403-service-change.md` following the shape of the existing files in that folder. It must contain, with no summarising away of numbers: the verified starting state table from this plan; the finding that no `service_type_converted` entry exists, so the change was made by hand; the two owner decisions from Task 1 Step 1 and who gave them; the exact SQL that ran; the before/after of `deal_payments`; the backup table name `public.deal_000403_service_change_backup_20260804`; and the expected accounting-stage transition off `paid_in_full` from Task 1 Step 9.

- [ ] **Step 2: Add the runbook section to `docs/tech/technical/service-boards.md`**

Append:

```markdown
## Changing a service on a live deal

Use the **Convert service** action on the job (`convert_job_service_type`). It moves the card to the new board, regenerates code/owner/group/monthly tasks, rewrites the deal's `services_planned` entry, and — since `20260805090000` — re-keys the deal's billing rows to the new service.

Do **not** do it by hand (close the old card, make a new one, edit `services_planned`). That path leaves the paid periods keyed to the dead service, and if the new card ends up `billing_active = false` the recurring generator stops for ever: `ensure_recurring_payments()` only extends a period when a non-archived, `billing_active` job of the same `service_type` + `billing_type` exists. Deal 000403 ran two months unbilled that way (`docs/data-fixes/2026-08-04-deal-000403-service-change.md`). The `service_card_not_billing` alert now catches it, but the convert action avoids it.
```

- [ ] **Step 3: Commit**

```bash
git add docs/data-fixes/2026-08-04-deal-000403-service-change.md \
        docs/tech/technical/service-boards.md
git commit -m "docs: record the 000403 service-change fix and the convert runbook"
```
