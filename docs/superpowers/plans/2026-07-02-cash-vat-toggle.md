# Cash VAT Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sales/accounting explicitly choose whether a **cash** deal carries VAT, driving both the lead sales total and the invoice `vat_rate`.

**Architecture:** A `cash_charge_vat boolean default false` column on `leads` + `deals`. A shared `effectiveVatRate(paymentMethod, country, cashChargeVat)` helper drives the lead total. The lead→deal conversion copies the flag, and the billing-seed functions compute `vat_rate` from it. Forward-only: no backfill, no re-derive of already-seeded jobs.

**Tech Stack:** React + TypeScript (Vite, Vitest), Supabase Postgres (plpgsql, pgTAP). Prod DDL applied via the Supabase Management API (`curl` + `sbp` token).

## Global Constraints

- Rule: `payment_method='cash'` → `cash_charge_vat ? countryRate : 0`; otherwise `countryRate` (Greece 24%, Cyprus 0%). Default for cash = **no VAT** (`false`).
- Forward-only: **never** modify existing rows' `vat_rate`; no data backfill; no re-derive trigger.
- Frontend must pass `npm run build` (tsc -b + eslint `--max-warnings=0`, `noUncheckedIndexedAccess`).
- Migrations carry a `-- ROLLBACK:` block. Push directly to `main`.
- Prod DDL is applied and verified via the Management API after the migration file is committed (drift-check the live function body first with `pg_get_functiondef`).

---

## File Structure

- **Create** `supabase/migrations/20260702160000_cash_charge_vat.sql` — column on `leads`+`deals`; cash-aware `v_vat` in `release_billing_jobs_for_deal` + `release_jobs_for_deal`; `cash_charge_vat` copy in `convert_lead_to_client`.
- **Create** `supabase/tests/cash_charge_vat.sql` — pgTAP for column + seed VAT logic + conversion copy.
- **Modify** `src/lib/countries.ts` — `effectiveVatRate` gains a 3rd param.
- **Modify** `src/lib/countries.test.ts` — cover the new param.
- **Modify** `src/features/leads/LeadForm.tsx` — `cashChargeVat` state, checkbox (cash-only), totals wiring, save payload.
- **Modify** `src/features/deals/DealForm.tsx` — `cashChargeVat` state, checkbox (cash-only), save payload.
- **Modify** `src/types/supabase.ts` — add `cash_charge_vat` to `leads`/`deals` Row/Insert/Update (manual edit; `types:gen` needs CLI auth).

---

## Task 1: Frontend helper — `effectiveVatRate` takes the cash flag

**Files:**
- Modify: `src/lib/countries.ts`
- Test: `src/lib/countries.test.ts`

**Interfaces:**
- Produces: `effectiveVatRate(paymentMethod: string|null|undefined, country: string|null|undefined, cashChargeVat: boolean): number`

- [ ] **Step 1: Update the failing test** — replace the `effectiveVatRate` describe block in `src/lib/countries.test.ts` with:

```ts
describe('effectiveVatRate', () => {
  it('cash without charge-VAT is 0, regardless of country', () => {
    expect(effectiveVatRate('cash', 'Greece', false)).toBe(0);
    expect(effectiveVatRate('cash', 'Cyprus', false)).toBe(0);
    expect(effectiveVatRate('cash', null, false)).toBe(0);
  });
  it('cash WITH charge-VAT uses the country rate', () => {
    expect(effectiveVatRate('cash', 'Greece', true)).toBe(0.24);
    expect(effectiveVatRate('Cash', 'Greece', true)).toBe(0.24); // case-insensitive
    expect(effectiveVatRate('cash', 'Cyprus', true)).toBe(0);
  });
  it('non-cash ignores the flag and uses the country rate', () => {
    expect(effectiveVatRate('online', 'Greece', false)).toBe(0.24);
    expect(effectiveVatRate('online', 'Greece', true)).toBe(0.24);
    expect(effectiveVatRate('', 'Greece', false)).toBe(0.24);
    expect(effectiveVatRate(null, 'Greece', false)).toBe(0.24);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/countries.test.ts`
