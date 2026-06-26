-- Payment-driven block lifecycle (1/4): helpers + rewritten hold trigger.
-- Reads payment dates only (start_date = the due date accounting entered) — never writes them.
-- AI SEO parent + its web/local children are blocked/unblocked as ONE unit: we block ALL
-- of a deal's open jobs EXCEPT the website (web_dev) and hosting. On Paid In Full we unblock
-- and move Web/Local SEO -> 'renewal', social/ads -> 'active' (AI SEO billing parent has no
-- work stage, so it is just unblocked).

create or replace function public.target_accounting_stage(next_due date, today date)
returns text language sql immutable as $$
  select case
    when next_due is null then 'paid_in_full'
    when next_due <= today then 'on_hold'
    when next_due <= today + 7 then 'awaiting_payment'
    else 'paid_in_full'
  end;
$$;

-- Earliest unpaid DUE date (start_date) for a deal. Read-only.
create or replace function public.deal_next_due(p_deal_id uuid)
returns date language sql stable as $$
  select min(dp.start_date) from public.deal_payments dp
   where dp.deal_id = p_deal_id and dp.status <> 'paid';
$$;

-- Block every open job of the deal except web_dev + hosting (includes AI SEO parent,
-- which has a null work stage, + web/local children + social + ads). Idempotent.
create or replace function public.block_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jobs j
     set is_blocked = true, blocked_reason = 'account_on_hold', blocked_at = now()
   where j.deal_id = p_deal_id and not j.archived and not j.is_blocked
     and j.service_type not in ('web_dev','hosting')
     and (j.stage_id is null
          or not exists (select 1 from public.pipeline_stages s where s.id = j.stage_id and s.is_terminal));
end $$;

-- Unblock the deal's account_on_hold jobs and move them to their renewal lane.
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j record; v_target uuid;
begin
  for j in
    select id, service_type from public.jobs
     where deal_id = p_deal_id and is_blocked and blocked_reason = 'account_on_hold' and not archived
  loop
    v_target := null;
    if j.service_type in ('web_seo','local_seo','social_media','ads') then
      select ps.id into v_target from public.pipeline_stages ps
       where ps.board = j.service_type
         and ps.code = case when j.service_type in ('web_seo','local_seo') then 'renewal' else 'active' end
         and not ps.archived
       limit 1;
    end if;
    update public.jobs
       set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
           stage_id = coalesce(v_target, stage_id)
     where id = j.id;
  end loop;
end $$;

-- Rewrite the existing hold trigger function (trigger `deals_hold_jobs_on_hold` keeps pointing here).
create or replace function public.deals_hold_jobs_on_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_code text;
begin
  if new.accounting_stage_id is null
     or new.accounting_stage_id is not distinct from old.accounting_stage_id then
    return new;
  end if;
  select code into new_code from public.pipeline_stages
   where id = new.accounting_stage_id and board = 'accounting_onboarding';

  if new_code = 'on_hold' then
    perform public.block_deal_jobs(new.id);
  elsif new_code = 'paid_in_full' then
    perform public.release_deal_jobs(new.id);
  elsif new_code = 'partial_payment' then
    null;  -- stays blocked; the partial-payment spawn mechanism owns these
  elsif new_code is not null then
    -- left a blocked stage to a non-paid, non-partial stage: clear account_on_hold holds only.
    update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
      where deal_id = new.id and is_blocked and blocked_reason = 'account_on_hold';
  end if;
  return new;
end $$;

-- ROLLBACK: restore deals_hold_jobs_on_stage_change from 20260618000014 (SEO-only, no renewal move)
--   and drop functions target_accounting_stage, deal_next_due, block_deal_jobs, release_deal_jobs.
