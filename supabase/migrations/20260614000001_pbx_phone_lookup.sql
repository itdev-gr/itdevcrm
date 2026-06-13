-- supabase/migrations/20260614000001_pbx_phone_lookup.sql
-- =============================================================================
-- PBX caller-ID lookup: normalized phone keys + matcher RPC
-- =============================================================================

-- National key = last 10 digits after stripping non-digits (drops +30/0030/30).
alter table public.clients
  add column phone_normalized text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

alter table public.leads
  add column phone_normalized text
  generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored;

create index clients_phone_normalized on public.clients (phone_normalized) where archived = false;
create index leads_phone_normalized on public.leads (phone_normalized);

-- Match a 10-digit national key against clients (primary + additional_contacts)
-- and leads. SECURITY DEFINER so the service-role caller bypasses RLS cleanly;
-- the calling endpoint enforces the shared-secret gate.
--
-- NOTE: leads has no `name` column. `company_name` is used instead (the column
-- that holds the lead's company/organisation name, equivalent to clients.name).
create or replace function public.find_contact_by_phone(p_key text)
returns table (
  id uuid,
  name text,
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.contact_first_name, t.contact_last_name, t.email, t.phone, t.source
  from (
    -- 1: client primary phone
    select 1 as pri, c.id, c.name, c.contact_first_name, c.contact_last_name,
           c.email, c.phone, 'client'::text as source
    from public.clients c
    where c.archived = false
      and char_length(p_key) = 10
      and c.phone_normalized = p_key

    union all

    -- 2: client additional_contacts secondary phone
    select 2 as pri, c.id, c.name,
           ac->>'full_name' as contact_first_name, '' as contact_last_name,
           ac->>'email' as email, ac->>'phone' as phone, 'client'::text as source
    from public.clients c,
         jsonb_array_elements(coalesce(c.additional_contacts, '[]'::jsonb)) ac
    where c.archived = false
      and char_length(p_key) = 10
      and right(regexp_replace(coalesce(ac->>'phone', ''), '[^0-9]', '', 'g'), 10) = p_key

    union all

    -- 3: lead primary phone
    -- leads has no `name` column; company_name is the organisation name equivalent
    select 3 as pri, l.id, l.company_name as name, l.contact_first_name, l.contact_last_name,
           l.email, l.phone, 'lead'::text as source
    from public.leads l
    where char_length(p_key) = 10
      and l.phone_normalized = p_key
  ) t
  order by t.pri
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run to fully revert this migration):
--   drop function if exists public.find_contact_by_phone(text);
--   drop index if exists public.leads_phone_normalized;
--   drop index if exists public.clients_phone_normalized;
--   alter table public.leads   drop column if exists phone_normalized;
--   alter table public.clients drop column if exists phone_normalized;
-- ---------------------------------------------------------------------------
