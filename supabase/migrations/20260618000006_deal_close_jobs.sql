-- When a deal closes, its jobs should be marked done and moved to a terminal
-- "close" lane on their own board. web_seo/local_seo already have "Done";
-- web_dev keeps "Live" but also gets "Closed"; social_media/ads/hosting only had
-- "Cancelled" (client-initiated) so they get a distinct "Closed" lane too.

insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome)
values
  ('web_dev',      'closed', '{"en":"Closed","el":"Κλειστό"}'::jsonb, 120, true, 'completed'),
  ('social_media', 'closed', '{"en":"Closed","el":"Κλειστό"}'::jsonb,  60, true, 'completed'),
  ('ads',          'closed', '{"en":"Closed","el":"Κλειστό"}'::jsonb,  60, true, 'completed'),
  ('hosting',      'closed', '{"en":"Closed","el":"Κλειστό"}'::jsonb,  50, true, 'completed')
on conflict (board, code) do nothing;

-- close_deal: mark the chosen jobs done + move each to a terminal lane on its own
-- board, then move the deal to accounting "Closed". Driven by the close dialog.
-- p_jobs = [{"job_id": uuid, "target_stage_id": uuid}, ...] (only the jobs to close).
create or replace function public.close_deal(p_deal_id uuid, p_jobs jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_acc uuid;
  v_closed int := 0;
  rec jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;

  for rec in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb))
  loop
    update public.jobs j
       set status = 'completed',
           completed_at = coalesce(j.completed_at, now()),
           stage_id = (rec->>'target_stage_id')::uuid,
           is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
      from public.pipeline_stages cur, public.pipeline_stages tgt
     where j.id = (rec->>'job_id')::uuid
       and j.deal_id = p_deal_id
       and not j.archived
       and cur.id = j.stage_id
       and tgt.id = (rec->>'target_stage_id')::uuid
       and tgt.board = cur.board     -- never move a job to another board
       and tgt.is_terminal;          -- only land on a terminal lane
    if found then v_closed := v_closed + 1; end if;
  end loop;

  select id into closed_acc from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'closed' limit 1;
  update public.deals set accounting_stage_id = coalesce(closed_acc, accounting_stage_id)
   where id = p_deal_id;

  return jsonb_build_object('ok', true, 'deal_id', p_deal_id, 'closed_jobs', v_closed);
end $$;

grant execute on function public.close_deal(uuid, jsonb) to authenticated;

-- ROLLBACK:
-- drop function if exists public.close_deal(uuid, jsonb);
-- delete from public.pipeline_stages where code = 'closed'
--   and board in ('web_dev','social_media','ads','hosting');
