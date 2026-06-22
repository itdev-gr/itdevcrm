-- Fill-blank backfill of campaign data already captured in source_data.
-- Backups for rollback; never overwrites an existing value.

create table if not exists public.leads_campaign_backfill_backup_20260622 as
select id, company_name, notes, now() as backed_up_at
from public.leads
where coalesce(nullif(btrim(company_name), ''), nullif(btrim(notes), '')) is null;

create table if not exists public.lead_intake_company_backup_20260622 as
select id, company_name, now() as backed_up_at
from public.lead_intake
where nullif(btrim(company_name), '') is null;

-- (A) leads.company_name from source_data, fill-blank
update public.leads
   set company_name = nullif(btrim(source_data->>'όνομα_εταιρείας'), ''),
       updated_at = now()
 where nullif(btrim(company_name), '') is null
   and nullif(btrim(source_data->>'όνομα_εταιρείας'), '') is not null;

-- (B) leads.notes from the formatter, fill-blank
update public.leads
   set notes = public.build_lead_info_block(source_data, title),
       updated_at = now()
 where nullif(btrim(notes), '') is null
   and public.build_lead_info_block(source_data, title) is not null;

-- (C) lead_intake.company_name from source_data, fill-blank
update public.lead_intake
   set company_name = nullif(btrim(source_data->>'όνομα_εταιρείας'), '')
 where nullif(btrim(company_name), '') is null
   and nullif(btrim(source_data->>'όνομα_εταιρείας'), '') is not null;

-- ROLLBACK:
--   update public.leads l set company_name = b.company_name, notes = b.notes
--     from public.leads_campaign_backfill_backup_20260622 b where l.id = b.id;
--   update public.lead_intake li set company_name = b.company_name
--     from public.lead_intake_company_backup_20260622 b where li.id = b.id;
--   drop table public.leads_campaign_backfill_backup_20260622;
--   drop table public.lead_intake_company_backup_20260622;
