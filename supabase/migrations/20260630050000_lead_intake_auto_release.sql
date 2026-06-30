-- 2026-06-30: cautious auto-release toggle for /sales/lead-intake — mirrors
-- the existing auto_merge toggle (migration 20260621120300) but handles the
-- "matches=0" (clean) case rather than the "exactly 1 lead match" case. When
-- ON, an incoming intake row with no duplicate matches gets released to a
-- new lead in Unique Lead immediately (same path bulk_release_intake takes,
-- including the `app.intake_release` GUC that bypasses the unique_lead stage
-- restriction). The two triggers are mutually exclusive on which rows they
-- handle, so order doesn't matter — both skip if status<>'pending' or if
-- their predicate doesn't fit.
--
-- The existing leads INSERT chain (round-robin assignment, welcome email,
-- Unique Lead stage gating) handles assignment + outreach exactly like a
-- manual Release click.

alter table public.lead_distribution_state
  add column if not exists auto_release_enabled boolean not null default false;

create or replace function public.lead_intake_auto_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enabled boolean;
  v_unique_stage uuid;
  v_lead_id uuid;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  -- Only act on CLEAN rows — anything with a possible duplicate stays
  -- pending for manual review (or for auto_merge to handle).
  if jsonb_array_length(coalesce(NEW.matches, '[]'::jsonb)) <> 0 then
    return NEW;
  end if;

  select auto_release_enabled into enabled
    from public.lead_distribution_state where id = true;
  if not coalesce(enabled, false) then
    return NEW;
  end if;

  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'sales' and code = 'unique_lead'
   limit 1;
  if v_unique_stage is null then
    return NEW;  -- pipeline not seeded yet; leave for manual review
  end if;

  -- Bypass the unique_lead stage's INSERT restriction (mkifokeris-only) the
  -- same way release_lead_intake / bulk_release_intake do.
  perform set_config('app.intake_release', 'on', true);

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, notes, stage_id
  ) values (
    NEW.source, NEW.source_data, NEW.title, NEW.contact_first_name, NEW.contact_last_name,
    NEW.email, NEW.phone, NEW.website, NEW.company_name, NEW.contact_info, v_unique_stage
  )
  returning id into v_lead_id;

  NEW.status := 'released';
  NEW.released_lead_id := v_lead_id;
  NEW.reviewed_at := now();  -- reviewed_by stays NULL → "System" in activity feed
  return NEW;
end;
$$;

drop trigger if exists lead_intake_auto_release_trg on public.lead_intake;
create trigger lead_intake_auto_release_trg
  before insert on public.lead_intake
  for each row execute function public.lead_intake_auto_release();

-- ROLLBACK:
--   drop trigger if exists lead_intake_auto_release_trg on public.lead_intake;
--   drop function if exists public.lead_intake_auto_release();
--   alter table public.lead_distribution_state drop column if exists auto_release_enabled;
