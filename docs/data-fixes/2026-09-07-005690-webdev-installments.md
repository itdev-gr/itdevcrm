# 2026-09-07 — 005690-WEBDEV: declare the 2 instalments, fix the 2nd due date

Owner report: «005690 το web dev εδώ είναι 2 δόσεις, φτιάξ' το».

Client **Next Line interiors** (`005690`), job `005690-WEBDEV`, one-time
€600 net. The payments were already split into two instalments, but the job
record itself said `installment_plan = 'none'` — so the billing panel showed
the job as a single payment while the client's ledger showed two. On top of
that both instalments carried the same due date (16/07/2026), which is why the
second one had flipped to `overdue` the day after it was created.

## State before

| Payment | Net | Gross | Status | end_date |
|---|---|---|---|---|
| Installment 1/2 | 345.00 | 427.80 | paid | 16/07/2026 |
| Installment 2/2 | 255.65 | 317.01 | **overdue** | 16/07/2026 |

End state: 345.00 paid + 255.00 due 30/09/2026 = 600.00 exactly.

`jobs.installment_plan = 'none'`, `installment_schedule = null`.

## Why this could not be fixed through the UI

`update_job_billing` refuses with `cannot_replan_paid_installment` when any
payment line for the job is `paid` or carries an invoice number — a deliberate
guard so re-planning never rewrites money that has already been collected.
Instalment 1/2 is paid, so the panel could not set the plan. The repair is
therefore applied as direct SQL that changes the *declaration* only and never
regenerates the payment rows.

## Changes applied

The €0.65 overshoot (345.00 + 255.65 = 600.65 against the job's 600.00) was
closed on the owner's instruction by taking it off the **second** instalment:
255.65 → 255.00, so the two now sum to exactly 600.00. `vat_amount` and
`amount_gross` are GENERATED columns on both `deal_payments` and
`deal_payment_lines`, and `sync_payment_line_amounts` copies `amount_net` down
to the single line, so setting the payment's net was enough — VAT 61.20 and
gross 316.20 followed on their own. Instalment 1/2 stays at the 345.00 that was
actually collected.

For the record, `006042-WEBDEV` (1300.00 vs 1180.00) has a comparable gap and
was not touched; the other jobs a naive sum check flags are false positives,
where `one_time_amount` is null and the figure lives in `amount_net`.

```sql
update public.jobs
   set installment_plan = '50_50',
       installment_schedule = null,
       updated_at = now()
 where code = '005690-WEBDEV';

update public.deal_payments dp
   set end_date = date '2026-09-30', status = 'pending', updated_at = now()
  from public.deal_payment_lines pl
 where pl.payment_id = dp.id
   and pl.job_id = (select id from public.jobs where code = '005690-WEBDEV')
   and dp.label ilike '%2/2%' and dp.status <> 'paid';

update public.deal_payments dp            -- close the 0.65 overshoot
   set amount_net = 255.00, updated_at = now()
  from public.deal_payment_lines pl
 where pl.payment_id = dp.id
   and pl.job_id = (select id from public.jobs where code = '005690-WEBDEV')
   and dp.label ilike '%2/2%' and dp.status <> 'paid';
```

`50_50`, on the owner's correction. I first recorded `custom` by reading the
split back from the payments (345.00 / 255.65 is 57.5 / 42.6, not a half), but
the agreement with the client *is* 50/50 — the first instalment was simply
collected at 345.00 rather than 300.00, leaving 255.65 as the remainder. The
plan field states the agreement; the payment rows state what actually happened.
That is the right way round, and it is why the two do not match to the euro.

`installment_schedule` is cleared: a custom schedule only applies to
`plan = 'custom'`. The second instalment's due date lives on the payment row,
which is what `mark_overdue_payments` actually reads.

`end_date`, not `start_date`: `mark_overdue_payments` keys a `one_time`
payment's due date on `end_date` (recurring ones use `start_date`), so that is
the field that governs whether the row reads as overdue. `start_date` is left
at 16/07/2026, the date the plan was drawn up. Status set back to `pending`
because 30/09/2026 is in the future; the cron will flip it again on its own if
it goes unpaid.

Due date chosen by the owner (end of the current month). There is no house
convention to infer it from: of the web-dev jobs with instalments, 5 have both
instalments on the same date and 3 are spread by 21, 73 and 95 days.

## Deliberately NOT changed

- **Instalment 1/2.** Paid; untouched throughout.
- **The client's other overdue rows** (hosting €120 yearly, WEBDEV-2 €30
  monthly). Genuinely overdue, unrelated to this repair.

## Same inconsistency elsewhere

Six jobs have instalment payments while declaring `installment_plan = 'none'`;
25 declare it correctly. Only 005690 was repaired here. The rest, if the owner
wants them done:

`002154-WEBDEV`, `004556-WEBDEV`, `006042-WEBDEV`, `006095-WEBDEV`,
`006846-WEBDEV`.

## Verification

```sql
select installment_plan, installment_schedule from jobs where code='005690-WEBDEV';
-- 50_50, null
select dp.label, dp.end_date, dp.amount_net, dp.status
  from deal_payments dp join deal_payment_lines pl on pl.payment_id=dp.id
 where pl.job_id=(select id from jobs where code='005690-WEBDEV');
-- 1/2 16/07/2026 345.00 paid | 2/2 30/09/2026 255.00 pending  (sum = 600.00)
```
