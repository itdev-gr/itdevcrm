-- ============================================================================
-- One-shot merge of 14 high-confidence duplicate lead groups (email + phone
-- both match, no won lead in the group).
--
-- Merge = keeper (most-advanced stage → has-owner → oldest) absorbs loser's
-- blank-fill data + adds loser's phone/email to additional_contacts if
-- different + appends loser's notes to keeper's intake_log. Loser archived
-- with archived_reason='duplicate_merge_20260701'.
--
-- SKIPPED (not auto-merged, listed here for audit):
--   Email nikkas1@gmail.com (005467 won)  — never touch won.
--   Phone 6974137718 (both won)           — never touch won.
--   Phone 6978010678 (000970 dead_end vs 005070 won) — won side wins, skip.
--   Phone 6980000000 (kifokeris placeholder)  — internal + won.
--   Phone 6981014074 (both won)           — never touch won.
--   Phone 6934051609 (different names + emails) — likely different people.
--   Phone 6940003234 (same-ish name but 2 email accounts) — manual review.
--   Phone 6986569556 (different names + emails) — likely different people.
-- ============================================================================

-- Backup table for reversal.
create table if not exists public.leads_dup_merge_backup_20260701 (
  keeper_id uuid,
  loser_id uuid,
  match_key text,
  match_kind text,
  loser_row jsonb,
  keeper_prev_intake_log text,
  keeper_prev_additional_contacts jsonb,
  keeper_prev_stage_id uuid,
  keeper_prev_notes text,
  backed_up_at timestamptz default now()
);

-- Stage rank helper (won never appears in mergeable groups → we still assign
-- 999 defensively so anything odd short-circuits).
create or replace function public.sales_stage_rank(p_code text) returns int
language sql immutable as $$
  select case p_code
    when 'won' then 999
    when 'hot' then 90
    when 'scheduled' then 80
    when 'offer_sent' then 70
    when 'working_on_it' then 60
    when 'new_lead' then 50
    when 'unique_lead' then 40
    when 'no_answer' then 30
    when 'constant_na' then 25
    when 'not_interested' then 20
    when 'dead_end' then 10
    else 0
  end;
$$;

-- Main sweep.
do $$
declare
  g record;
  keeper record;
  loser record;
  v_block text;
  v_new_contact jsonb;
begin
  for g in
    with candidates as (
      select l.id, l.code, lower(trim(l.email)) as email_key, l.phone_normalized as phone_key,
             ps.code as stage_code, public.sales_stage_rank(ps.code) as rank,
             (l.owner_user_id is not null) as has_owner, l.created_at
        from public.leads l
        join public.pipeline_stages ps on ps.id = l.stage_id
       where not l.archived and l.email is not null and l.email <> ''
    ),
    groups as (
      select email_key, count(*) cnt,
             count(*) filter (where stage_code = 'won') won_cnt,
             count(distinct phone_key) distinct_phones
        from candidates
       group by email_key
      having count(*) > 1
    )
    select gr.email_key
      from groups gr
     where gr.won_cnt = 0
       and gr.distinct_phones = 1
  loop
    -- Keeper = highest rank, tiebreak has_owner desc, then oldest.
    select l.id, l.code, l.contact_first_name, l.contact_last_name, l.email, l.phone,
           l.phone_normalized, l.website, l.company_name, l.notes, l.intake_log,
           l.additional_contacts, l.stage_id
      into keeper
      from public.leads l
      join public.pipeline_stages ps on ps.id = l.stage_id
     where not l.archived and lower(trim(l.email)) = g.email_key
     order by public.sales_stage_rank(ps.code) desc,
              (l.owner_user_id is not null) desc,
              l.created_at asc
     limit 1;

    for loser in
      select l.id, l.code, l.contact_first_name, l.contact_last_name, l.email, l.phone,
             l.phone_normalized, l.website, l.company_name, l.notes, l.notes as loser_notes,
             row_to_json(l)::jsonb as loser_row
        from public.leads l
       where not l.archived
         and lower(trim(l.email)) = g.email_key
         and l.id <> keeper.id
    loop
      -- Backup first.
      insert into public.leads_dup_merge_backup_20260701
        (keeper_id, loser_id, match_key, match_kind, loser_row,
         keeper_prev_intake_log, keeper_prev_additional_contacts,
         keeper_prev_stage_id, keeper_prev_notes)
      values (keeper.id, loser.id, g.email_key, 'email', loser.loser_row,
              keeper.intake_log, keeper.additional_contacts,
              keeper.stage_id, keeper.notes);

      -- Build merge block (mirrors format_intake_merge_block style, kept short).
      v_block := E'[merged from ' || loser.code || ' on ' || to_char(now() at time zone 'Europe/Athens', 'DD/MM/YYYY HH24:MI') || ']';
      if coalesce(trim(loser.notes), '') <> '' then
        v_block := v_block || E'\n' || loser.notes;
      end if;

      -- Compute a possible extra-contact entry if loser has an email/phone that
      -- differs from keeper's post-blank-fill primary. In this batch same-email
      -- + same-phone so this is generally a no-op — kept for defense.
      v_new_contact := null;
      if (coalesce(trim(loser.email),'') <> '' and lower(trim(loser.email)) <> lower(coalesce(trim(keeper.email),'')))
         or (coalesce(trim(loser.phone),'') <> '' and regexp_replace(coalesce(loser.phone,''), '[^0-9]', '', 'g') <> regexp_replace(coalesce(keeper.phone,''), '[^0-9]', '', 'g'))
      then
        v_new_contact := jsonb_build_object(
          'full_name', nullif(trim(coalesce(loser.contact_first_name,'') || ' ' || coalesce(loser.contact_last_name,'')), ''),
          'email', loser.email,
          'phone', loser.phone,
          'info', 'from merged lead ' || loser.code
        );
      end if;

      update public.leads k set
        contact_first_name  = coalesce(nullif(trim(k.contact_first_name),''), nullif(trim(loser.contact_first_name),''), k.contact_first_name),
        contact_last_name   = coalesce(nullif(trim(k.contact_last_name),''),  nullif(trim(loser.contact_last_name),''),  k.contact_last_name),
        email               = coalesce(nullif(trim(k.email),''),              nullif(trim(loser.email),''),              k.email),
        phone               = coalesce(nullif(trim(k.phone),''),              nullif(trim(loser.phone),''),              k.phone),
        website             = coalesce(nullif(trim(k.website),''),            nullif(trim(loser.website),''),            k.website),
        company_name        = coalesce(nullif(trim(k.company_name),''),       nullif(trim(loser.company_name),''),       k.company_name),
        additional_contacts = case when v_new_contact is not null then
            coalesce(k.additional_contacts, '[]'::jsonb) || jsonb_build_array(v_new_contact)
          else k.additional_contacts end,
        intake_log = case when coalesce(k.intake_log,'') = '' then v_block else k.intake_log || E'\n' || v_block end,
        updated_at = now()
      where k.id = keeper.id;

      -- Archive loser.
      update public.leads
         set archived = true,
             archived_at = now(),
             archived_reason = 'duplicate_merge_20260701'
       where id = loser.id and not archived;

    end loop;
  end loop;
end $$;
