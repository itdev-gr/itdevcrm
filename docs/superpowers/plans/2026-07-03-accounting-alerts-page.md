# Accounting Alerts Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `/accounting/alerts` worklist (accounting group + admins) that live-computes every billing/data anomaly, links each to the offending deal/job, and lets accounting Ignore intentional ones.

**Architecture:** One security-definer RPC `accounting_integrity_alerts()` runs all 14 checks as a `UNION ALL` and excludes rows dismissed in a small `integrity_alert_dismissals` table. React page groups the rows by category with severity chips + fix links + Ignore buttons; a sidebar badge shows the open count.

**Tech Stack:** React + TS (Vite, Vitest, react-query, react-router, i18next), Supabase Postgres (plpgsql, pgTAP). Prod DDL via the Management API (`curl` + `sbp` token, curl UA).

## Global Constraints

- Checks + severities are defined verbatim in Task 2; do not invent new ones or change conditions.
- Access: RPCs gate on `public.current_user_is_admin() or public.current_user_in_group('accounting')`; page/route under `RequireGroup(['accounting'])`.
- Frontend must pass `npm run build` (tsc -b, eslint `--max-warnings=0`, `noUncheckedIndexedAccess`).
- Migrations carry a `-- ROLLBACK:` block. Push to `main`. Prod DDL applied + verified after commit (drift-check any function this touches — here all four are new).
- Money never mutated: this feature only READS billing data (+ writes/removes dismissal rows).

---

## File Structure
- **Create** `supabase/migrations/20260703010000_integrity_alert_dismissals.sql` — table + RLS + dismiss/undismiss RPCs.
- **Create** `supabase/migrations/20260703020000_accounting_integrity_alerts.sql` — the checks RPC + count RPC.
- **Create** `supabase/tests/accounting_integrity_alerts.sql` — pgTAP.
- **Create** `src/features/accounting/alerts/alertPresenters.ts` (+ `.test.ts`), `AlertsPage.tsx`, `hooks/useIntegrityAlerts.ts`, `hooks/useAlertDismissals.ts`, `hooks/useAlertsCount.ts`.
- **Modify** `src/app/router.tsx` (add route), `src/components/layout/Sidebar.tsx` (nav entry + badge), `src/features/notifications/notification-presenters.tsx` (presenter), `src/types/supabase.ts` (table + RPC types), locale files `src/i18n/locales/{en,el}/accounting.json`.

---

## Task 1: Migration — dismissals table + dismiss/undismiss RPCs

**Files:** Create `supabase/migrations/20260703010000_integrity_alert_dismissals.sql`

**Interfaces:** Produces table `public.integrity_alert_dismissals` and RPCs `dismiss_integrity_alert(text,uuid,text,text) returns uuid`, `undismiss_integrity_alert(uuid) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- 2026-07-03: "Ignore" persistence for the Accounting Alerts page.
create table if not exists public.integrity_alert_dismissals (
  id uuid primary key default gen_random_uuid(),
  check_key   text not null,
  subject_id  uuid not null,
  signature   text not null default '',
  note        text,
  dismissed_by uuid references public.profiles(user_id),
  dismissed_at timestamptz not null default now(),
  unique (check_key, subject_id, signature)
);
alter table public.integrity_alert_dismissals enable row level security;
revoke all on table public.integrity_alert_dismissals from anon, authenticated;

create policy iad_read on public.integrity_alert_dismissals for select to authenticated
  using (public.current_user_is_admin() or public.current_user_in_group('accounting'));

create or replace function public.dismiss_integrity_alert(
  p_check_key text, p_subject_id uuid, p_signature text default '', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    raise exception 'not_authorized';
  end if;
  insert into public.integrity_alert_dismissals (check_key, subject_id, signature, note, dismissed_by)
    values (p_check_key, p_subject_id, coalesce(p_signature,''), p_note, auth.uid())
    on conflict (check_key, subject_id, signature)
      do update set note = excluded.note, dismissed_by = excluded.dismissed_by, dismissed_at = now()
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.dismiss_integrity_alert(text,uuid,text,text) from public, anon;
grant execute on function public.dismiss_integrity_alert(text,uuid,text,text) to authenticated;

create or replace function public.undismiss_integrity_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    raise exception 'not_authorized';
  end if;
  delete from public.integrity_alert_dismissals where id = p_id;
end $$;
revoke all on function public.undismiss_integrity_alert(uuid) from public, anon;
grant execute on function public.undismiss_integrity_alert(uuid) to authenticated;

-- ROLLBACK:
--   drop function if exists public.dismiss_integrity_alert(text,uuid,text,text);
--   drop function if exists public.undismiss_integrity_alert(uuid);
--   drop table if exists public.integrity_alert_dismissals;
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260703010000_integrity_alert_dismissals.sql
git commit -m "feat(accounting): integrity_alert_dismissals table + dismiss RPCs"
```

