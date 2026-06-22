-- Backfill lead_intake.phone + phone_normalized from the raw form blob.
--
-- Historical imports (source='import') landed before leadImport.ts learned to map
-- the Meta phone fields, so the phone column was blank for ~4,704 intake rows even
-- though the number was present in source_data under one of:
--   αριθμός_τηλεφώνου  (local-SEO form)  |  work_phone_number (website form)  |  COL$O (columnar Zapier export)
-- all prefixed with the Zapier "p:" marker. The clean phone column drives the UI,
-- phone-based dedup (find_lead_duplicates) and PBX click-to-call, so it must be filled.
--
-- NOTE: lead_intake.phone_normalized is a PLAIN column (not generated like leads/clients),
-- so we set it explicitly to the 10-digit national key (matches src/lib/phone/normalize.ts).
--
-- Applied to prod 2026-06-22 via the Management API. Fill-blank only — never overwrites a
-- value already present. Already-applied is idempotent (re-running matches no blank rows).

-- Backup of every affected row's original (null) values, for rollback.
create table if not exists public.lead_intake_phone_backup_20260622 as
select id, phone, phone_normalized, now() as backed_up_at
from public.lead_intake
where coalesce(nullif(btrim(phone), ''), nullif(btrim(phone_normalized), '')) is null;

with src as (
  select id,
    nullif(btrim(regexp_replace(coalesce(
      source_data->>'αριθμός_τηλεφώνου', source_data->>'work_phone_number', source_data->>'COL$O'
    ), '^p:\s*', '')), '') as clean_phone
  from public.lead_intake
  where coalesce(nullif(btrim(phone), ''), nullif(btrim(phone_normalized), '')) is null
),
norm as (
  select id, clean_phone, regexp_replace(coalesce(clean_phone, ''), '[^0-9]', '', 'g') as digits
  from src
  where clean_phone is not null
)
update public.lead_intake li
   set phone = n.clean_phone,
       phone_normalized = case when length(n.digits) >= 10 then right(n.digits, 10) else null end
  from norm n
 where li.id = n.id;

-- ROLLBACK:
--   update public.lead_intake li
--      set phone = b.phone, phone_normalized = b.phone_normalized
--     from public.lead_intake_phone_backup_20260622 b
--    where li.id = b.id;
--   drop table public.lead_intake_phone_backup_20260622;
