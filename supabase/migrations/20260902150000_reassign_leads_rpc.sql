-- =========================================================================
-- 20260902150000_reassign_leads_rpc.sql
--
-- Why direct UPDATE cannot reassign: on PostgreSQL 17 the SELECT policy is
-- enforced against the NEW row of an UPDATE. Sales visibility is own-only
-- (leads_select, 20260618000009), so the moment a rep sets owner to someone
-- else the new row is no longer visible to them and the UPDATE fails with
-- "new row violates row-level security policy for table leads" — even though
-- leads_update explicitly allows it. Isolated empirically 2026-09-02:
-- with_check := true still failed; leads_select USING(true) made the same
-- UPDATE succeed. (This is also what the reps' screenshot error was.)
--
-- Fix: reassignment goes through a SECURITY DEFINER RPC that revalidates the
-- same rule as leads_update USING (admin | sales/view_all | current owner)
-- and performs the write with RLS bypassed. Row triggers still fire
-- (cadence-task transfer, activity log with the caller's auth.uid()).
-- =========================================================================

create or replace function public.reassign_leads(p_lead_ids uuid[], p_new_owner uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_owner uuid; v_moved int := 0;
begin
  if p_new_owner is not null and not exists (
       select 1 from public.profiles p
        where p.user_id = p_new_owner and p.is_active and not p.archived) then
    raise exception 'target user not found or inactive';
  end if;
  foreach v_id in array p_lead_ids loop
    select owner_user_id into v_owner from public.leads where id = v_id;
    if not found then continue; end if;
    if public.current_user_is_admin()
       or public.current_user_can('sales', 'view_all')
       or v_owner = auth.uid() then
      update public.leads set owner_user_id = p_new_owner where id = v_id;
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end $$;

revoke execute on function public.reassign_leads(uuid[], uuid) from public, anon;
grant execute on function public.reassign_leads(uuid[], uuid) to authenticated;

-- ROLLBACK: drop function public.reassign_leads(uuid[], uuid);