Expected: FAIL — `effectiveVatRate` takes 2 args / wrong result.

- [ ] **Step 3: Update the helper** in `src/lib/countries.ts` — replace the existing `effectiveVatRate`:

```ts
/** The VAT actually charged. For cash the caller's explicit choice decides
 *  (default no VAT); any other payment method uses the country's rate. */
export function effectiveVatRate(
  paymentMethod: string | null | undefined,
  country: string | null | undefined,
  cashChargeVat: boolean,
): number {
  if ((paymentMethod ?? '').trim().toLowerCase() === 'cash') {
    return cashChargeVat ? vatRateFor(country) : 0;
  }
  return vatRateFor(country);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/countries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/countries.ts src/lib/countries.test.ts
git commit -m "feat(billing): effectiveVatRate takes explicit cash charge-VAT flag"
```

---

## Task 2: Types — add `cash_charge_vat` to `leads` and `deals`

**Files:**
- Modify: `src/types/supabase.ts`

**Interfaces:**
- Produces: `cash_charge_vat: boolean` on `leads` and `deals` Row; `cash_charge_vat?: boolean` on their Insert/Update.

- [ ] **Step 1: Add the field.** In `src/types/supabase.ts`, in the `leads` table block and the `deals` table block, add to `Row`: `cash_charge_vat: boolean`, and to `Insert` and `Update`: `cash_charge_vat?: boolean`. (Search for `vat_number: string | null` within each of the `leads:` and `deals:` blocks to locate them; add the new line alongside.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (no type errors introduced).

- [ ] **Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "types: add cash_charge_vat to leads and deals"
```

---

## Task 3: LeadForm — cash-only "Charge VAT" checkbox + total wiring

**Files:**
- Modify: `src/features/leads/LeadForm.tsx`

**Interfaces:**
- Consumes: `effectiveVatRate` (Task 1), `cash_charge_vat` type (Task 2).

- [ ] **Step 1: Import the helper.** Change the countries import line to include `effectiveVatRate` (it already imports `effectiveVatRate` after the 64a77c3 commit — confirm `effectiveVatRate` is imported; `vatRateFor` is not needed here).

- [ ] **Step 2: Add state.** Next to `const [paymentMethod, setPaymentMethod] = useState(lead.payment_method ?? '');` (~line 69) add:

```tsx
const [cashChargeVat, setCashChargeVat] = useState<boolean>(lead.cash_charge_vat ?? false);
```

- [ ] **Step 3: Persist it.** In the save payload (where `payment_method: paymentMethod || null,` is built, ~line 114) add on the next line:

```tsx
cash_charge_vat: paymentMethod === 'cash' ? cashChargeVat : false,
```

Also add `cashChargeVat` to the `useMemo`/dependency array that lists `paymentMethod` (~line 139).

- [ ] **Step 4: Render the checkbox (cash-only).** Immediately after the payment-method `<select>` block (the one closing after the `cash`/`online` options, ~line 327) add:

```tsx
{paymentMethod === 'cash' && (
  <label className="mt-2 flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={cashChargeVat}
      onChange={(e) => setCashChargeVat(e.target.checked)}
      disabled={readOnly}
    />
    {t('form.cash_charge_vat', { defaultValue: 'Χρέωση ΦΠΑ (μετρητά)' })}
  </label>
)}
```

- [ ] **Step 5: Use the flag in the totals.** Change the totals line (`const vatRate = effectiveVatRate(paymentMethod, country);`, ~line 373) to:

```tsx
const vatRate = effectiveVatRate(paymentMethod, country, cashChargeVat);
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual check (dev).** Run `npm run dev`, open a lead, set payment method = Cash → checkbox appears, unchecked → VAT column shows €0.00; check it → VAT returns to 24% (for a Greek lead). Set payment method = Online → checkbox hidden, VAT 24%.

- [ ] **Step 8: Commit**

```bash
git add src/features/leads/LeadForm.tsx
git commit -m "feat(leads): cash 'Charge VAT' checkbox drives the services total"
```

---

## Task 4: DealForm — cash-only "Charge VAT" checkbox (persist only)

**Files:**
- Modify: `src/features/deals/DealForm.tsx`

**Interfaces:**
- Consumes: `cash_charge_vat` type (Task 2).

- [ ] **Step 1: Add state.** Next to `const [paymentMethod, setPaymentMethod] = useState(initial.payment_method ?? '');` (~line 67) add:

```tsx
const [cashChargeVat, setCashChargeVat] = useState<boolean>(initial.cash_charge_vat ?? false);
```

- [ ] **Step 2: Persist it.** In the save payload (where `payment_method: paymentMethod || null,` is, ~line 86) add on the next line:

```tsx
cash_charge_vat: paymentMethod === 'cash' ? cashChargeVat : false,
```

Add `cashChargeVat` to the dependency array at ~line 89.

- [ ] **Step 3: Render the checkbox (cash-only).** Immediately after the payment-method `<select>` block (~line 268) add:

```tsx
{paymentMethod === 'cash' && (
  <label className="mt-2 flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={cashChargeVat}
      onChange={(e) => setCashChargeVat(e.target.checked)}
    />
    {tLeads('form.cash_charge_vat', { defaultValue: 'Χρέωση ΦΠΑ (μετρητά)' })}
  </label>
)}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/DealForm.tsx
git commit -m "feat(deals): cash 'Charge VAT' checkbox (persists the billing choice)"
```

---

## Task 5: Migration — column + cash-aware seed + conversion copy

**Files:**
- Create: `supabase/migrations/20260702160000_cash_charge_vat.sql`
- Test: `supabase/tests/cash_charge_vat.sql`

**Interfaces:**
- Consumes: nothing new. Produces the `cash_charge_vat` columns and cash-aware `v_vat`.

- [ ] **Step 1: Write the pgTAP test** `supabase/tests/cash_charge_vat.sql`:

```sql
-- Run with: supabase test db (transactional; rolls back)
begin;
select plan(4);

select has_column('public','deals','cash_charge_vat','deals has cash_charge_vat');
select has_column('public','leads','cash_charge_vat','leads has cash_charge_vat');

-- Seed VAT logic: build a cash deal in Greece with one recurring local_seo service.
do $$
declare v_client uuid; v_deal uuid;
begin
  insert into public.clients (name, country, code) values ('VAT Test', 'Greece', 'TVAT01')
    returning id into v_client;
  insert into public.deals (client_id, title, code, payment_method, cash_charge_vat, services_planned)
    values (v_client, 'VAT test deal', 'TVAT01', 'cash', false,
      '[{"service_type":"local_seo","billing_type":"recurring_monthly","monthly_amount":100,"one_time_amount":0,"setup_fee":0}]'::jsonb)
    returning id into v_deal;
  perform set_config('t.deal', v_deal::text, true);
  perform public.release_billing_jobs_for_deal(v_deal);
end $$;

select is((select vat_rate from public.jobs
           where deal_id = current_setting('t.deal')::uuid and service_type='local_seo' limit 1),
          0.00, 'cash + charge_vat=false seeds vat_rate 0');

-- Flip charge_vat=true on a fresh cash deal -> country rate (24).
do $$
declare v_client uuid; v_deal uuid;
begin
  insert into public.clients (name, country, code) values ('VAT Test2', 'Greece', 'TVAT02')
    returning id into v_client;
  insert into public.deals (client_id, title, code, payment_method, cash_charge_vat, services_planned)
    values (v_client, 'VAT test deal2', 'TVAT02', 'cash', true,
      '[{"service_type":"local_seo","billing_type":"recurring_monthly","monthly_amount":100,"one_time_amount":0,"setup_fee":0}]'::jsonb)
    returning id into v_deal;
  perform set_config('t.deal2', v_deal::text, true);
  perform public.release_billing_jobs_for_deal(v_deal);
end $$;

select is((select vat_rate from public.jobs
           where deal_id = current_setting('t.deal2')::uuid and service_type='local_seo' limit 1),
          24.00, 'cash + charge_vat=true seeds the country rate');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the migration** `supabase/migrations/20260702160000_cash_charge_vat.sql`. Columns first:

```sql
-- 2026-07-02: Explicit "charge VAT?" choice for cash payments (default: no VAT).
-- Forward-only: existing rows/jobs are untouched.
alter table public.leads add column if not exists cash_charge_vat boolean not null default false;
alter table public.deals add column if not exists cash_charge_vat boolean not null default false;
```

- [ ] **Step 3: Add the cash-aware seed** to the same migration file — paste the FULL current body of `release_billing_jobs_for_deal` (from `pg_get_functiondef`) and change ONLY the `v_vat :=` line to:

```sql
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    when trim(coalesce(v_country, '')) ilike 'cyprus' then 0.00
    else 24.00 end;
```

(The rest of the function body is unchanged. Reproduce it verbatim from the live definition captured during planning to avoid drift.)

- [ ] **Step 4: Make `release_jobs_for_deal`'s INSERT fallback cash-aware** in the same file — paste the FULL current body of `release_jobs_for_deal(uuid, boolean)`, and in its `insert into public.jobs (...)` that omits `vat_rate` (relying on the `24.00` column default), add `vat_rate` to the column list with value:

```sql
case when (select payment_method from public.deals where id = d.id) = 'cash'
      and not coalesce((select cash_charge_vat from public.deals where id = d.id), false)
     then 0.00
     when trim(coalesce((select country from public.clients where id = d.client_id), '')) ilike 'cyprus' then 0.00
     else 24.00 end
```

(If `release_jobs_for_deal` already reads the deal into a record, reuse that record instead of the subqueries.)

- [ ] **Step 5: Copy the flag at conversion** in the same file — paste the FULL current body of `convert_lead_to_client(uuid)` and add `cash_charge_vat` to the deal `insert` column list and `l.cash_charge_vat` to the corresponding `values` position (right after `payment_method` / `l.payment_method`).

- [ ] **Step 6: Add the ROLLBACK block** at the end of the migration:

```sql
-- ROLLBACK:
--   restore release_billing_jobs_for_deal, release_jobs_for_deal, convert_lead_to_client
--     from their pre-migration definitions (country-only v_vat; no cash_charge_vat copy);
--   alter table public.leads drop column if exists cash_charge_vat;
--   alter table public.deals drop column if exists cash_charge_vat;
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260702160000_cash_charge_vat.sql supabase/tests/cash_charge_vat.sql
git commit -m "feat(billing): cash_charge_vat column + cash-aware VAT seed + conversion copy"
```

---

## Task 6: Apply to prod + verify

**Files:** none (deployment).

- [ ] **Step 1: Drift-check** the three live function bodies (`release_billing_jobs_for_deal`, `release_jobs_for_deal`, `convert_lead_to_client`) via `pg_get_functiondef` and confirm they match the bodies the migration is based on. If drift, reconcile the migration first.

- [ ] **Step 2: Apply** the migration SQL to prod via the Management API (`curl` + `sbp` token, curl UA), wrapped in `begin; … commit;`.

- [ ] **Step 3: Verify** with a transactional probe (rolls back): insert a cash + `cash_charge_vat=false` Greek deal, `perform release_billing_jobs_for_deal(...)`, assert the seeded `local_seo` job's `vat_rate = 0`; repeat with `cash_charge_vat=true` → `24`; `rollback`.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-review notes

- Spec coverage: data model (T2, T5), helper (T1), lead display (T3), deal persistence (T4), billing seed + AI-SEO inline (T5), conversion copy (T5), forward-only/no-backfill (no backfill task exists — intentional), tests (T1, T5). ✓
- `release_jobs_for_deal` INSERT-fallback (jobs.vat_rate default 24) is covered by T5 Step 4 so cash isn't silently defaulted to 24 on that path.
- i18n: `form.cash_charge_vat` key added inline with `defaultValue`; add real EL/EN entries to the locale files if the codebase requires all keys present (check `src/i18n`).
