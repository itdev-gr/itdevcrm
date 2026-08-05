-- =============================================================================
-- Domain expiry → renewal due dates. One-off data fix, 27 rows.
-- Evidence + full mapping: docs/system-analysis/2026-08-05-domain-expiry-reconciliation.md
-- Plan:                    docs/superpowers/plans/2026-08-05-domain-expiry-renewal-dates.md
--
-- WHY: all 27 'domains' recurring_yearly rows were seeded with start_date = the
--   deal-creation date and end_date = +1 year. Neither has any relation to the
--   domain's registry expiry. Because deal_next_due() reads min(start_date) of
--   the unpaid rows, all 27 deals reported a past-due €20 they do not yet owe;
--   18 sat in on_hold, 15 of them for that reason alone.
--
-- WHAT: rewrite start_date (= the date the client must pay us again, per
--   deal_next_due/target_accounting_stage) to the real expiry, end_date to
--   expiry + 1 year, and reset the stale 'overdue' status. 26 of 27 rows are
--   'overdue' even though mark_overdue_payments() only flips rows whose
--   end_date is already past (20260610000004 §3) and every end_date here is in
--   2027 — the status was seeded/hand-set and nothing ever resets it, so this
--   migration must.
--
-- SOURCE OF TRUTH: Domains_Expiry_List_Final.xlsx (48 rows) for 22 of the 27;
--   deal_payments.label for 5 rows whose spreadsheet cells are Excel serials
--   decoding to the label misread US-style (5/5 exact — see the reconciliation
--   doc). The 21 'Had Deal = no' domains are out of scope.
--
-- NO FUNCTION BODIES ARE TOUCHED, so the usual md5(pg_get_functiondef) drift
--   check does not apply to this migration.
--
-- EXPECTED SIDE EFFECT: deal_payments_reconcile_stage fires AFTER UPDATE and
--   releases deals whose only past-due row was this one — ~15 deals leave
--   on_hold, their jobs unblock and SEO cards move to 'renewal'. That is the
--   intended correction. 000041 (partial_payment, open finding A2) and 000298
--   (closed) get corrected dates but no stage move.
--
-- ROLLBACK:
--   update public.deal_payments dp
--      set start_date = b.old_start_date,
--          end_date   = b.old_end_date,
--          status     = b.old_status,
--          label      = b.old_label
--     from public.deal_payments_domain_expiry_backup_20260805 b
--    where dp.id = b.payment_id;
--   drop table public.deal_payments_domain_expiry_backup_20260805;
--   (Stage moves triggered by the forward run do NOT roll back automatically;
--    re-running reconcile_deal_stage per deal restores them.)
-- =============================================================================

-- 1. Backup ------------------------------------------------------------------
create table if not exists public.deal_payments_domain_expiry_backup_20260805 (
  payment_id     uuid primary key,
  deal_code      text,
  old_start_date date,
  old_end_date   date,
  old_status     text,
  old_label      text,
  backed_up_at   timestamptz not null default now()
);

insert into public.deal_payments_domain_expiry_backup_20260805
  (payment_id, deal_code, old_start_date, old_end_date, old_status, old_label)
select dp.id, d.code, dp.start_date, dp.end_date, dp.status, dp.label
  from public.deal_payments dp
  join public.deals d on d.id = dp.deal_id
 where dp.service_type = 'domains'
on conflict (payment_id) do nothing;

