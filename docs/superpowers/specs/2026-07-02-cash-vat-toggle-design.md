# Cash VAT toggle — design

**Date:** 2026-07-02
**Status:** Approved (brainstorm) — pending implementation plan

## Problem

For cash payments, VAT (ΦΠΑ) usually should not be charged, regardless of country.
Today VAT is derived from country only, in two disconnected places:

- **Lead sales total** (`LeadForm.tsx`) — `vatRateFor(country)`; a Greek cash lead
  still shows +24 % VAT. (A first pass on 2026-07-02, commit `64a77c3`, auto-zeroed
  VAT for cash via `effectiveVatRate(paymentMethod, country)`. This spec **supersedes**
  that with an explicit per-deal choice.)
- **Billing seed** (`release_billing_jobs_for_deal`, the AI-SEO trio seeder) —
  `v_vat := case when country ilike 'cyprus' then 0 else 24 end`, ignoring payment
  method. So cash deals are invoiced at 24 %.

Rather than force cash → 0 automatically, the salesperson should **explicitly choose**
whether a cash deal carries VAT. This is safer: nothing goes VAT-free (or VAT-charged)
without a deliberate selection, and the same choice drives both the sales screen and
the invoice.

## The rule

Effective VAT rate:

- `payment_method != 'cash'` → country rate (unchanged: Greece 24 %, Cyprus 0 %).
- `payment_method == 'cash'` → `cash_charge_vat ? country_rate : 0`.

Default for cash: **no VAT** (`cash_charge_vat = false`).

## Data model

Add one column to **both** `leads` and `deals`:

```
cash_charge_vat boolean not null default false
```

- Only meaningful when `payment_method = 'cash'`; ignored otherwise.
- `false` (default) = cash is VAT-free; `true` = cash charges the country rate.
- Existing rows default to `false` (matches the chosen "cash = no VAT" default).

## Frontend

**Helper** — `src/lib/countries.ts`, generalize the existing `effectiveVatRate`:

```ts
effectiveVatRate(
  paymentMethod: string | null | undefined,
  country: string | null | undefined,
  cashChargeVat: boolean,
): number
// cash  -> cashChargeVat ? vatRateFor(country) : 0
// other -> vatRateFor(country)
```

**Forms** — `LeadForm.tsx` and `DealForm.tsx`:

- New state `cashChargeVat`, persisted to the row.
- A checkbox **"Χρέωση ΦΠΑ" (Charge VAT)** rendered **only when** payment method =
  `cash`; unchecked by default. Hidden for online/other (VAT stays country-based).
- `LeadForm`'s totals table uses `effectiveVatRate(paymentMethod, country, cashChargeVat)`
  and recomputes live when either the payment method or the checkbox changes.
- `DealForm` has no VAT-totals table; the checkbox there only stores the choice that
  drives billing.

## Billing flow

1. **Conversion** — the lead→deal creation path (`convert_lead_to_client` / the accounting
   create-deal path) copies `cash_charge_vat` from the lead to the deal, alongside
   `payment_method` and `services_planned`.
2. **Seed** — the job-seed functions (`release_billing_jobs_for_deal` @ `20260629120000`,
   the AI-SEO trio seeder @ `20260629000000`, and any other spot computing `v_vat`)
   read the deal's `payment_method` + `cash_charge_vat` and compute:
   `v_vat := case when payment_method='cash' and not cash_charge_vat then 0 else country_rate end`.

**Forward-only.** The toggle is read at seed time. Editing it on a deal whose jobs are
**already seeded** does NOT retroactively change those jobs' `vat_rate` — there is no
re-derive trigger. Accounting adjusts already-seeded jobs manually if ever needed.

## Existing data

**No backfill. Existing leads / deals / jobs are not touched.** Adding the column gives
existing rows `cash_charge_vat = false` by default, but no existing job's `vat_rate` is
changed and no already-billed row is modified. The feature applies only to conversions /
seeds from now on. (The 11 current cash-deal jobs at 24 % are left exactly as they are.)

## Testing

- **Unit** (`countries.test.ts`): `effectiveVatRate` — cash+charge → country rate,
  cash+no-charge → 0, non-cash → country rate (Greece + Cyprus).
- **pgTAP**: seed function sets `vat_rate = 0` for a cash + `cash_charge_vat=false` deal,
  and country rate for cash + `cash_charge_vat=true` and for non-cash.

## Changes / Revert

**Changes**

- Migration: `cash_charge_vat` column on `leads` + `deals`; updated seed functions
  (`release_billing_jobs_for_deal`, AI-SEO seeder); conversion copy. No data backfill.
- Frontend: `effectiveVatRate` signature; `LeadForm` + `DealForm` checkbox + wiring;
  tests.

**Revert**

- Migration `ROLLBACK` restores the country-only `v_vat` in the seed functions and drops
  the `cash_charge_vat` columns. No data to restore (nothing was backfilled).
- Frontend: revert the helper signature + form changes (the 2026-07-02 `64a77c3` auto-zero
  behavior is fully replaced, not restored).
