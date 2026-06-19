-- Fix: releasing a held duplicate must land it in the normal "New Lead" sales
-- column, not "Unique Lead". The unique_lead stage is restricted to mkifokeris (and
-- the service-role webhook); a logged-in admin releasing from the review queue would
-- otherwise be blocked by leads_enforce_stage_restriction. A released lead has already
-- been vetted by the reviewer, so the active New Lead pipeline is the correct target.

create or replace function public.release_lead_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_lead_id uuid;
  v_new_lead_stage uuid;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  select * into r from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_found'));
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('already_' || r.status));
  end if;

  select id into v_new_lead_stage
    from public.pipeline_stages
   where board = 'sales' and code = 'new_lead'
   limit 1;

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, contact_info, stage_id
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website, r.company_name, r.contact_info, v_new_lead_stage
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$$;

grant execute on function public.release_lead_intake(uuid) to authenticated;

-- ROLLBACK: re-apply the release_lead_intake body from 20260619160000_lead_intake.sql
-- (which inserts without an explicit stage_id, routing meta leads to unique_lead).
