-- 2026-08-13: Remove D. Giannakakis + T. Vogiatzi from lead distribution and
-- round-robin their ACTIVE leads (archived=false, converted_at is null) to the
-- remaining sales pool. Archived/converted leads keep their owner for history.

update public.profiles
   set exclude_from_lead_distribution = true
 where user_id in ('82eaadbd-e023-424c-ac17-0dc223712785',  -- dgiannakakis@itdev.gr
                   '54454bdc-d1b7-4f11-bd7b-49c9d29f29cc'); -- tvogiatzi@itdev.gr

with pool as (
  select t.user_id, t.ord
  from unnest(public.sales_pool_ids()) with ordinality as t(user_id, ord)
),
victims as (
  select id, row_number() over (order by code) as rn
  from public.leads
  where owner_user_id in ('82eaadbd-e023-424c-ac17-0dc223712785',
                          '54454bdc-d1b7-4f11-bd7b-49c9d29f29cc')
    and archived = false
    and converted_at is null
)
update public.leads l
   set owner_user_id = p.user_id
  from victims v
  join pool p
    on p.ord = ((v.rn - 1) % (select count(*) from pool)) + 1
 where l.id = v.id;

select pr.full_name, pr.email, pr.exclude_from_lead_distribution,
       count(l.id) filter (where l.archived = false and l.converted_at is null) as active_leads,
       count(l.id) filter (where l.archived or l.converted_at is not null) as archived_or_converted
from public.profiles pr
join public.user_groups ug on ug.user_id = pr.user_id
join public.groups g on g.id = ug.group_id and g.code = 'sales'
left join public.leads l on l.owner_user_id = pr.user_id
group by pr.user_id, pr.full_name, pr.email, pr.exclude_from_lead_distribution
order by pr.full_name;
