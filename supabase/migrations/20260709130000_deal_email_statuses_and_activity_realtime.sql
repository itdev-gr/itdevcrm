-- Deal Overview "Emails" box.
-- (1) deal_email_statuses: emails sent for a deal (its own + its jobs' + its
--     payments'), resolved from email_log (which carries only client_id) by
--     matching each dedupe_key's trailing UUID to the deal.id / job ids /
--     payment ids. security definer because email_log is admin-only RLS.
-- (2) add activity_log (already public: SELECT qual=true) to the realtime
--     publication so the box can live-update from the email mirror.
--
-- ROLLBACK:
--   drop function if exists public.deal_email_statuses(uuid);
--   alter publication supabase_realtime drop table public.activity_log;

create or replace function public.deal_email_statuses(p_deal_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text,
  delivered_at timestamptz, bounced_at timestamptz, error text,
  created_at timestamptz, dedupe_key text
)
language sql
security definer
set search_path = public
stable
as $$
  with d as (select client_id from public.deals where id = p_deal_id),
  ids as (
    select p_deal_id as k
    union all select j.id  from public.jobs j          where j.deal_id  = p_deal_id
    union all select dp.id from public.deal_payments dp where dp.deal_id = p_deal_id
  )
  select e.id, e.to_email, e.template_key, e.status,
         e.delivered_at, e.bounced_at, e.error, e.created_at, e.dedupe_key
  from public.email_log e
  join d on e.client_id = d.client_id
  where e.dedupe_key ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (substring(e.dedupe_key from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))::uuid
        in (select k from ids)
  order by e.created_at desc;
$$;

grant execute on function public.deal_email_statuses(uuid) to authenticated;

alter publication supabase_realtime add table public.activity_log;
