# 2026-08-04 — Re-key deal 000403's hand-made service change (local_seo → web_seo)

## Problem

Deal `000403` — ΥΔΡΑΙΟΣ ΙΩΑΝΝΗΣ ΕΜΜΑΝΟΥΗΛ — had its SEO service changed from
Local SEO to Web SEO without ever going through `convert_job_service_type`.
`activity_log` has **no `service_type_converted` entry** for this deal.
What actually happened, read from `activity_log` on 2026-08-04: both SEO jobs
were **inserted 38 seconds apart at onboarding** on 2026-06-22
(`10:37:24` local `000403-LOCALSEO`, `10:38:02` web `000403-WEBSEO`).
Someone edited `deals.services_planned` to `web_seo` by hand, closed the local
card (its note reads `δεν ειναι λοκαλ`), and left the web card. Nothing moved
the billing: the paid period stayed keyed `local_seo`, both SEO jobs ended up
`billing_active = false`, and `ensure_recurring_payments()` only extends a
period when a `billing_active` job of the same `service_type` + `billing_type`
exists — so no period had been generated since 2026-06-08. At €250/month that
was ~2 months unbilled and counting, invisible to the `billing_gap` alert
(which requires a `billing_active` recurring job to exist in the first place)
and to the recurring-clients view (0 billing_active recurring jobs on this
deal).

## Verified starting state (read live 2026-08-04)

Deal `000403`, accounting stage `paid_in_full`, `payment_method='online'`,
`one_time_value=400.00`, `recurring_monthly_value=0.00`,
`services_planned=[{service_type: web_seo, billing_type: recurring_monthly, monthly_amount: 0, one_time_amount: 0, setup_fee: 0}]`.

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

Both SEO payment rows have `invoice_number IS NULL` — no issued invoice
contradicts a re-key.

## Owner decisions (2026-08-04)

Both gated on the owner's explicit sign-off before Task 1 ran:

1. *"The €250 period 08/05→08/06 was billed as Local SEO but the service
   delivered is Web SEO, and no invoice number was ever issued for it. Re-key
   that paid row to `web_seo` so the SEO history is continuous?"* — **Owner
   answer: YES.**
2. *"Re-activating billing generates the missing periods 08/06→08/07 and
   08/07→08/08 as unpaid and already past due (~€500 + VAT). The deal will
   drop out of Paid In Full, and `daily_payment_reminders` (06:00 UTC cron)
   may email the client about them. Proceed, or create them only after
   accounting has contacted the client?"* — **Owner answer: activate billing
   only, do not run the catch-up.** Controller addition: set
   `deals.suppress_payment_reminders = true` on 000403, because activating
   billing lets the 02:00 UTC cron start creating the overdue periods and the
   06:00 UTC reminder cron would otherwise send a ~57-day final notice before
   accounting had spoken to the client.

Task 1 is prod data work requiring the Supabase PAT; the controller executed
the SQL directly (rather than pasting the credential into a subagent prompt),
per the owner's sign-off above.

## What was run (2026-08-04, prod CRM xujlrclyzxrvxszepquy)

### Step 1 — Backup

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

Result: `deal 1`, `job 3`, `payment 2`, `line 2` — matched the expected
snapshot exactly, confirming the starting state above still held.

### Step 2 — Re-key the paid SEO period and its line

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

### Step 3 — Make the web_seo job the live billing owner

```sql
update public.jobs
   set billing_active = true,
       status = 'active'
 where code = '000403-WEBSEO';
```

`amount_net` (250.00) was left as the value every alert, the recurring
generator and `jobAmount.ts` actually read; `monthly_amount` was left at
`0.00` to avoid double-counting.

### Step 4 — Deal header sync

```sql
select recurring_monthly_value, one_time_value, services_planned
  from public.deals where code = '000403';
```

`jobs_sync_deal_pricing` had already synced it in response to Step 3 — no
manual update was required. Result: `recurring_monthly_value` auto-synced
`0.00 → 250.00`; `services_planned` monthly_amount auto-synced `0 → 250`.
`deals.suppress_payment_reminders` set `true` per owner decision 2.

### Step 5 — Recompute period dates

```sql
select public.recompute_deal_job_period_dates((select id from public.deals where code = '000403'));

select j.code, s.code as stage, j.period_start_date, j.period_due_date,
       j.renewed_for_period, j.billing_active, j.status
  from public.jobs j
  left join public.pipeline_stages s on s.id = j.stage_id
 where j.deal_id = (select id from public.deals where code = '000403')
 order by j.code;
```

Result: `000403-WEBSEO` now `period_start_date = 2026-05-08`,
`period_due_date = 2026-06-08`; `000403-LOCALSEO` has both **NULL** (its
payment moved away) and stays `closed`/`completed`. The card did not jump to
Renewal — `seo_sync_renewal_job`'s first-cycle floor is
`onboarded_at + 14d = 2026-07-06`, and `2026-05-08 < 2026-07-06`. It moves to
Renewal by itself the first time a period starting after 2026-07-06 is paid,
which is correct.

### Step 6 — Missing periods: NOT generated (owner decision 2)

`ensure_recurring_payments()` catch-up was explicitly **skipped** per the
owner's second decision. Only billing activation ran (Steps 2-3); no
successor `deal_payments` rows were created in this fix.

### Step 7 — Confirm accounting stage

```sql
select ps.code as accounting_stage, public.deal_next_due(d.id) as next_due
  from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
 where d.code = '000403';
```

