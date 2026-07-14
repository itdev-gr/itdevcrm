# 2026-07-14 — Resync drifted deal_payment_lines amounts

## Problem

Editing a payment's Net/VAT in the Payments table only updated
`deal_payments`; the breakdown row in `deal_payment_lines` was written once at
creation and never touched again. The Jobs & Billing card renders the lines
(and `deal_payments_with_totals`, whose header total is the **sum of the
lines**), so edited payments showed stale amounts there forever.

Reported on deal 000071: card showed €273.00, real payment €210.01
(invoice ΤΠΥ-0000001065). A prod scan found **60 drifted lines** (52 with
net drift — worst €200 shown vs €466 real — plus VAT-rate-only cases), all on
single-line payments. Money reports (kanban, dashboard, MRR, ledger) were
unaffected — they read `deal_payments` directly.

The root cause is fixed forward by migration
`20260714090000_payment_line_amount_sync.sql` (AFTER UPDATE trigger mirrors
header `amount_net`/`vat_rate` into the payment's single line).

## What was run (2026-07-14, prod CRM xujlrclyzxrvxszepquy)

```sql
begin;

create table public.deal_payment_lines_backup_20260714 as
select l.*
  from public.deal_payment_lines l
  join public.deal_payments p on p.id = l.payment_id
 where (l.amount_net is distinct from p.amount_net or l.vat_rate is distinct from p.vat_rate)
   and (select count(*) from public.deal_payment_lines x where x.payment_id = p.id) = 1;

alter table public.deal_payment_lines_backup_20260714 enable row level security;
revoke all on public.deal_payment_lines_backup_20260714 from anon, authenticated;

update public.deal_payment_lines l
   set amount_net = p.amount_net,
       vat_rate   = p.vat_rate
  from public.deal_payments p
 where p.id = l.payment_id
   and (l.amount_net is distinct from p.amount_net or l.vat_rate is distinct from p.vat_rate)
   and (select count(*) from public.deal_payment_lines x where x.payment_id = p.id) = 1;

commit;
```

Result: 60 rows backed up and updated. Verified afterwards: deal 000071 line
gross = 210.01 and view total_gross = 210.01.

## Known leftover (accepted)

Deal 005090 still reports a numeric mismatch: `deal_payments.amount_net` is
numeric(12,**4**) and holds 346.7780 (back-computed so gross lands on €430.00
exactly), while `deal_payment_lines.amount_net` is numeric(12,**2**) and can
only hold 346.78 (gross €430.01). Display impact is 1 cent on the Jobs &
Billing card for that deal only. Fixing it would mean widening the line
column's scale, which requires dropping/recreating its generated columns —
deliberately skipped. If more 4-decimal nets appear, widen then.

## Revert

```sql
update public.deal_payment_lines l
   set amount_net = b.amount_net,
       vat_rate   = b.vat_rate
  from public.deal_payment_lines_backup_20260714 b
 where b.id = l.id;
```

Backup table `deal_payment_lines_backup_20260714` — KEEP until the accounting
team confirms the card totals look right, then drop.
