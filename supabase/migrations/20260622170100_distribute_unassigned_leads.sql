-- Assign every active, unassigned lead via the round-robin pool (pick_next_sales_assignee
-- respects exclude_from_lead_distribution, so the paused rep is skipped). Same logic as the
-- distribute_unassigned_leads RPC, run once here as a cleanup.
do $$
declare
  r record;
  assignee uuid;
begin
  for r in
    select id from public.leads
     where archived = false and converted_at is null and owner_user_id is null
     order by code
  loop
    assignee := public.pick_next_sales_assignee();
    exit when assignee is null;  -- empty pool
    update public.leads set owner_user_id = assignee where id = r.id;
  end loop;
end $$;