Result: `accounting_stage = paid_in_full`, `next_due = NULL` — expected,
since no unpaid period was created (catch-up skipped).

## Before / after — `deal_payments`

| id | field | before | after |
|---|---|---|---|
| `17204d4c-6b13-4fdc-9dd4-fb2ede3252cc` | `service_type` | `local_seo` | `web_seo` |
| `17204d4c-6b13-4fdc-9dd4-fb2ede3252cc` | amount / period / status | €250 net, 2026-05-08 → 2026-06-08, `paid` | unchanged |
| `17204d4c-6b13-4fdc-9dd4-fb2ede3252cc` line → `job_id` | | `000403-LOCALSEO` | `000403-WEBSEO` |

`invoice_number` on this row was `NULL` throughout — no issued invoice was
contradicted by the re-key.

## Verification (after the fix)

- Deal `000403` still `accounting_stage = paid_in_full`, `next_due = NULL`.
- The `seo_job_no_period` alert predicate: **zero rows** for 000403.
- The `service_card_not_billing` alert predicate (check 24, once applied —
  see below): **zero rows** for 000403.
- `000403-WEBSEO` resolves period `2026-05-08 → 2026-06-08`.

## Related code changes shipped alongside this fix

- `supabase/migrations/20260805090000_convert_job_service_type_billing.sql`
  — `convert_job_service_type` now re-keys the deal's billing rows to the
  new service as part of the supported convert path. **Applied to prod
  2026-08-04**, post-change `md5(pg_get_functiondef(oid))` =
  `cbc03ef185e010db50cc56539065b228`.
- `supabase/migrations/20260805091000_service_card_not_billing_alert.sql`
  — adds a new `service_card_not_billing` integrity alert (check 24) that
  catches a live service card with no active billing job, the same shape of
  defect as this one. This migration has been **written and reviewed but is
  NOT yet applied to prod** — do not assume the alert is live until a
  follow-up records its application.

## Expected transitions — do not "fix" these back

- The 02:00 UTC `daily_ensure_recurring_payments` cron will start creating
  the missing periods for `000403-WEBSEO`, **one per night** (the function
  only ever creates one successor period per call).
- The first time a resulting period is past due, the deal will **leave
  `paid_in_full`** (moving to `awaiting_payment`/`on_hold` via
  `reconcile_block_lifecycle` or `mark-overdue-payments`). This is correct —
  the client genuinely owes those periods; it is not a regression of this
  fix.
- `deals.suppress_payment_reminders = TRUE` was set **specifically on this
  deal** so `daily_payment_reminders` (06:00 UTC) does not email the client
  about a ~57-day-old past-due notice before accounting has spoken to them.
  **This flag must be cleared once accounting has had that conversation** —
  it is a deliberate, temporary hold, not a permanent setting.

## Open item (not part of this fix)

`000403-WEBSEO` sits in board lane `stuck` with live billing — flagged to
the Web SEO lead; nobody is actively working the card.

## Backup table

`public.deal_000403_service_change_backup_20260804` — **KEEP** until
accounting has confirmed the re-key and the resumed billing look correct on
this deal, then drop. Row-level security enabled, revoked from
`anon`/`authenticated`. Rows: `deal 1`, `job 3`, `payment 2`, `line 2`
(generic shape: `kind text, row_data jsonb` — a full pre-image of every row
touched).

## Revert

```sql
-- payment: back to local_seo
update public.deal_payments p
   set service_type = b.row_data->>'service_type'
  from public.deal_000403_service_change_backup_20260804 b
 where b.kind = 'payment'
   and (b.row_data->>'id')::uuid = p.id
   and p.id = '17204d4c-6b13-4fdc-9dd4-fb2ede3252cc';

-- payment line: back to 000403-LOCALSEO
update public.deal_payment_lines l
   set job_id = (b.row_data->>'job_id')::uuid
  from public.deal_000403_service_change_backup_20260804 b
 where b.kind = 'line'
   and (b.row_data->>'id')::uuid = l.id
   and l.payment_id = '17204d4c-6b13-4fdc-9dd4-fb2ede3252cc';

-- jobs: restore billing_active/status on both SEO cards
update public.jobs j
   set billing_active = (b.row_data->>'billing_active')::boolean,
       status         = b.row_data->>'status'
  from public.deal_000403_service_change_backup_20260804 b
 where b.kind = 'job'
   and (b.row_data->>'id')::uuid = j.id
   and j.code in ('000403-LOCALSEO', '000403-WEBSEO');

-- deal: restore recurring_monthly_value, services_planned, suppress_payment_reminders
update public.deals d
   set recurring_monthly_value    = (b.row_data->>'recurring_monthly_value')::numeric,
       services_planned           = b.row_data->'services_planned',
       suppress_payment_reminders = (b.row_data->>'suppress_payment_reminders')::boolean
  from public.deal_000403_service_change_backup_20260804 b
 where b.kind = 'deal'
   and (b.row_data->>'id')::uuid = d.id
   and d.code = '000403';

-- recompute period dates so LOCALSEO/WEBSEO reflect the reverted ownership
select public.recompute_deal_job_period_dates((select id from public.deals where code = '000403'));
```

Do not revert `20260805090000_convert_job_service_type_billing.sql` as part
of undoing this data fix — that migration is a separate, systemic change
(see its own `ROLLBACK:` header if it ever needs reverting).
