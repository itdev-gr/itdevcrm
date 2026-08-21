-- 2026-08-19: Remove A. Zazas (azazas@itdev.gr) + A. Kotzampasakis
-- (akotzampasakis@itdev.gr) from lead distribution and round-robin their
-- ACTIVE leads (archived=false, converted_at is null) to the remaining sales
-- pool. Archived/converted leads keep their owner for history.
-- Same approach as 2026-08-13-reassign-giannakakis-vogiatzi-leads.sql, but
-- matched by email instead of hardcoded user_ids.
-- Executed 2026-08-19 via the Management API (scratchpad script), all
-- statements in one transaction.

update public.profiles
   set exclude_from_lead_distribution = true
 where email in ('azazas@itdev.gr', 'akotzampasakis@itdev.gr');

do $$
begin
  if coalesce(array_length(public.sales_pool_ids(), 1), 0) < 1 then
    raise exception 'sales pool empty after exclusion — rolled back';
  end if;
end $$;

with victim_users as (
  select user_id from public.profiles
  where email in ('azazas@itdev.gr', 'akotzampasakis@itdev.gr')
),
pool as (
  select t.user_id, t.ord
  from unnest(public.sales_pool_ids()) with ordinality as t(user_id, ord)
),
victims as (
  select id, row_number() over (order by code) as rn
  from public.leads
  where owner_user_id in (select user_id from victim_users)
    and archived = false
    and converted_at is null
)
update public.leads l
   set owner_user_id = p.user_id
  from victims v
  join pool p on p.ord = ((v.rn - 1) % (select count(*) from pool)) + 1
 where l.id = v.id;

-- Verification
select pr.full_name, pr.email, pr.exclude_from_lead_distribution,
       count(l.id) filter (where l.archived = false and l.converted_at is null) as active_leads,
       count(l.id) filter (where l.archived or l.converted_at is not null) as archived_or_converted
from public.profiles pr
join public.user_groups ug on ug.user_id = pr.user_id
join public.groups g on g.id = ug.group_id and g.code = 'sales'
left join public.leads l on l.owner_user_id = pr.user_id
group by pr.user_id, pr.full_name, pr.email, pr.exclude_from_lead_distribution
order by pr.full_name;
