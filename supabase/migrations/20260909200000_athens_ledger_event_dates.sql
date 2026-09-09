-- =============================================================================
-- Αθηναϊκή απόδοση ημερομηνιών στο χρηματοοικονομικό reporting (audit
-- 2026-09-09, απόφαση owner #8 — docs/tech/accounting/report-audit-2026-09-09.md §1d).
--
-- Πρόβλημα: paid_at::date κόβει σε UTC μέρα, οπότε πληρωμή 00:00-03:00 ώρα
-- Ελλάδας πέφτει στην προηγούμενη μέρα — και σε αλλαγή μήνα, στον προηγούμενο
-- ΜΗΝΑ (P&L, period locks). Μετρημένο 2026-09-09: 1 row / €124.00 (καμία
-- month-boundary περίπτωση ακόμα — προληπτική διόρθωση).
--
-- Αλλαγές, ΜΑΖΙ ώστε view και guard να μη χάσουν ποτέ συγχρονισμό:
-- 1. accounting_ledger_v: event_date/period και στα δύο arms γίνονται
--    coalesce((paid_at at time zone 'Europe/Athens')::date, start_date).
--    Οι consumers (pl_summary_for_range, accounting_pl_summary_v,
--    useLedger, api/report-pdf) διαβάζουν το view → ακολουθούν αυτόματα.
-- 2. money_period_lock_guard(): τα 3 σημεία που υπολογίζουν period από
--    paid_at::date παίρνουν το ίδιο Athens cast — αλλιώς μια πληρωμή θα
--    εμφανιζόταν σε μήνα Χ αλλά θα κλειδωνόταν με τον μήνα Χ-1.
--
-- Drift check (σύμβαση repo): live md5(pg_get_functiondef) του
-- money_period_lock_guard επιβεβαιώθηκε 2026-09-09 στο audit (Task 6 fix):
--   pre  8e0e2f5d0d2bd1fc3bbba4e675f5be0e  (= financial-controls.md post-hardening)
--   post af2d87e7f97366f10b2939cbd5f76454  (applied 2026-09-09· 1 shifted row
--        €124.00, 0 month-shifted — καμία κλειδωμένη περίοδος δεν άλλαξε)
-- Το view δεν αλλάζει στήλες/τύπους — μόνο τις εκφράσεις event_date/period.
-- ΣΗΜΕΙΩΣΗ ιστορικότητας: υπάρχοντα κλειδώματα κρίθηκαν με UTC περίοδο· η
-- μοναδική σημερινή boundary γραμμή (€124, 27→28/8) δεν αλλάζει μήνα, άρα
-- κανένα ιστορικό νούμερο κλειδωμένης περιόδου δεν μετακινείται σήμερα.
-- =============================================================================

-- 1. Ledger view — ίδια λίστα στηλών με 20260827150000 (append-safe replace).
create or replace view public.accounting_ledger_v
with (security_invoker = true) as
  select 'in'::text as direction,
         coalesce((dp.paid_at at time zone 'Europe/Athens')::date, dp.start_date) as event_date,
         to_char(coalesce((dp.paid_at at time zone 'Europe/Athens')::date, dp.start_date)::timestamptz, 'YYYY-MM') as period,
         dp.status,
         dp.amount_net,
         dp.vat_amount,
         dp.amount_gross,
         dp.service_type as category_key,
         c.name as counterparty,
         dp.billing_type,
         'deal_payments'::text as source_table,
         dp.id as source_id,
         d.id as deal_id,
         d.code as deal_code
    from deal_payments dp
    join deals d on d.id = dp.deal_id
    join clients c on c.id = d.client_id
  union all
  select 'out'::text as direction,
         coalesce((e.paid_at at time zone 'Europe/Athens')::date, e.start_date) as event_date,
         to_char(coalesce((e.paid_at at time zone 'Europe/Athens')::date, e.start_date)::timestamptz, 'YYYY-MM') as period,
         e.status,
         e.amount_net,
         e.vat_amount,
         e.amount_gross,
         cat.key as category_key,
         e.vendor as counterparty,
         e.billing_type,
         'expenses'::text as source_table,
         e.id as source_id,
         null::uuid as deal_id,
         null::text as deal_code
    from expenses e
    join expense_categories cat on cat.id = e.category_id;

-- 2. Lock guard — μόνο τα period casts αλλάζουν· λογική/πεδία απαράλλαχτα
--    από το 20260828120000_lock_guard_hardening.sql.
create or replace function public.money_period_lock_guard()
returns trigger language plpgsql as $$
declare
  v_old_period    text;
  v_new_period    text;
  v_old_locked    boolean := false;
  v_new_locked    boolean := false;
  v_money_changed boolean;
  v_report_period text;
begin
  -- INSERT: no OLD row exists. A brand-new row landing as status='paid' in a
  -- locked month is a closed-month violation exactly like an UPDATE/DELETE
  -- would be — block it before it is ever written.
  if tg_op = 'INSERT' then
    if new.status = 'paid' then
      v_new_period := to_char(coalesce((new.paid_at at time zone 'Europe/Athens')::date, new.start_date), 'YYYY-MM');
      if exists (select 1 from public.accounting_period_locks l where l.period = v_new_period) then
        raise exception 'period % is locked — cannot insert paid rows into a closed month', v_new_period;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE / DELETE: OLD always exists from here on.
  v_old_period := to_char(coalesce((old.paid_at at time zone 'Europe/Athens')::date, old.start_date), 'YYYY-MM');
  v_old_locked := exists (select 1 from public.accounting_period_locks l where l.period = v_old_period);

  if tg_op = 'DELETE' then
    if old.status = 'paid' and v_old_locked then
      raise exception 'period % is locked — paid rows cannot be deleted (unlock the month first)', v_old_period;
    end if;
    return old;
  end if;

  -- UPDATE: also compute NEW's period/lock so a paid row cannot be re-dated
  -- INTO a locked month from an unlocked one, nor OUT of a locked month into
  -- an unlocked one — either direction is a closed-month money change.
  v_new_period := to_char(coalesce((new.paid_at at time zone 'Europe/Athens')::date, new.start_date), 'YYYY-MM');
  v_new_locked := exists (select 1 from public.accounting_period_locks l where l.period = v_new_period);

  if (old.status = 'paid' or new.status = 'paid') and (v_old_locked or v_new_locked) then
    if tg_table_name = 'deal_payments' then
      v_money_changed :=
        new.amount_net is distinct from old.amount_net
        or new.vat_rate is distinct from old.vat_rate
        or new.status is distinct from old.status
        or new.paid_at is distinct from old.paid_at
        or new.start_date is distinct from old.start_date
        or new.service_type is distinct from old.service_type;
    else -- public.expenses: no service_type column; guard vendor + category_id instead.
      v_money_changed :=
        new.amount_net is distinct from old.amount_net
        or new.vat_rate is distinct from old.vat_rate
        or new.status is distinct from old.status
        or new.paid_at is distinct from old.paid_at
        or new.start_date is distinct from old.start_date
        or new.vendor is distinct from old.vendor
        or new.category_id is distinct from old.category_id;
    end if;

    if v_money_changed then
      v_report_period := case when v_new_locked then v_new_period else v_old_period end;
      raise exception 'period % is locked — unlock the month before editing paid rows', v_report_period;
    end if;
  end if;

  return new;
end $$;

-- ROLLBACK:
-- -- view: re-apply the 20260827150000 definition (UTC paid_at::date).
-- -- guard: re-apply money_period_lock_guard from 20260828120000_lock_guard_hardening.sql
-- --   (expected md5 8e0e2f5d0d2bd1fc3bbba4e675f5be0e).
