-- Lead-intake merge: schema additions (all additive).
-- 1. Append-only field on leads that holds merged duplicate info.
alter table public.leads
  add column if not exists intake_log text;

-- 2. Allow a new terminal intake status 'merged'.
alter table public.lead_intake
  drop constraint if exists lead_intake_status_check;
alter table public.lead_intake
  add constraint lead_intake_status_check
  check (status in ('pending','released','discarded','merged'));

-- 3. Audit pointer: which lead an intake row was merged into.
alter table public.lead_intake
  add column if not exists merged_into_lead_id uuid
  references public.leads(id) on delete set null;

-- 4. Auto-merge toggle, reusing the admin-only singleton settings row.
alter table public.lead_distribution_state
  add column if not exists auto_merge_enabled boolean not null default false;
