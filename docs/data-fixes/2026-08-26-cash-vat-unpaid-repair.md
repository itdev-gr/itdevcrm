# 2026-08-26 — Cash/no-VAT: repair of UNPAID payment rows (A0 fix #1)

Companion to migration `20260826150000_cash_vat_payment_seeding.sql` (the code fix:
`seed_deal_payments` now honors `cash_charge_vat`; `ensure_recurring_payments`
seeds renewals of cash/no-VAT deals at 0% instead of copying the wrong 24%
forward). Audit reference: A0 in `docs/system-analysis/2026-08-26-payment-system-audit.md`.

## What was changed (data)

`vat_rate 24.00 → 0.00` on the only two unpaid (pending/overdue) rows of
cash/no-VAT deals — run 2026-08-26, before either was invoiced:

| payment id | deal | service | status | net | gross before → after | start |
|---|---|---|---|---|---|---|
| 9edfce7c-970f-4fa0-87dd-149a3af99683 | 000338 | domains (yearly) | pending | €20.00 | €24.80 → €20.00 | 2028-05-11 |
| d027ef67-e6b5-4711-b544-d63b1ba5af56 | 005510 | ads (monthly) | pending | €200.00 | €248.00 → €200.00 | 2026-08-27 |

`amount_gross` is a GENERATED column — it recomputed automatically.

**ROLLBACK:** `update public.deal_payments set vat_rate = 24.00 where id in
('9edfce7c-970f-4fa0-87dd-149a3af99683','d027ef67-e6b5-4711-b544-d63b1ba5af56');`

## What was deliberately NOT changed

- The **19 paid rows / €977.11** already collected (12 deals, F11 list) — refund
  or written-off is the owner's section-C decision.
- The mirror bug **B3** (online Greek deals billing 0%) — raising those to 24%
  increases client invoices; renewals still copy vat forward for non-cash deals
  until the owner decides.

## E2E verification (prod, throwaway entities, cleaned up)

1. New cash/no-VAT deal (web_dev one-time + local_seo monthly) → seeded at
   **0%** on every payment row (was 24% before the fix).
2. Control online deal → seeded at **24%** (€80 → €99.20 gross), unchanged.
3. Renewal propagation: a simulated legacy paid row at 24% on the cash deal
   renewed into a next period at **0%** (payment + line), amount copied intact.
4. Final sweep: unpaid cash-side mismatches = 0 rows book-wide.

## Heads-up recorded for the owner (000066)

Deal `000066` (ΦΟΥΡΝΑΡΗ ΑΙΚΑΤΕΡΙΝΗ) was switched to `payment_method='cash'`
with `cash_charge_vat=false` on 2026-08-26 — AFTER the audit's morning
measurement — which is why the paid-row tally now reads 25 rows/€1,297.78
against the report's 19/€977.11: its 6 historical paid rows (€320.67 VAT,
last touched 2026-07-31) entered the population by reclassification, not by
new collection. Its own sales note says the client pays WITH VAT by bank
transfer («ΠΛΗΡΩΣΑΝ 420 ΕΥΡΩ ΜΕΣΑ Ο ΦΠΑ ΜΕ ΜΕΤΑΦΟΡΑ ΑΠΟ ΠΕΙΡΑΙΩΣ»). If that
client genuinely owes VAT, the deal needs `cash_charge_vat = true` — otherwise
every future renewal now correctly seeds at 0% under the new code.
