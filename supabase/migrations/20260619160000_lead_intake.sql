-- Lead duplicate intake. Zapier/Meta leads whose email or normalized phone already
-- exists (on another lead, or on a client that has >=1 deal) are held here for review
-- instead of being inserted into `leads`. Clean leads are unaffected. Admins Release a
-- held row into `leads` (its normal default-stage + welcome-email path) or Discard it
-- (kept as an audit row). Writers: api/meta-lead.ts (service role) + the RPCs below.
-- UI: src/features/leads/LeadIntakePage.tsx via src/lib/rpc.ts.

create table if not exists public.lead_intake (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending','released','discarded')),
  source text not null default 'meta',
  source_data jsonb,
  title text,
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  phone_normalized text,
  website text,
  company_name text,
  contact_info text,
  matched_on text[] not null default '{}',
  matches jsonb not null default '[]'::jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  released_lead_id uuid references public.leads(id) on delete set null
);

create index if not exists lead_intake_pending_idx
  on public.lead_intake (created_at desc) where status = 'pending';
create index if not exists lead_intake_leadgen_idx
  on public.lead_intake ((source_data->>'leadgen_id'));

-- The rule: return every existing lead and deal-client that matches the given email
-- (case-insensitive) or normalized phone (last 10 digits). Used by the webhook + UI.
create or replace function public.find_lead_duplicates(p_email text, p_phone text)
returns table (
  match_type text,     -- 'lead' | 'deal_client'
  record_id uuid,
  display_name text,
  context text,        -- matched lead's stage (en) | client's deal code(s)
  matched_field text   -- 'email' | 'phone'
)
language sql
stable
security definer
set search_path = public
as $$
  with norm as (
    select
      nullif(lower(trim(coalesce(p_email,''))), '') as email,
      case
        when length(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')) >= 10
          then right(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), 10)
        else null
      end as phone
  )
  select 'lead'::text, l.id,
         coalesce(
           nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), ''),
           l.company_name, l.email, 'lead'),
         coalesce(ps.display_names->>'en', ps.code),
         case when n.email is not null and lower(trim(l.email)) = n.email then 'email' else 'phone' end
  from public.leads l
  left join public.pipeline_stages ps on ps.id = l.stage_id
  cross join norm n
  where (n.email is not null and lower(trim(l.email)) = n.email)
     or (n.phone is not null and l.phone_normalized = n.phone)

  union all

  select 'deal_client'::text, c.id,
         coalesce(c.name, c.email, 'client'),
         (select string_agg(d.code, ', ') from public.deals d where d.client_id = c.id),
         case when n.email is not null and lower(trim(c.email)) = n.email then 'email' else 'phone' end
  from public.clients c
  cross join norm n
  where exists (select 1 from public.deals d where d.client_id = c.id)
    and ((n.email is not null and lower(trim(c.email)) = n.email)
      or (n.phone is not null and c.phone_normalized = n.phone));
$$;

grant execute on function public.find_lead_duplicates(text, text) to authenticated, service_role;

-- Release a held row into `leads` (normal triggers fire: default stage = unique_lead,
-- welcome email queued). Admin-only.
create or replace function public.release_lead_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_lead_id uuid;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  select * into r from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_found'));
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('already_' || r.status));
  end if;

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, contact_info
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website, r.company_name, r.contact_info
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$$;

grant execute on function public.release_lead_intake(uuid) to authenticated;

-- Discard a held row (audit only; never reaches `leads`). Admin-only.
create or replace function public.discard_lead_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;
  select status into v_status from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_found'));
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('already_' || v_status));
  end if;
  update public.lead_intake
     set status = 'discarded', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.discard_lead_intake(uuid) to authenticated;

-- RLS: only admins can read the queue. Writes happen via service_role (webhook,
-- bypasses RLS) and the SECURITY DEFINER RPCs above, so no write policies exist.
alter table public.lead_intake enable row level security;
grant select on public.lead_intake to authenticated;
grant all on public.lead_intake to service_role;

create policy lead_intake_select_admin on public.lead_intake
  for select to authenticated
  using (public.current_user_is_admin());

-- ROLLBACK:
-- drop policy if exists lead_intake_select_admin on public.lead_intake;
-- drop function if exists public.discard_lead_intake(uuid);
-- drop function if exists public.release_lead_intake(uuid);
-- drop function if exists public.find_lead_duplicates(text, text);
-- drop table if exists public.lead_intake;
