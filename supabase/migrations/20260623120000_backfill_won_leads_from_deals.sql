-- 20260623120000_backfill_won_leads_from_deals.sql
-- =============================================================================
-- Backfill: one Won lead per active accounting deal that has no linked lead.
-- Inserts ONLY into public.leads (linked to the existing deal/client via
-- converted_deal_id). Creates ZERO new deals/clients/jobs/payments. Pauses
-- round-robin distribution during the run so historical won leads aren't
-- auto-assigned. Every inserted lead id is recorded for rollback.
-- =============================================================================

create table if not exists public.leads_won_backfill_backup_20260623 (
  lead_id uuid primary key,
  action text not null,            -- 'created' (this run inserts only)
  deal_id uuid,
  inserted_at timestamptz not null default now()
);

do $$
declare
  v_won uuid;
  v_dist boolean;
begin
  select id into v_won from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  if v_won is null then raise exception 'won stage not found'; end if;

  -- pause round-robin so backfilled won leads aren't auto-distributed
  select auto_enabled into v_dist from public.lead_distribution_state where id = true;
  update public.lead_distribution_state set auto_enabled = false where id = true;

  with d as (
    select dd.id as deal_id, dd.client_id, dd.code, dd.title,
           dd.one_time_value, dd.recurring_monthly_value,
           coalesce(dd.actual_close_date::timestamptz, dd.invoiced_date::timestamptz, dd.created_at) as won_at,
           coalesce(dd.won_by_user_id, dd.owner_user_id) as owner_id, dd.won_by_user_id,
           c.name as c_name, c.contact_first_name as c_fn, c.contact_last_name as c_ln,
           c.email as c_email, c.phone as c_phone, c.address as c_addr, c.industry as c_ind,
           c.country as c_country, c.vat_number as c_vat, c.website as c_web
    from public.deals dd
    join public.clients c on c.id = dd.client_id
    where not dd.archived
      and not exists (select 1 from public.leads l where l.converted_deal_id = dd.id)
  ),
  ins as (
    insert into public.leads (
      source, title, code, stage_id, automations_enabled,
      converted_at, converted_deal_id, converted_client_id,
      company_name, contact_first_name, contact_last_name, email, phone,
      address, industry, country, vat_number, website,
      estimated_one_time_value, estimated_monthly_value,
      owner_user_id, won_by_user_id
    )
    select
      'import',
      coalesce(nullif(trim(d.title), ''), nullif(trim(d.c_name), ''), 'Won deal'),
      coalesce(nullif(trim(d.code), ''), public.generate_lead_code()),
      v_won, false,
      d.won_at, d.deal_id, d.client_id,
      d.c_name, d.c_fn, d.c_ln, d.c_email, d.c_phone,
      d.c_addr, d.c_ind, d.c_country, d.c_vat, d.c_web,
      coalesce(d.one_time_value, 0), coalesce(d.recurring_monthly_value, 0),
      d.owner_id, d.won_by_user_id
    from d
    returning id, converted_deal_id
  )
  insert into public.leads_won_backfill_backup_20260623 (lead_id, action, deal_id)
  select id, 'created', converted_deal_id from ins;

  -- restore the distribution toggle to whatever it was
  update public.lead_distribution_state set auto_enabled = coalesce(v_dist, false) where id = true;
end $$;

-- ---------------------------------------------------------------------------
-- Rollback:
--   delete from public.leads l using public.leads_won_backfill_backup_20260623 b
--     where b.lead_id = l.id and b.action = 'created';
--   drop table if exists public.leads_won_backfill_backup_20260623;
--   -- (distribution toggle is left as restored; no accounting rows were created)
-- ---------------------------------------------------------------------------
