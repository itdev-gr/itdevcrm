-- Lead ingestion robustness: stop emails/phones from getting stranded in source_data.
--
-- Problem: ingestion paths (CSV import, Meta webhook, manual UI, RPCs) all extract
-- email/phone from arbitrary-key payloads using per-path alias lists. A new form, locale,
-- or column label silently strands the value in source_data with the email/phone column NULL.
-- This has been fixed at each ingestion path twice already (2026-06-22, 2026-06-24); a
-- per-path fix is fragile by design.
--
-- Fix: add a recursive JSONB scanner + a BEFORE INSERT/UPDATE trigger on lead_intake AND
-- leads that fills NULL email/phone from any email-shaped / phone-shaped value found
-- anywhere in source_data. Defense-in-depth — never overwrites a value the caller set.
--
-- Spec: docs/system-analysis/2026-06-30-lead-email-stranding-fix.md

-- ── 1. Helpers ───────────────────────────────────────────────────────────────

-- Returns the first value (recursively) matching a strict email regex, or NULL.
create or replace function public.first_email_in_jsonb(p jsonb)
returns text
language plpgsql immutable parallel safe
set search_path = public
as $$
declare
  k text;
  v jsonb;
  vs text;
  found text;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'string' then
    vs := lower(trim(p #>> '{}'));
    if vs ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      return vs;
    end if;
    return null;
  end if;
  if jsonb_typeof(p) = 'object' then
    for k, v in select * from jsonb_each(p) loop
      found := public.first_email_in_jsonb(v);
      if found is not null then return found; end if;
    end loop;
    return null;
  end if;
  if jsonb_typeof(p) = 'array' then
    for v in select * from jsonb_array_elements(p) loop
      found := public.first_email_in_jsonb(v);
      if found is not null then return found; end if;
    end loop;
    return null;
  end if;
  return null;
end $$;

-- Returns the first value (recursively) matching a phone regex, or NULL.
-- Tight rules to avoid false positives like dates ("06/22/2026"), times,
-- and 15-digit Meta ad IDs. Rejects any string that contains a date/time
-- separator or a letter. Accepts:
--   - International: leading + and 8-15 digits.
--   - Greek 10-digit mobile/landline (starts 2 or 6).
--   - Greek with country code: 0030 or 30 prefix.
create or replace function public.first_phone_in_jsonb(p jsonb)
returns text
language plpgsql immutable parallel safe
set search_path = public
as $$
declare
  k text;
  v jsonb;
  vs text;
  digits text;
  found text;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'string' then
    vs := trim(p #>> '{}');
    if vs is null or vs = '' then return null; end if;
    if left(vs, 2) = 'p:' then vs := substring(vs from 3); end if;
    -- Reject if the original string has date/time separators or letters.
    if vs ~ '[/:@a-zA-ZΑ-Ωα-ωΆ-Ώά-ώ]' then return null; end if;
    digits := regexp_replace(vs, '[^0-9+]', '', 'g');
    if digits ~ '^\+[0-9]{8,15}$' then return digits; end if;
    -- Greek: 10 digits starting 2 (landline) or 6 (mobile), with optional 30/0030 country code.
    if digits ~ '^[26][0-9]{9}$' then return digits; end if;
    if digits ~ '^0030[26][0-9]{9}$' then return digits; end if;
    if digits ~ '^30[26][0-9]{9}$' then return digits; end if;
    -- Cypriot: 8 digits starting 2 (landline) or 9 (mobile), with optional 357/00357 country code.
    if digits ~ '^[29][0-9]{7}$' then return digits; end if;
    if digits ~ '^00357[29][0-9]{7}$' then return digits; end if;
    if digits ~ '^357[29][0-9]{7}$' then return digits; end if;
    return null;
  end if;
  if jsonb_typeof(p) = 'object' then
    for k, v in select * from jsonb_each(p) loop
      found := public.first_phone_in_jsonb(v);
      if found is not null then return found; end if;
    end loop;
    return null;
  end if;
  if jsonb_typeof(p) = 'array' then
    for v in select * from jsonb_array_elements(p) loop
      found := public.first_phone_in_jsonb(v);
      if found is not null then return found; end if;
    end loop;
    return null;
  end if;
  return null;
end $$;

-- ── 2. Triggers ──────────────────────────────────────────────────────────────

-- BEFORE INSERT/UPDATE: if email/phone column is null/empty OR doesn't look like
-- a valid email/phone shape (e.g. Meta webhook delivered a phone in the email
-- field because the form's column order shifted), pull a valid value from
-- source_data. Never overwrites a shape-valid value the caller set.
create or replace function public.fill_contact_from_source_data()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  extracted_email text;
  extracted_phone text;
  email_looks_valid boolean;
  phone_looks_valid boolean;
begin
  if new.source_data is null or jsonb_typeof(new.source_data) not in ('object','array') then
    return new;
  end if;

  email_looks_valid := new.email is not null
                       and trim(new.email) <> ''
                       and lower(trim(new.email)) ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$';
  if not email_looks_valid then
    extracted_email := public.first_email_in_jsonb(new.source_data);
    if extracted_email is not null then
      new.email := extracted_email;
    end if;
  end if;

  -- Permissive phone shape: digits with optional + / whitespace / parens / dashes.
  -- Anything else (text like "Eleftheria Sifnaiou") → extract from source_data.
  phone_looks_valid := new.phone is not null
                       and trim(new.phone) <> ''
                       and trim(new.phone) ~ '^[+0-9\s()\-]+$';
  if not phone_looks_valid then
    extracted_phone := public.first_phone_in_jsonb(new.source_data);
    if extracted_phone is not null then
      new.phone := extracted_phone;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists lead_intake_fill_contact on public.lead_intake;
create trigger lead_intake_fill_contact
  before insert or update on public.lead_intake
  for each row execute function public.fill_contact_from_source_data();

drop trigger if exists leads_fill_contact on public.leads;
create trigger leads_fill_contact
  before insert or update on public.leads
  for each row execute function public.fill_contact_from_source_data();

-- ── 3. One-shot backfill ─────────────────────────────────────────────────────

-- Backup the rows we're about to change. Stores BOTH email + phone (whichever is being filled).
create table if not exists public.contact_backfill_backup_20260630 (
  src_table text not null,
  row_id uuid not null,
  prev_email text,
  prev_phone text,
  prev_phone_normalized text,
  new_email text,
  new_phone text,
  backed_up_at timestamptz not null default now(),
  primary key (src_table, row_id)
);

-- lead_intake backfill
insert into public.contact_backfill_backup_20260630
  (src_table, row_id, prev_email, prev_phone, prev_phone_normalized, new_email, new_phone)
select 'lead_intake', li.id, li.email, li.phone, li.phone_normalized,
       public.first_email_in_jsonb(li.source_data),
       public.first_phone_in_jsonb(li.source_data)
  from public.lead_intake li
 where ((li.email is null or trim(li.email) = '')
        and public.first_email_in_jsonb(li.source_data) is not null)
    or ((li.phone is null or trim(li.phone) = '')
        and public.first_phone_in_jsonb(li.source_data) is not null)
on conflict do nothing;

update public.lead_intake li
   set email = coalesce(nullif(trim(li.email), ''), public.first_email_in_jsonb(li.source_data)),
       phone = coalesce(nullif(trim(li.phone), ''), public.first_phone_in_jsonb(li.source_data))
 where ((li.email is null or trim(li.email) = '')
        and public.first_email_in_jsonb(li.source_data) is not null)
    or ((li.phone is null or trim(li.phone) = '')
        and public.first_phone_in_jsonb(li.source_data) is not null);

-- leads backfill
insert into public.contact_backfill_backup_20260630
  (src_table, row_id, prev_email, prev_phone, prev_phone_normalized, new_email, new_phone)
select 'leads', l.id, l.email, l.phone, l.phone_normalized,
       public.first_email_in_jsonb(l.source_data),
       public.first_phone_in_jsonb(l.source_data)
  from public.leads l
 where ((l.email is null or trim(l.email) = '')
        and public.first_email_in_jsonb(l.source_data) is not null)
    or ((l.phone is null or trim(l.phone) = '')
        and public.first_phone_in_jsonb(l.source_data) is not null)
on conflict do nothing;

update public.leads l
   set email = coalesce(nullif(trim(l.email), ''), public.first_email_in_jsonb(l.source_data)),
       phone = coalesce(nullif(trim(l.phone), ''), public.first_phone_in_jsonb(l.source_data))
 where ((l.email is null or trim(l.email) = '')
        and public.first_email_in_jsonb(l.source_data) is not null)
    or ((l.phone is null or trim(l.phone) = '')
        and public.first_phone_in_jsonb(l.source_data) is not null);

-- =============================================================================
-- CHANGES / REVERT
--   + public.first_email_in_jsonb(jsonb)
--   + public.first_phone_in_jsonb(jsonb)
--   + public.fill_contact_from_source_data() trigger function
--   + trigger lead_intake_fill_contact on public.lead_intake (BEFORE INSERT/UPDATE)
--   + trigger leads_fill_contact on public.leads (BEFORE INSERT/UPDATE)
--   + backfill of stranded email/phone in lead_intake + leads
--   + backup table public.contact_backfill_backup_20260630
--
-- ROLLBACK:
--   drop trigger if exists lead_intake_fill_contact on public.lead_intake;
--   drop trigger if exists leads_fill_contact on public.leads;
--   drop function if exists public.fill_contact_from_source_data();
--   drop function if exists public.first_email_in_jsonb(jsonb);
--   drop function if exists public.first_phone_in_jsonb(jsonb);
--   -- Restore stranded rows:
--   update public.lead_intake li set email = b.prev_email, phone = b.prev_phone,
--          phone_normalized = b.prev_phone_normalized
--     from public.contact_backfill_backup_20260630 b
--    where b.src_table = 'lead_intake' and b.row_id = li.id;
--   update public.leads l set email = b.prev_email, phone = b.prev_phone,
--          phone_normalized = b.prev_phone_normalized
--     from public.contact_backfill_backup_20260630 b
--    where b.src_table = 'leads' and b.row_id = l.id;
-- =============================================================================
