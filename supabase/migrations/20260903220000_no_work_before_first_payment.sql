-- =============================================================================
-- 2026-09-03 (owner, repeatedly: «μου ανοίγουν jobs μόλις πάει στο new στο
-- accounting και όχι στο partially paid ή fully paid»):
-- work was starting before a single euro had arrived.
--
-- WHAT WAS ACTUALLY HAPPENING — the previous fixes missed it because they all
-- looked at the release side, and the leak is on the creation side:
--
--   1. Jobs are born at deal INSERT, not at payment. deals_seed_payments
--      -> deal_payments_seed_after_insert -> seed_deal_jobs_and_payments
--      -> release_billing_jobs_for_deal, which inserts one job per planned
--      service. A deal is always created at accounting stage `new`, so the
--      rows exist from second zero. That part is CORRECT and stays: accounting
--      bills off them (deal_payment_lines.job_id references them).
--
--   2. The announcement went out immediately. jobs_notify_group and
--      email_notify_new_job are both AFTER INSERT ON jobs and their only guard
--      is `assigned_group_id is not null` — which the seeder always sets. In
--      the last 90 days that queued 319 internal "new job" emails and 237
--      in-app notifications, the most recent one today. The team is told,
--      opens the card, and starts working. THAT is the "job opening".
--
--   3. Nothing defended the off-board state. The seeder parks jobs with
--      stage_id null, and the kanban hides those (kanbanGrouping.ts:85), but
--      enforce_no_stage_move_when_blocked only checks whether the CLIENT is
--      blocked, not the job. Deal 006042 (31/08, 1.180 € + 120 €, never paid)
--      has three cards sitting on the boards at `planning`/`active`.
--
-- Live evidence at the time of writing: 10 open jobs across 5 never-paid deals,
-- newest 006148-WEBDEV (700 €) created today; 5 in July, 4 in August, 1 in
-- September.
--
-- THE RULE (owner-confirmed today):
--   A job on a deal that has NEVER been paid — no partial, no full — is born
--   blocked with reason 'awaiting_first_payment', stays off-board, cannot be
--   dragged onto a board, and announces NOTHING. It is announced and released
--   the first time the deal reaches Partial Payment or Paid in Full.
--   Renewals are out of scope: the gate is the FIRST payment only, so the 72
--   on-board cards of existing clients sitting at awaiting_payment are
--   untouched.
--
-- Drift check (md5(pg_get_functiondef(oid)) before this migration):
--   release_billing_jobs_for_deal      dad542927c4a5775cf2247531467fea0
--   jobs_notify_group                  78af210d8d623a2d8f405e0aac228bdd
--   email_notify_new_job               8ca9f13e0f73647dc11f80429fd60240
--   release_deal_jobs                  73517c7be045a77d9b83ee4de22f5e7d
--   enforce_no_stage_move_when_blocked b4239223c9baffb8a225782d8b04b99d
--
-- After applying (verified in prod 2026-09-03):
--   announce_job                       6ada725fcb60392b5f4c427249fc24d0  (new)
--   jobs_notify_on_release             83f21715c90d5b13862dc4ff5c511295  (new)
--   jobs_notify_group                  8b5a6f66ac634aadf4c5f0282241dab4
--   release_billing_jobs_for_deal      0b77463fc328aafc0280e7b4d2f28e83
--   release_deal_jobs                  e33777db0c8c9dd0ef2623c913fa4bc0
--   enforce_no_stage_move_when_blocked a270eeb893f08d712cbd8ba96795cbf3
--   email_notify_new_job               dropped with trg_email_notify_new_job
--
-- Post-apply state: 0 off-board open jobs left on a never-paid deal (the 4+1
-- that remain are cards already ON a board, left for the owner to judge
-- one by one); 006148-WEBDEV (700 €) gated by the backfill; renewals
-- untouched at exactly 72 on-board cards in awaiting_payment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. One place that announces a job, so insert-time and release-time cannot
--    drift apart. Body is the union of the two existing trigger functions.
-- -----------------------------------------------------------------------------
create or replace function public.announce_job(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  j record;
  m record;
  v_client_name text;
begin
  select * into j from public.jobs where id = p_job_id;
  if j is null or j.assigned_group_id is null then
    return;
  end if;

  select name into v_client_name from public.clients where id = j.client_id;

  -- In-app: the assigned group plus every admin, never the actor themselves.
  for m in
    select r.user_id from (
      select p.user_id
        from public.user_groups ug
        join public.profiles p on p.user_id = ug.user_id
       where ug.group_id = j.assigned_group_id
         and p.is_active and p.email is not null and p.email <> ''
      union
      select p.user_id
        from public.profiles p
       where p.is_admin
         and p.is_active and p.email is not null and p.email <> ''
    ) r
    where r.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      m.user_id,
      'job_created',
      jsonb_build_object(
        'job_id', j.id,
        'service_type', j.service_type,
        'client_name', v_client_name,
        'target_job_id', j.id,
        'parent_type', 'job',
        'parent_id', j.id
      )
    );
  end loop;

  -- Email: group members only (unchanged recipient set and dedupe key).
  if public.email_automation_enabled('internal_new_job') then
    for m in
      select p.email
        from public.user_groups ug
        join public.profiles p on p.user_id = ug.user_id
       where ug.group_id = j.assigned_group_id
         and p.email is not null and p.email <> ''
    loop
      insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
      values ('internal', m.email, 'internal_new_job',
              jsonb_build_object('service_type', j.service_type, 'client_name', v_client_name,
                                 'deal_id', j.deal_id),
              'job:' || j.id || ':' || m.email);
    end loop;
  end if;
