-- 2026-07-11: retag mkifokeris's uncoded client emails to web_dev
-- (owner-instructed 2026-07-10). He was removed from accounting/web_seo/
-- local_seo/social_media and is web_dev-only, so live v5's single-group rule
-- files his future uncoded mail under web_dev; this aligns the ~202 stored
-- rows that predate the group change. Idempotent (safe to re-run).
--
-- ROLLBACK:
--   update public.email_messages em set department = b.department
--     from public.email_dept_mkif_retag_backup_20260710 b where b.id = em.id;
--   drop table public.email_dept_mkif_retag_backup_20260710;

create table if not exists public.email_dept_mkif_retag_backup_20260710 (
  id uuid primary key,
  department text
);

insert into public.email_dept_mkif_retag_backup_20260710 (id, department)
select id, department
  from public.email_messages
 where staff_user_id = '61b53075-398f-43a0-86f6-8bce177b669b'
   and job_id is null and lead_id is null and client_id is not null
   and department is distinct from 'web_dev'
on conflict (id) do nothing;

update public.email_messages
   set department = 'web_dev'
 where staff_user_id = '61b53075-398f-43a0-86f6-8bce177b669b'
   and job_id is null and lead_id is null and client_id is not null
   and department is distinct from 'web_dev';