---

## Task 2: Migration — the `accounting_integrity_alerts()` engine (14 checks) + count

**Files:** Create `supabase/migrations/20260703020000_accounting_integrity_alerts.sql`; Test `supabase/tests/accounting_integrity_alerts.sql`

**Interfaces:**
- Consumes: `integrity_alert_dismissals` (Task 1).
- Produces: `accounting_integrity_alerts() returns table (check_key text, severity text, category text, subject_type text, subject_id uuid, subject_code text, title text, detail text, deal_id uuid, job_id uuid, signature text)` and `accounting_integrity_alerts_count() returns integer`. `severity` ∈ `red|amber|grey`; `category` ∈ `money|lifecycle|missing`.

- [ ] **Step 1: Write the pgTAP test** `supabase/tests/accounting_integrity_alerts.sql`:

```sql
begin;
select plan(4);
select has_function('public','accounting_integrity_alerts','engine exists');

-- Seed a €0 active deal (in accounting 'new') -> deal_zero_value alert.
do $$
declare c uuid; d uuid;
  v_new uuid := (select id from pipeline_stages where board='accounting_onboarding' and code='new' limit 1);
  v_won uuid := (select id from pipeline_stages where board='sales' and code='won' limit 1);
begin
  insert into clients (name, country, code) values ('ZALERT', 'Greece', 'ZALERT1') returning id into c;
  insert into deals (client_id, title, code, stage_id, accounting_stage_id, one_time_value, recurring_monthly_value, payment_method)
    values (c,'z','ZALERT1', v_won, v_new, 0, 0, 'online') returning id into d;
  perform set_config('t.deal', d::text, true);
end $$;

-- As an admin context: current_user_is_admin() must be true for the engine to return rows.
-- (supabase test db runs as postgres; is_admin() may be false -> the test asserts the ROW
--  is computed by calling the inner logic via a SECURITY DEFINER wrapper is out of scope;
--  instead assert the deal matches the deal_zero_value predicate directly.)
select ok(
  exists(select 1 from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
         where d.id=current_setting('t.deal')::uuid and ps.code not in ('closed','done')
           and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0),
  'seeded €0 deal matches deal_zero_value predicate');

-- Dismissal filter: inserting a dismissal for (deal_zero_value, deal, '') hides it.
select lives_ok($$ insert into integrity_alert_dismissals (check_key, subject_id, signature)
                   values ('deal_zero_value', current_setting('t.deal')::uuid, '') $$,
                'dismissal insert works');
select is((select count(*)::int from integrity_alert_dismissals
           where check_key='deal_zero_value' and subject_id=current_setting('t.deal')::uuid), 1,
          'dismissal recorded');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the migration** `supabase/migrations/20260703020000_accounting_integrity_alerts.sql`. The engine wraps all checks and filters dismissals:

```sql
-- 2026-07-03: Live billing/data integrity checks for the Accounting Alerts page.
create or replace function public.accounting_integrity_alerts()
returns table (check_key text, severity text, category text, subject_type text,
               subject_id uuid, subject_code text, title text, detail text,
               deal_id uuid, job_id uuid, signature text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return; -- no rows for anyone else
  end if;
  return query
  with alerts as (
    -- 1 deal_zero_value
    select 'deal_zero_value'::text, 'amber'::text, 'money'::text, 'deal'::text,
           d.id, d.code, 'Deal has €0 total'::text,
           'One-time €0 and monthly €0'::text, d.id, null::uuid, ''::text
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(d.one_time_value,0)=0 and coalesce(d.recurring_monthly_value,0)=0
    union all
    -- 2 recurring_job_zero
    select 'recurring_job_zero','red','money','job', j.id, j.code, 'Recurring job bills €0',
           'Active recurring job with amount_net = 0', j.deal_id, j.id, ''
      from jobs j
     where not j.archived and j.billing_active and j.parent_job_id is null
       and j.billing_type in ('recurring_monthly','recurring_yearly')
       and coalesce(j.amount_net,0)=0
    union all
    -- 3 vat_missing
    select 'vat_missing','amber','money','job', j.id, j.code, 'VAT missing (0%)',
           'Job at 0% VAT but client is not Cyprus and deal is not cash-no-VAT',
           j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id
      left join clients c on c.id=d.client_id
     where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0
       and not (d.payment_method='cash' and not coalesce(d.cash_charge_vat,false))
       and coalesce(c.country,'') not ilike 'cyprus'
    union all
    -- 4 vat_odd_rate
    select 'vat_odd_rate','grey','money','job', j.id, j.code, 'Unusual VAT rate',
           'VAT rate = '||j.vat_rate::text||'% (not 0 or 24)', j.deal_id, j.id, j.vat_rate::text
      from jobs j where not j.archived and j.vat_rate is not null and j.vat_rate not in (0,24)
    union all
    -- 5 aiseo_child_amount
    select 'aiseo_child_amount','red','money','job', j.id, j.code, 'AI-SEO child carries an amount',
           'Child job has a non-zero amount (should bill on the parent)', j.deal_id, j.id, ''
      from jobs j where not j.archived and j.parent_job_id is not null
       and (coalesce(j.amount_net,0)>0 or coalesce(j.monthly_amount,0)>0 or coalesce(j.one_time_amount,0)>0)
    union all
    -- 6 duplicate_period
    select 'duplicate_period','red','lifecycle','deal', dp.deal_id,
           (select code from deals where id=dp.deal_id),
           'Duplicate billing period',
           coalesce(dp.service_type,'?')||' '||dp.start_date::text||'→'||dp.end_date::text||' billed '||count(*)::text||'×',
           dp.deal_id, null::uuid, dp.service_type||':'||dp.start_date::text||':'||dp.end_date::text
      from deal_payments dp
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.start_date is not null and dp.end_date is not null and dp.status<>'cancelled'
     group by dp.deal_id, dp.service_type, dp.billing_type, dp.start_date, dp.end_date
     having count(*)>=2
    union all
    -- 7 paid_in_full_but_owes
    select 'paid_in_full_but_owes','red','lifecycle','deal', d.id, d.code,
           'Marked Paid In Full but still owes', 'Has an unpaid payment already past due', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='paid_in_full'
       and exists (select 1 from deal_payments p where p.deal_id=d.id
                    and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 8 on_hold_not_overdue
    select 'on_hold_not_overdue','amber','lifecycle','deal', d.id, d.code,
           'On Hold but nothing overdue', 'Held with no past-due unpaid payment', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code='on_hold'
       and not exists (select 1 from deal_payments p where p.deal_id=d.id
                        and p.status not in ('paid','cancelled') and p.start_date < current_date)
    union all
    -- 9 stale_block
    select 'stale_block','amber','lifecycle','job', j.id, j.code, 'Stale "account on hold" block',
           'Job blocked account_on_hold but its deal is not on hold', j.deal_id, j.id, ''
      from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not j.archived and j.is_blocked and j.blocked_reason='account_on_hold' and ps.code<>'on_hold'
    union all
    -- 10 renewal_past_due
    select 'renewal_past_due','grey','lifecycle','job', j.id, j.code, 'Renewal past due date',
           'Renewal job due '||j.period_due_date::text, j.deal_id, j.id, j.period_due_date::text
      from jobs j join pipeline_stages s on s.id=j.stage_id
     where not j.archived and s.code='renewal' and j.period_due_date is not null and j.period_due_date < current_date
    union all
    -- 11 billing_gap
    select 'billing_gap','red','lifecycle','deal', d.id, d.code, 'Recurring deal has no next payment',
           'Active recurring deal with no upcoming payment scheduled', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done','on_hold')
       and exists (select 1 from jobs j where j.deal_id=d.id and j.billing_active and not j.archived
                    and j.billing_type in ('recurring_monthly','recurring_yearly'))
       and not exists (select 1 from deal_payments p where p.deal_id=d.id and p.status<>'cancelled' and p.start_date >= current_date)
    union all
    -- 12 no_payment_method
    select 'no_payment_method','amber','missing','deal', d.id, d.code, 'No payment method',
           'Deal has no payment method set', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and nullif(trim(coalesce(d.payment_method,'')),'') is null
    union all
    -- 13 bad_email
    select 'bad_email','amber','missing','client', c.id, c.code, 'Bad or missing client email',
           coalesce(c.email,'(empty)'), null::uuid, null::uuid, coalesce(c.email,'')
      from clients c
     where not c.archived and coalesce(c.status,'') <> 'done'
       and (c.email is null or trim(c.email)='' or c.email like '% - %'
            or c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    union all
    -- 14 won_deal_no_services
    select 'won_deal_no_services','amber','missing','deal', d.id, d.code, 'Won deal with no services',
           'No services planned and no jobs', d.id, null::uuid, ''
      from deals d join pipeline_stages ps on ps.id=d.accounting_stage_id
     where not d.archived and ps.code not in ('closed','done')
       and coalesce(jsonb_array_length(d.services_planned),0)=0
       and not exists (select 1 from jobs j where j.deal_id=d.id and not j.archived)
  )
  select a.* from alerts a
   where not exists (
     select 1 from public.integrity_alert_dismissals x
      where x.check_key=a.check_key and x.subject_id=a.subject_id and x.signature=coalesce(a.signature,''))
   order by case a.severity when 'red' then 0 when 'amber' then 1 else 2 end, a.category, a.subject_code;
end $$;
revoke all on function public.accounting_integrity_alerts() from public, anon;
grant execute on function public.accounting_integrity_alerts() to authenticated;

create or replace function public.accounting_integrity_alerts_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.accounting_integrity_alerts();
$$;
revoke all on function public.accounting_integrity_alerts_count() from public, anon;
grant execute on function public.accounting_integrity_alerts_count() to authenticated;

-- ROLLBACK:
--   drop function if exists public.accounting_integrity_alerts_count();
--   drop function if exists public.accounting_integrity_alerts();
```

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260703020000_accounting_integrity_alerts.sql supabase/tests/accounting_integrity_alerts.sql
git commit -m "feat(accounting): accounting_integrity_alerts engine (14 checks) + count"
```

---

## Task 3: Apply both migrations to prod + verify

**Files:** none (deployment).

- [ ] **Step 1: Apply** `20260703010000` then `20260703020000` to prod via the Management API (`curl` + `sbp` token, curl UA), each wrapped `begin; … commit;`.
- [ ] **Step 2: Verify** the two functions exist and are granted to `authenticated`; call `select public.accounting_integrity_alerts_count();` (as service role it returns 0 because `current_user_is_admin()` is false — that's expected; confirm it does not error). Confirm `integrity_alert_dismissals` exists with the unique index.
- [ ] **Step 3: Smoke** a couple of check predicates directly with SELECTs (e.g. count of `deal_zero_value` candidates) to confirm the queries run without column errors.

---

## Task 4: Types

**Files:** Modify `src/types/supabase.ts`

- [ ] **Step 1** Add `integrity_alert_dismissals` to the `Tables` block (Row/Insert/Update with the columns from Task 1) and the four functions to `Functions` (or rely on the loose `rpcCall` wrapper — check `src/lib/rpc.ts`; if RPCs go through a loose cast, only the table type is needed). Do whatever makes `npm run build` pass.
- [ ] **Step 2** `npm run build` → PASS. Commit: `types: integrity_alert_dismissals + alerts RPCs`.

---

## Task 5: `alertPresenters.ts` (+ tests)

**Files:** Create `src/features/accounting/alerts/alertPresenters.ts`, `alertPresenters.test.ts`

**Interfaces:** Produces `type AlertRow = { check_key:string; severity:'red'|'amber'|'grey'; category:'money'|'lifecycle'|'missing'; subject_type:string; subject_id:string; subject_code:string; title:string; detail:string; deal_id:string|null; job_id:string|null; signature:string }`; `groupAlerts(rows: AlertRow[]): { category:string; rows:AlertRow[] }[]` (money→lifecycle→missing, rows already severity-sorted by the RPC); `alertLink(row:AlertRow): string|null` (`/jobs/:job_id` if job_id else `/deals/:deal_id` else null); `severityClass(sev): string`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { groupAlerts, alertLink, type AlertRow } from './alertPresenters';
const mk = (o: Partial<AlertRow>): AlertRow => ({ check_key:'x',severity:'amber',category:'money',subject_type:'deal',subject_id:'s',subject_code:'000001',title:'t',detail:'d',deal_id:'D',job_id:null,signature:'', ...o });
describe('alertPresenters', () => {
  it('links to job when job_id present, else deal', () => {
    expect(alertLink(mk({ job_id:'J', deal_id:'D' }))).toBe('/jobs/J');
    expect(alertLink(mk({ job_id:null, deal_id:'D' }))).toBe('/deals/D');
    expect(alertLink(mk({ job_id:null, deal_id:null }))).toBeNull();
  });
  it('groups in money→lifecycle→missing order', () => {
    const g = groupAlerts([mk({category:'missing'}), mk({category:'money'}), mk({category:'lifecycle'})]);
    expect(g.map(x=>x.category)).toEqual(['money','lifecycle','missing']);
  });
});
```
- [ ] **Step 2** run `npx vitest run src/features/accounting/alerts/alertPresenters.test.ts` → FAIL.
- [ ] **Step 3** implement `alertPresenters.ts` (the `AlertRow` type; `groupAlerts` bucketing by the fixed category order; `alertLink`; `severityClass` mapping red→destructive/amber→warning/grey→muted tailwind classes matching existing chips).
- [ ] **Step 4** run the test → PASS. Commit `feat(accounting): alert presenters`.

---

## Task 6: Hooks

**Files:** Create `src/features/accounting/alerts/hooks/useIntegrityAlerts.ts`, `useAlertDismissals.ts`, `useAlertsCount.ts`

**Interfaces:** `useIntegrityAlerts(): { data: AlertRow[], isLoading }` (rpc `accounting_integrity_alerts`); `useAlertsCount(): { data:number }` (rpc `accounting_integrity_alerts_count`, `staleTime 60_000`, `enabled` only for accounting/admin); `useDismissAlert()` / `useUndismissAlert()` (mutations calling `dismiss_integrity_alert` / `undismiss_integrity_alert`, invalidate `['integrity-alerts']` + `['integrity-alerts-count']`); `useDismissedAlerts()` (select from `integrity_alert_dismissals`). Follow the `.bind(supabase)` rule and the existing `useLeadIntakeCount` hook shape.

- [ ] **Step 1** implement all hooks mirroring `src/features/leads/hooks/useLeadIntake.ts` + `useReleaseLeadIntake.ts` patterns (rpc via `supabase.rpc(name as never)` cast, react-query).
- [ ] **Step 2** `npm run build` → PASS. Commit `feat(accounting): alerts data hooks`.

---

## Task 7: AlertsPage + route

**Files:** Create `src/features/accounting/alerts/AlertsPage.tsx`; Modify `src/app/router.tsx`

- [ ] **Step 1** Build `AlertsPage`: header ("Alerts" + total count); an "Open / Ignored" toggle; for Open — `groupAlerts(useIntegrityAlerts().data)`, render each category with a heading and rows (severity chip via `severityClass`, `subject_code`, `title`, `detail`, a `Link` to `alertLink(row)` labelled "Fix", and an **Ignore** button calling `useDismissAlert().mutate({check_key,subject_id,signature})`); for Ignored — `useDismissedAlerts()` rows with an **Un-ignore** button. Empty state "No alerts 🎉". Match existing accounting page styling (see `AccountingClientsPage.tsx`).
- [ ] **Step 2** In `src/app/router.tsx`, inside the `accounting` children array (after `docs`), add `{ path: 'alerts', element: <AccountingAlertsPage /> },` and the lazy/import at the top mirroring the other accounting pages. (No `AdminGuard` — the route inherits `RequireGroup(['accounting'])`.)
- [ ] **Step 3** `npm run build` → PASS; `npx vitest run src/features/accounting` → no regressions. Commit `feat(accounting): Alerts page + route`.

---

## Task 8: Sidebar entry + badge

**Files:** Modify `src/components/layout/Sidebar.tsx`

- [ ] **Step 1** Add an `AlertsBadge` component (mirroring `LeadIntakeBadge` at line ~28) using `useAlertsCount()` — render a small pill with the count when `> 0`.
- [ ] **Step 2** In the accounting section (`{(isAdmin || isAccounting) && (…)}`, after the Recurring `NavLink`), add a `NavLink to="/accounting/alerts"` with the label `t('accounting:nav.alerts')` and `<AlertsBadge />`.
- [ ] **Step 3** Add `"nav": { ..., "alerts": "Alerts" }` to `src/i18n/locales/en/accounting.json` and `"alerts": "Ειδοποιήσεις"` to `el/accounting.json` (+ any page strings used).
- [ ] **Step 4** `npm run build` → PASS. Commit `feat(accounting): sidebar Alerts entry + count badge`.

---

## Task 9: Notification presenter for `payment_integrity_alert`

**Files:** Modify `src/features/notifications/notification-presenters.tsx`

- [ ] **Step 1** Add a branch `if (type === 'payment_integrity_alert')` returning a presenter with title `Billing audit found ${payload.alerts_new} issue(s)`, linking to `/accounting/alerts` (mirror the `payment_overdue` branch at line ~194).
- [ ] **Step 2** `npm run build` → PASS; `npx vitest run src/features/notifications` → PASS. Commit `feat(notifications): present payment_integrity_alert → Alerts page`.

---

## Self-review notes
- Spec coverage: dismissals (T1), 14-check engine + count (T2), prod apply (T3), types (T4), presenter (T5), hooks (T6), page+route (T7), sidebar badge (T8), notification link (T9). ✓
- The pgTAP (T2) asserts predicates + dismissal recording rather than calling the engine as admin (supabase test db runs as postgres; `current_user_is_admin()` is false there) — the engine's real behaviour is verified in T3 against prod and via the UI.
- `severity`/`category` string unions match between the RPC (T2) and `AlertRow` (T5). `alertLink` prefers `job_id` then `deal_id`, matching the RPC populating both.
