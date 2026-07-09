-- 2026-07-09: decide how a captured email is filed. security definer because it
-- reads profiles/clients/deals/jobs across RLS. Returns 0 rows => don't store.
create or replace function public.resolve_email_filing(p_from text, p_to text, p_subject text)
returns table (client_id uuid, deal_id uuid, job_id uuid, department text, staff_user_id uuid, direction text)
language plpgsql security definer set search_path = public stable
as $$
declare
  v_from text := lower(trim(coalesce(p_from,'')));
  v_to   text := lower(trim(coalesce(p_to,'')));
  v_from_staff boolean := exists (select 1 from profiles where lower(email)=v_from);
  v_to_staff   boolean := exists (select 1 from profiles where lower(email)=v_to);
  v_staff_email text; v_client_email text; v_dir text;
  v_staff uuid; v_client uuid; v_dept text; v_deal uuid; v_job uuid; v_code text;
begin
  -- Exactly one side must be staff (a client<->staff email). Skip internal
  -- staff-to-staff and mail with no staff party at all.
  if v_from_staff and v_to_staff then return; end if;
  if v_from_staff then
    v_staff_email:=v_from; v_client_email:=v_to; v_dir:='outbound';
  elsif v_to_staff then
    v_staff_email:=v_to; v_client_email:=v_from; v_dir:='inbound';
  else
    return;  -- no staff party
  end if;

  select user_id into v_staff from profiles where lower(email)=v_staff_email limit 1;

  -- Code is authoritative: a job code in the subject files the email on that
  -- job + deal and derives the client from the deal -- even when the other
  -- party's address is not the client's registered email (agencies, alternate
  -- contacts). This is exactly what the deal codes are for.
  v_code := substring(coalesce(p_subject,'') from '(\d{6}-[A-Z]{3,})');
  if v_code is not null then
    -- Department comes from the JOB'S SERVICE (deterministic), not the person: a
    -- person may belong to many groups (the owner is in five), but the code
    -- identifies the service, and service_type equals the group code.
    select j.id, j.deal_id, d.client_id, j.service_type
      into v_job, v_deal, v_client, v_dept
      from jobs j join deals d on d.id = j.deal_id
     where j.code = v_code limit 1;
  end if;

  -- No code (or unknown code): fall back to matching the external address to a
  -- known client, and file on that client's newest active deal. Unknown party
  -- with no code => skip (privacy). Uncoded client mail is relationship/sales.
  if v_client is null then
    select id into v_client from clients where lower(email)=v_client_email limit 1;
    if v_client is null then return; end if;
    select d.id into v_deal from deals d
      where d.client_id=v_client and d.archived=false
      order by d.created_at desc limit 1;
    v_dept := 'sales';
  end if;

  -- Keep department only if it maps to a real team group (service_type 'other'
  -- has none); otherwise null => visible to the participant + admins only.
  if v_dept is not null and not exists (select 1 from groups g where g.code = v_dept) then
    v_dept := null;
  end if;

  return query select v_client, v_deal, v_job, v_dept, v_staff, v_dir;
end $$;

grant execute on function public.resolve_email_filing(text,text,text) to service_role;

-- ROLLBACK: drop function if exists public.resolve_email_filing(text,text,text);
