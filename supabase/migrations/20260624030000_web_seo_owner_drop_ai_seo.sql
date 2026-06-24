-- 20260624030000_web_seo_owner_drop_ai_seo.sql
-- 3-row model: ai_seo is now a billing record (unowned); the web work moves to a
-- web_seo child. Drop the ai_seo branch added in 20260624000000 so the billing
-- record stays unowned and only the web_seo child gets pefstathiadis.
create or replace function public.jobs_web_seo_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_type = 'web_seo' then
    new.owner_user_id := '19aa9170-bd62-4319-8118-668c11e93c98';
  end if;
  return new;
end $$;

-- ROLLBACK: restore the web_seo+ai_seo body from 20260624000000_jobs_ai_seo_owner_pefstathiadis.sql.
