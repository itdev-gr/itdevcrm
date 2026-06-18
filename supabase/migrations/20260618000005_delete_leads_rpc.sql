-- Admin-only PERMANENT delete of leads. After verifying the caller is an admin,
-- it refuses leads in the `won` stage or already converted (deleting those would
-- orphan real customer/billing records), then hard-deletes the rest. Polymorphic
-- lead comments have no FK to leads, so they are removed explicitly here;
-- email_automations cascade and offers.lead_id nulls via existing FKs. The
-- leads after-delete trigger already records each delete in activity_log.
-- Used by src/lib/rpc.ts deleteLeads() / src/features/leads/hooks/useDeleteLeads.ts.

create or replace function public.delete_leads(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deletable uuid[];
  v_skipped uuid[];
  v_count int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_admin'));
  end if;

  -- Partition the requested ids into deletable vs protected (won or converted).
  -- LEFT JOIN + `is distinct from` => a lead with a null stage is deletable.
  select
    coalesce(array_agg(l.id) filter (
      where (ps.code is distinct from 'won') and l.converted_at is null), '{}'),
    coalesce(array_agg(l.id) filter (
      where ps.code = 'won' or l.converted_at is not null), '{}')
  into v_deletable, v_skipped
  from public.leads l
  left join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids);

  -- Polymorphic comments (parent_type='lead') have no FK => delete explicitly.
  delete from public.comments
  where parent_type = 'lead' and parent_id = any(v_deletable);

  -- email_automations cascade; offers.lead_id set null (both via existing FKs).
  delete from public.leads where id = any(v_deletable);
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted_count', v_count,
    'skipped', to_jsonb(coalesce(v_skipped, '{}'::uuid[]))
  );
end;
$$;

grant execute on function public.delete_leads(uuid[]) to authenticated;

-- ROLLBACK:
-- drop function if exists public.delete_leads(uuid[]);
