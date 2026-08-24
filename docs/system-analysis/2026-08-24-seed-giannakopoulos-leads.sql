-- 2026-08-24: New sales rep P. Giannakopoulos (pgiannakopoulos@itdev.gr).
-- Account created via the invite_user flow equivalent (auth admin createUser,
-- email_confirm, must_change_password=true), added to the `sales` group →
-- enters sales_pool_ids() / auto-distribution (auto_enabled was already true).
-- Then 400 leads moved from EACH current pool member (cpostantzian, vdimitrov)
-- to him — untouched stages only (new_lead → no_answer → constant_na, oldest
-- first), stage kept as-is; hot/offer_sent/scheduled/working_on_it and the
-- not_interested/dead_end piles were not touched.
-- Result: 800 leads (684 new_lead + 100 no_answer + 16 constant_na).
-- Executed 2026-08-24 via the Management API (scratchpad script), the
-- reassignment as one transaction with a rolled-back guard on shortfall.

do $$
declare
  v_new uuid;
  v_moved int;
  v_donor record;
begin
  select user_id into v_new from public.profiles where email = 'pgiannakopoulos@itdev.gr';
  if v_new is null then raise exception 'new user profile missing'; end if;

  for v_donor in
    select p.user_id, p.email from public.profiles p
    where p.email in ('cpostantzian@itdev.gr', 'vdimitrov@itdev.gr')
  loop
    with victims as (
      select l.id
      from public.leads l
      join public.pipeline_stages s on s.id = l.stage_id
      where l.owner_user_id = v_donor.user_id
        and l.archived = false and l.converted_at is null
        and s.code in ('new_lead', 'no_answer', 'constant_na')
      order by case s.code when 'new_lead' then 1 when 'no_answer' then 2 else 3 end,
               l.created_at asc
      limit 400
    )
    update public.leads l set owner_user_id = v_new
    from victims v where l.id = v.id;
    get diagnostics v_moved = row_count;
    if v_moved < 400 then
      raise exception 'only % eligible leads at % — rolled back', v_moved, v_donor.email;
    end if;
  end loop;
end $$;

-- Verification (post-run): Carlos 2480→2080, Valentin 2993→2593, Panos 0→800.

-- Addendum (same day): 8 unique_lead leads (oldest first) also moved from
-- Carlos (24→16) to Panos (0→8). Valentin held none; stavroula@'s 14 were
-- left untouched (not in the sales pool). Same UPDATE pattern, stage kept.