end $$;

revoke execute on function public.announce_job(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. The two INSERT triggers: same behaviour, but silent while blocked.
-- -----------------------------------------------------------------------------
create or replace function public.jobs_notify_group()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_group_id is null then
    return new;
  end if;
  -- Blocked at birth = waiting for the first payment (or an on-hold account).
  -- Announcing here is exactly the bug: jobs_notify_on_release does it later.
  if new.is_blocked then
    return new;
  end if;
  perform public.announce_job(new.id);
  return new;
end $$;

-- email_notify_new_job's work now lives inside announce_job, which
-- jobs_notify_group already calls. Keeping the trigger function as a no-op
-- return would leave a second, silent copy of the recipient logic to rot, so
-- the trigger is dropped instead and the function with it.
drop trigger if exists trg_email_notify_new_job on public.jobs;
drop function if exists public.email_notify_new_job();

-- -----------------------------------------------------------------------------
-- 3. Announce once, when the first-payment gate opens.
--    Scoped to 'awaiting_first_payment' on purpose: account_on_hold jobs cycle
--    blocked/unblocked repeatedly and must not re-announce every time.
-- -----------------------------------------------------------------------------
create or replace function public.jobs_notify_on_release()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.announce_job(new.id);
  return new;
end $$;

drop trigger if exists jobs_notify_on_release on public.jobs;
create trigger jobs_notify_on_release
  after update on public.jobs
  for each row
  when (old.is_blocked and not new.is_blocked
        and old.blocked_reason = 'awaiting_first_payment')
  execute function public.jobs_notify_on_release();

-- -----------------------------------------------------------------------------
-- 4. The seeder: born blocked while the deal has never been paid.
--    Only the WORK cards are gated. The ai_seo parent is billing_only with no
--    group — blocking it would mean nothing and only confuse accounting.
-- -----------------------------------------------------------------------------
create or replace function public.release_billing_jobs_for_deal(target_deal_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare d record; service jsonb; st text; bt text; v_amount numeric; v_vat numeric;
        v_group uuid; v_country text; inserted int := 0;
        v_parent uuid; v_web_group uuid; v_local_group uuid;
        v_unpaid boolean; v_reason text; v_at timestamptz;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;
  select country into v_country from public.clients where id = d.client_id;
  v_vat := case
    when d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false) then 0.00
    else public.vat_rate_for_country(v_country) end;

  -- Never paid = no full-payment stamp AND no settled payment row. A service
  -- added later to an ALREADY paid deal is therefore born open, as before.
  v_unpaid := d.first_paid_in_full_at is null
              and not exists (select 1 from public.deal_payments p
                               where p.deal_id = d.id and p.paid_at is not null);
  v_reason := case when v_unpaid then 'awaiting_first_payment' else null end;
  v_at     := case when v_unpaid then now() else null end;

  for service in select * from jsonb_array_elements(d.services_planned) loop
    st := service->>'service_type';
    bt := service->>'billing_type';
    if st not in ('web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise','domains') then continue; end if;
    if bt not in ('one_time','recurring_monthly','recurring_yearly') then continue; end if;
    -- 2026-08-31 (006042): never open a job for an unpriced service row —
    -- defense in depth behind the convert_lead_to_client validation (other
    -- deal-insert paths must not spawn phantom 0-euro jobs either). The AI SEO
    -- 0-euro children below are unaffected: they are explicit inserts, not
    -- services_planned rows.
    if coalesce(nullif(service->>'one_time_amount','')::numeric, 0)
       + coalesce(nullif(service->>'monthly_amount','')::numeric, 0)
       + coalesce(nullif(service->>'setup_fee','')::numeric, 0) <= 0 then continue; end if;
    if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and billing_type = coalesce(service->>'billing_type','one_time') and not archived) then continue; end if;

    v_amount := coalesce(case when bt = 'one_time' then nullif(service->>'one_time_amount','')::numeric
                              else nullif(service->>'monthly_amount','')::numeric end, 0);

    -- AI SEO: off-board billing record + off-board web & local work cards (placed at Fully Paid).
    if st = 'ai_seo' then
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active,
          status, stage_id, owner_user_id, started_at, code)
        values (d.id, d.client_id, 'ai_seo', bt, v_amount, v_vat,
          nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
          nullif(service->>'setup_fee','')::numeric, 'AI SEO', false, true, true,
          'active', null, null, now(), d.code)
        returning id into v_parent;

      select id into v_web_group from public.groups where code='web_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'web_seo', bt, 0, v_vat, 'AI SEO — Web',
          true, false, false, 'active', null, v_web_group, v_parent, now(), d.code,
          v_unpaid, v_reason, v_at);  -- OFF-BOARD until Fully Paid

      select id into v_local_group from public.groups where code='local_seo';
      insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, parent_job_id, started_at, code,
          is_blocked, blocked_reason, blocked_at)
        values (d.id, d.client_id, 'local_seo', bt, 0, v_vat, 'AI SEO — Local',
          true, false, false, 'active', null, v_local_group, v_parent, now(), d.code,
          v_unpaid, v_reason, v_at);  -- OFF-BOARD until Fully Paid

      inserted := inserted + 1;
      continue;
    end if;

    select id into v_group from public.groups where code = st;
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        one_time_amount, monthly_amount, setup_fee, title, stage_id, assigned_group_id, owner_user_id,
        status, billing_active, is_custom, started_at, code,
        is_blocked, blocked_reason, blocked_at)
      values (d.id, d.client_id, st, bt, v_amount, v_vat,
        nullif(service->>'one_time_amount','')::numeric, nullif(service->>'monthly_amount','')::numeric,
        nullif(service->>'setup_fee','')::numeric, initcap(replace(st, '_', ' ')),
        null, v_group, null,                       -- OFF-BOARD: stage_id null, no owner yet
        'active', true, false, now(), d.code,
        v_unpaid, v_reason, v_at);
    inserted := inserted + 1;
  end loop;
  return inserted;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Release paths must recognise the new reason.
