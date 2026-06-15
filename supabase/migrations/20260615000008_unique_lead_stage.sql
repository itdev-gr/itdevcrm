-- Unique Lead sales column: new stage (first column), move-in restricted to one
-- user, and the welcome email retimed to fire when a lead ENTERS this stage.

-- 1. Per-stage move-in lock (data-driven; null = unrestricted).
alter table public.pipeline_stages
  add column if not exists restricted_to_user_id uuid references auth.users(id);

-- 2. The new stage as the first sales column, locked to mkifokeris.
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, restricted_to_user_id)
values (
  'sales',
  'unique_lead',
  '{"en":"Unique Lead","el":"Μοναδικός Πελάτης"}'::jsonb,
  5,
  false,
  (select id from auth.users where email = 'mkifokeris@itdev.gr')
)
on conflict do nothing;

-- 3. Enforce: only the assigned user may move a lead INTO a restricted stage.
--    Fires only when ENTERING a stage. Moving OUT / editing in place is unaffected.
--    No admin bypass — the assigned user is themselves an admin.
create or replace function public.leads_enforce_stage_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  restricted uuid;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if new.stage_id is null then
    return new;
  end if;

  select restricted_to_user_id into restricted
    from public.pipeline_stages
   where id = new.stage_id;

  if restricted is not null and auth.uid() is distinct from restricted then
    raise exception 'Only the assigned user may move leads into this stage'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists leads_enforce_stage_restriction on public.leads;
create trigger leads_enforce_stage_restriction
  before insert or update on public.leads
  for each row execute function public.leads_enforce_stage_restriction();

-- 4. Retime the welcome email: send when a lead ENTERS unique_lead (not on insert).
create or replace function public.leads_email_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  old_code text;
  seq record;
begin
  if tg_op = 'INSERT' then
    -- Welcome only when a lead is created directly in Unique Lead (rare; only the
    -- assigned user can). Normal new/Meta leads land in New Lead → no email yet.
    if new.stage_id is not null then
      select code into new_code from public.pipeline_stages where id = new.stage_id;
      if new_code = 'unique_lead' and public.email_automation_enabled('lead_welcome') then
        perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: scheduled_for set/changed while the automation is on.
  if new.scheduled_for is distinct from old.scheduled_for
     and new.scheduled_for is not null
     and public.email_automation_enabled('scheduled_confirm') then
    perform public.enqueue_lead_email(
      new.id, 'scheduled_confirm',
      'scheduled_confirm:' || new.id || ':' || to_char(new.scheduled_for, 'YYYYMMDDHH24MI'));
  end if;

  if new.stage_id is distinct from old.stage_id then
    select code into new_code from public.pipeline_stages where id = new.stage_id;
    select code into old_code from public.pipeline_stages where id = old.stage_id;

    -- Stop every active run whose sequence no longer matches the stage.
    update public.lead_sequence_runs r
       set stopped_at = now(), stopped_reason = 'stage_change'
      from public.email_sequences s
     where r.sequence_id = s.id
       and r.lead_id = new.id
       and r.stopped_at is null
       and not (new_code = any (s.active_stage_codes));

    -- Start runs for sequences bound to the new stage.
    for seq in
      select s.id from public.email_sequences s
       where new_code = any (s.active_stage_codes)
         and not exists (
           select 1 from public.lead_sequence_runs r
            where r.lead_id = new.id and r.sequence_id = s.id and r.stopped_at is null)
    loop
      insert into public.lead_sequence_runs (lead_id, sequence_id) values (new.id, seq.id);
    end loop;

    -- Welcome fires on entering Unique Lead.
    if new_code = 'unique_lead' and public.email_automation_enabled('lead_welcome') then
      perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
    end if;

    if new_code = 'won' then
      if public.email_automation_enabled('won_welcome') then
        perform public.enqueue_lead_email(new.id, 'won_welcome', 'auto_won_welcome:' || new.id);
      end if;
      if public.email_automation_enabled('won_next_steps') then
        perform public.enqueue_lead_email(new.id, 'won_next_steps', 'won_next_steps:' || new.id);
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ROLLBACK:
--   drop trigger if exists leads_enforce_stage_restriction on public.leads;
--   drop function if exists public.leads_enforce_stage_restriction();
--   delete from public.pipeline_stages where board='sales' and code='unique_lead';
--   alter table public.pipeline_stages drop column if exists restricted_to_user_id;
--   -- then restore the prior public.leads_email_automations body (welcome-on-INSERT)
--   --   from migration history / git before this change.
