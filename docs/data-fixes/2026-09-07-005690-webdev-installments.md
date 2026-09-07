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

`jobs.installment_plan = 'none'`, `installment_schedule = null`.

## Why this could not be fixed through the UI

`update_job_billing` refuses with `cannot_replan_paid_installment` when any
payment line for the job is `paid` or carries an invoice number — a deliberate
guard so re-planning never rewrites money that has already been collected.
Instalment 1/2 is paid, so the panel could not set the plan. The repair is
therefore applied as direct SQL that changes the *declaration* only and never
regenerates the payment rows.

## Changes applied

```sql
update public.jobs
   set installment_plan = 'custom',
       installment_schedule = jsonb_build_array(
         jsonb_build_object('amount_net', 345.00, 'due_date', '2026-07-16'),
         jsonb_build_object('amount_net', 255.65, 'due_date', '2026-09-30')),
       updated_at = now()
 where code = '005690-WEBDEV';

update public.deal_payments dp
   set end_date = date '2026-09-30', status = 'pending', updated_at = now()
  from public.deal_payment_lines pl
 where pl.payment_id = dp.id
   and pl.job_id = (select id from public.jobs where code = '005690-WEBDEV')
   and dp.label ilike '%2/2%' and dp.status <> 'paid';
```

`custom`, not `50_50`: the split is 345.00 / 255.65, which is 57.5 % / 42.6 %.
Recording it as `50_50` would have been a false statement about the agreement.

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

- **The €0.65 discrepancy.** 345.00 + 255.65 = 600.65 against a job amount of
  600.00. The owner was asked and chose to leave the amounts alone, so the
  client still owes 255.65. Only `006042-WEBDEV` (1300.00 vs 1180.00) shows a
  comparable gap; the other jobs flagged by a naive sum check are false
  positives, where `one_time_amount` is null and the figure lives in
  `amount_net`.
- **Instalment 1/2.** Paid; untouched.
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
-- custom, [{345.00, 2026-07-16}, {255.65, 2026-09-30}]
select dp.label, dp.end_date, dp.amount_net, dp.status
  from deal_payments dp join deal_payment_lines pl on pl.payment_id=dp.id
 where pl.job_id=(select id from jobs where code='005690-WEBDEV');
-- 1/2 16/07/2026 345.00 paid | 2/2 30/09/2026 255.65 pending
```