--    release_jobs_for_deal already sets is_blocked = should_block (false on a
--    full release) when it places an off-board job, so it needs no change;
--    release_deal_jobs' catch-all filters on reason and does.
-- -----------------------------------------------------------------------------
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- (0) Onboarded SEO -> renewal sync (unchanged).
  for r in select j.id from public.jobs j
            where j.deal_id = p_deal_id and not j.archived
              and j.service_type in ('web_seo','local_seo')
              and j.onboarded_at is not null
  loop
    if public.seo_sync_renewal_job(r.id) then
      update public.jobs
         set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
       where id = r.id;
    end if;
  end loop;

  -- (1a) SEO never onboarded, off-board -> New project + mark + unblock.
  --      null->new_project fires jobs_seo_onboarding_email.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) SEO never onboarded, already on a board -> mark + unblock; leave in place.
  --      (Placed earlier by release_jobs_for_deal / partial / ai_seo child; email
  --      already fired on that placement.)
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is not null;

  -- (2) ads/social_media/maintenance -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('ads','social_media','maintenance')
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  --     'awaiting_first_payment' added 2026-09-03: the first-payment gate.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending','awaiting_first_payment')
     and service_type not in ('web_seo','local_seo','ads','social_media','maintenance');
end $$;

-- -----------------------------------------------------------------------------
-- 6. The guard that was missing: an unpaid job cannot be dragged onto a board.
--    This is what would have stopped 006042.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_no_stage_move_when_blocked()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.stage_id is distinct from new.stage_id then
    if public.is_client_blocked(new.client_id) and not public.current_user_is_admin() then
      raise exception 'client_blocked' using errcode = 'P0001', hint = 'unblock_client_first';
    end if;
    -- Work may not start before the first payment. Admins are not exempt: the
    -- accounting stage move is the intended way through, and it unblocks the
    -- job for everyone in the same statement (the release path clears the
    -- reason before touching stage_id).
    if new.is_blocked and new.blocked_reason = 'awaiting_first_payment'
       and new.stage_id is not null then
      raise exception 'awaiting_first_payment'
        using errcode = 'P0001', hint = 'deal_must_reach_partial_or_full_payment';
    end if;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Backfill, deliberately narrow: gate the jobs that are still OFF-BOARD on a
--    never-paid deal. Cards already placed on a board are left alone — work may
--    genuinely have been done on them (006042 x3, 006992-LOCALSEO,
--    006016-WEBDEV) and pulling them out from under the team is the owner's
--    call, not a migration's.
-- -----------------------------------------------------------------------------
update public.jobs j
   set is_blocked = true,
       blocked_reason = 'awaiting_first_payment',
       blocked_at = now()
  from public.deals d
 where d.id = j.deal_id
   and not j.archived
   and j.stage_id is null
   and not j.is_blocked
   and j.assigned_group_id is not null
   and d.first_paid_in_full_at is null
   and not exists (select 1 from public.deal_payments p
                    where p.deal_id = d.id and p.paid_at is not null);

-- ROLLBACK:
--   Restore the five functions from their pre-change definitions (md5s in the
--   header identify them), then:
--     drop trigger if exists jobs_notify_on_release on public.jobs;
--     drop function if exists public.jobs_notify_on_release();
--     drop function if exists public.announce_job(uuid);
--     -- and recreate email_notify_new_job() + trg_email_notify_new_job from
--     -- 20260619120000 (or whichever migration last defined it).
--   Existing gated rows can be freed with:
--     update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null
--      where blocked_reason='awaiting_first_payment';
