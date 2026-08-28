-- 2026-08-28: Contact editing for everyone who can SEE clients — without
-- granting them clients:edit (full-row UPDATE would let technical staff
-- accidentally change billing-critical fields like country, which drives the
-- VAT rule — see docs/tech/accounting/financial-controls.md).
--
-- Incident: technical users (only accounting + admins hold clients:edit) typed
-- contacts into the job page's ContactsCard; the RLS-blocked UPDATE matched 0
-- rows WITHOUT an error, the autosave reported success, and the contact
-- vanished on refresh. This RPC updates ONLY the contact columns, is allowed
-- for clients:view holders, and raises loudly when the client is missing.

create or replace function public.update_client_contacts(
  p_client_id uuid,
  p_first text default null,
  p_last text default null,
  p_email text default null,
  p_phone text default null,
  p_info text default null,
  p_additional jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.current_user_is_admin() or public.current_user_can('clients', 'view')) then
    raise exception 'not allowed';
  end if;
  if p_additional is not null and jsonb_typeof(p_additional) <> 'array' then
    raise exception 'additional contacts must be an array';
  end if;

  update public.clients
     set contact_first_name  = p_first,
         contact_last_name   = p_last,
         email               = p_email,
         phone               = p_phone,
         contact_info        = p_info,
         additional_contacts = coalesce(p_additional, '[]'::jsonb),
         updated_at          = now()
   where id = p_client_id;

  if not found then
    raise exception 'client not found';
  end if;
end $$;

revoke all on function public.update_client_contacts(uuid, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.update_client_contacts(uuid, text, text, text, text, text, jsonb) to authenticated, service_role;

-- ROLLBACK:
--   drop function if exists public.update_client_contacts(uuid, text, text, text, text, text, jsonb);