-- 2. The re-dating -----------------------------------------------------------
-- start_date = registry expiry (the date the client must pay us again).
-- end_date   = expiry + 1 year (recurring_yearly period close).
-- status     : 'overdue' is stale once the due date is in the future.
-- label      : held the expiry as free text because start_date was wrong. Now
--              redundant and, on 6 rows, actively contradictory — rewritten to
--              match. Drop this one assignment if you want labels left alone.
with fix (payment_id, new_start, new_end) as (values
  ('a8a611ec-b93e-4b41-9f32-f7963c16ddeb'::uuid, date '2027-05-28', date '2028-05-28'),  -- 000041 allinmykonos.com
  ('8d41caad-0d4f-489f-b7e1-9a06ab23e8fe'::uuid, date '2026-09-03', date '2027-09-03'),  -- 000054 bluesearestaurantafitos.com
  ('0df209c8-da86-4795-9f07-fb8b13a19f5e'::uuid, date '2028-06-05', date '2029-06-05'),  -- 000079 navergo.gr
  ('b5b9c215-2d79-40cc-afd7-dbed82f501e3'::uuid, date '2027-11-28', date '2028-11-28'),  -- 000090 dctrade.gr
  ('a3cc1fbc-112e-42cd-a584-2b4c09aa6b61'::uuid, date '2027-03-09', date '2028-03-09'),  -- 000114 authenticsantorinitours.com
  ('7a55543a-861f-42db-8026-9de407dcedb2'::uuid, date '2028-03-14', date '2029-03-14'),  -- 000136 themaedu.gr
  ('22ba9ca5-442c-43a7-9412-a0abd4c415a6'::uuid, date '2028-03-17', date '2029-03-17'),  -- 000178 eleftheriadisteletes.gr
  ('611bc893-21b3-4b60-82ec-98c6cd8c219e'::uuid, date '2028-03-17', date '2029-03-17'),  -- 000205 resetgym.gr
  ('bb3a97cf-285d-45b4-8ddf-54877173e208'::uuid, date '2028-03-06', date '2029-03-06'),  -- 000222 juniorcatering.gr      [label]
  ('b96ce006-dccd-4411-a715-22a0aa8c04d9'::uuid, date '2027-07-15', date '2028-07-15'),  -- 000247 tasy.gr
  ('5837cd06-78a9-4e75-8f2f-52c6f51ea1c5'::uuid, date '2028-06-19', date '2029-06-19'),  -- 000249 epikentroedu.gr
  ('5843f008-aac4-4d0b-b474-272de124ed69'::uuid, date '2027-07-10', date '2028-07-10'),  -- 000261 transfertoursthassos.com
  ('801b5305-dee9-426e-8f77-ff86e181785e'::uuid, date '2027-03-27', date '2028-03-27'),  -- 000270 rentaboatzakynthos.com
  ('f8cedeb0-2f4f-462a-88c4-328ae7732cb6'::uuid, date '2026-11-19', date '2027-11-19'),  -- 000277 interoil.gr
  ('ecc8fe0b-67f4-490a-a8c2-30a31718b993'::uuid, date '2028-05-09', date '2029-05-09'),  -- 000289 thronosyachtingserifos.gr [label]
  ('20534b79-c2c0-485e-8689-347cd2d0df66'::uuid, date '2027-05-21', date '2028-05-21'),  -- 000294 imperialsantorini.com
  ('9b2cefe6-9d2d-47f0-8f18-c8385fbf8068'::uuid, date '2027-04-23', date '2028-04-23'),  -- 000298 funeralskostas.com
  ('ab76a3c2-fe42-47b4-86bc-7a54fe383baf'::uuid, date '2027-06-07', date '2028-06-07'),  -- 000314 aegeansafran.com        [label]
  ('6e91fc7c-0fb7-49f0-826f-31ae632d7a92'::uuid, date '2027-08-11', date '2028-08-11'),  -- 000316 drkarakalpakis.gr       [label]
  ('9edfce7c-970f-4fa0-87dd-149a3af99683'::uuid, date '2028-05-11', date '2029-05-11'),  -- 000338 tritonasmarinepatmos.gr [label]
  ('63c5b02a-b032-4bdb-8012-f3296812767e'::uuid, date '2029-03-29', date '2030-03-29'),  -- 000404 opawey.com
  ('fec3c44c-eeac-4966-8c46-c8699bb739b4'::uuid, date '2027-02-24', date '2028-02-24'),  -- 000406 emamonoseis.gr
  ('537e8414-1896-4c27-9617-40c13476bcd0'::uuid, date '2027-11-04', date '2028-11-04'),  -- 000431 servistasathens.gr
  ('6707755a-0131-4c0c-b91e-2be167456f77'::uuid, date '2027-05-19', date '2028-05-19'),  -- 000447 transferincorfu.com
  ('32f81a51-6f6b-40ea-9eae-2f1aa3bf9657'::uuid, date '2027-05-13', date '2028-05-13'),  -- 000473 freedomwheels.gr
  ('3f54c93c-9a4b-4a78-9c31-c3c372c09ee4'::uuid, date '2027-06-08', date '2028-06-08'),  -- 000513 vassilisexarchos.com
  ('d74be127-b1bd-4db5-9cd2-4414c4c38e8f'::uuid, date '2028-02-15', date '2029-02-15')   -- 005042 mpfurs.com
)
update public.deal_payments dp
   set start_date = f.new_start,
       end_date   = f.new_end,
       status     = case when dp.status = 'overdue' then 'pending' else dp.status end,
       label      = to_char(f.new_start, 'DD/MM/YYYY')
  from fix f
 where dp.id = f.payment_id
   and dp.status <> 'paid';   -- never rewrite a settled period

-- 3. Post-conditions (abort the whole file if either fails) ------------------
do $$
declare n int;
begin
  select count(*) into n
    from public.deal_payments_domain_expiry_backup_20260805;
  if n <> 27 then
    raise exception 'expected 27 backed-up domains rows, found %', n;
  end if;

  select count(*) into n
    from public.deal_payments dp
   where dp.service_type = 'domains'
     and dp.status <> 'paid'
     and (dp.start_date <= current_date
          or dp.end_date <> dp.start_date + interval '1 year'
          or dp.status not in ('pending','paid'));
  if n <> 0 then
    raise exception 'domains rows still violating the due-date invariant: %', n;
  end if;
end $$;
