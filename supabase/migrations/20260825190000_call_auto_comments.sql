-- =============================================================================
-- 2026-08-25: every client call becomes an automatic comment on the right
-- card (owner decision): sales agents → lead (or the client's open deal main
-- thread), accounting → deal, technical → their deal channel (deal_dev /
-- deal_seo / deal_ads / deal_social).
--
-- Source: the sales app's call_records (fed by the PBX box) — the pull-calls
-- edge function copies new rows into call_log here; the AFTER INSERT trigger
-- does contact matching (find_contact_by_phone, 20260614000001), department
-- routing from the agent's groups (same precedence as resolve_email_filing),
-- and writes the comment (auto-comment pattern of 20260709170000: security
-- definer, task_key, empty mentions). Comments are dated at the CALL time
-- (created_at = started_at) so the full history (backfilled at deploy, owner
-- request) reads as a true chronological archive on each card.
--
-- No function redefinitions in this migration (all objects are new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

create table if not exists public.call_log (
  yeastar_uid         text primary key,
  extension           text not null,
  agent_user_id       uuid,
  call_type           text not null check (call_type in ('Inbound', 'Outbound')),
  from_number         text,
  to_number           text,
  disposition         text,
  ring_seconds        int not null default 0,
  talk_seconds        int not null default 0,
  started_at          timestamptz not null,
  matched_type        text,
  matched_id          uuid,
  comment_parent_type text,
  comment_id          uuid,
  route_error         text,
  created_at          timestamptz not null default now()
);

create index if not exists call_log_started on public.call_log (started_at desc);
create index if not exists call_log_matched on public.call_log (matched_type, matched_id);

alter table public.call_log enable row level security;
drop policy if exists call_log_admin_select on public.call_log;
create policy call_log_admin_select on public.call_log
  for select to authenticated using (public.current_user_is_admin());
-- Writes: service role only (the puller).

create table if not exists public.call_pull_config (
  id             boolean primary key default true check (id),
  cutover_at     timestamptz not null,
  pulled_through timestamptz not null
);
insert into public.call_pull_config (id, cutover_at, pulled_through)
  values (true, clock_timestamp(), clock_timestamp())
  on conflict (id) do nothing;
alter table public.call_pull_config enable row level security;
revoke all on table public.call_pull_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Routing trigger: matches the call to a card and writes the comment.
-- ---------------------------------------------------------------------------
create or replace function public.call_log_route_comment()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_other text;
  v_key text;
  v_agent uuid;
  v_agent_name text;
  v_dept text;
  v_channel text;
  v_contact record;
  v_deal_id uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_body text;
  v_when text;
  v_comment_id uuid;
  v_tech_groups text[];
begin
  -- 1. The customer-side number.
  v_other := case when new.call_type = 'Outbound' then new.to_number else new.from_number end;
  v_key := right(regexp_replace(coalesce(v_other, ''), '[^0-9]', '', 'g'), 10);
  if char_length(v_key) < 10 then
    update public.call_log set route_error = 'short-number' where yeastar_uid = new.yeastar_uid;
    return null;
  end if;

  -- 2. The agent behind the extension.
  select p.user_id, coalesce(nullif(p.full_name, ''), p.email)
    into v_agent, v_agent_name
    from public.profiles p where p.phone_extension = new.extension limit 1;
  if v_agent is null then
    update public.call_log set route_error = 'no-agent' where yeastar_uid = new.yeastar_uid;
    return null;
  end if;

  begin
    -- 3. Which card? (client first, then lead — find_contact_by_phone order)
    select * into v_contact from public.find_contact_by_phone(v_key) limit 1;
    if v_contact.id is null then
      update public.call_log set agent_user_id = v_agent where yeastar_uid = new.yeastar_uid;
      return null; -- unknown number: keep the log, no comment
    end if;

    -- 4. Department from the agent's groups (resolve_email_filing precedence).
    select array_agg(g.code) into v_tech_groups
      from public.user_groups ug join public.groups g on g.id = ug.group_id
     where ug.user_id = v_agent
       and g.code in ('web_dev', 'web_seo', 'local_seo', 'ai_seo', 'ads', 'social_media');
    if exists (select 1 from public.user_groups ug join public.groups g on g.id = ug.group_id
                where ug.user_id = v_agent and g.code = 'sales') then
      v_dept := 'sales';
    elsif exists (select 1 from public.user_groups ug join public.groups g on g.id = ug.group_id
                   where ug.user_id = v_agent and g.code = 'accounting') then
      v_dept := 'accounting';
    elsif coalesce(array_length(v_tech_groups, 1), 0) >= 1 then
      v_dept := 'technical';
      if array_length(v_tech_groups, 1) = 1 then
        v_channel := case v_tech_groups[1]
          when 'web_dev' then 'dev'
          when 'ads' then 'ads'
          when 'social_media' then 'social'
          else 'seo' end;
      end if;
    else
      v_dept := 'sales';
    end if;

    -- 5. Target card.
    if v_contact.source = 'lead' then
      v_parent_type := 'lead';
      v_parent_id := v_contact.id;
    else
      select d.id into v_deal_id
        from public.deals d
        join public.pipeline_stages s on s.id = d.stage_id
       where d.client_id = v_contact.id and not d.archived and not s.is_terminal
       order by d.created_at desc limit 1;
      if v_deal_id is null then
        -- Fall back to ANY newest non-archived deal, else the client card.
        select d.id into v_deal_id from public.deals d
         where d.client_id = v_contact.id and not d.archived
         order by d.created_at desc limit 1;
      end if;

      if v_deal_id is null then
        v_parent_type := 'client'; v_parent_id := v_contact.id;
      elsif v_dept = 'technical' then
        if v_channel is null then
          -- Infer from the deal's active jobs: a single channel wins.
          select case
                   when count(distinct case
                     when j.service_type = 'web_dev' then 'dev'
                     when j.service_type = 'ads' then 'ads'
                     when j.service_type = 'social_media' then 'social'
                     when j.service_type in ('web_seo','local_seo','ai_seo') then 'seo'
                   end) = 1
                   then min(case
                     when j.service_type = 'web_dev' then 'dev'
                     when j.service_type = 'ads' then 'ads'
                     when j.service_type = 'social_media' then 'social'
                     when j.service_type in ('web_seo','local_seo','ai_seo') then 'seo'
                   end)
                 end
            into v_channel
            from public.jobs j
           where j.deal_id = v_deal_id and not j.archived
             and j.service_type in ('web_dev','web_seo','local_seo','ai_seo','ads','social_media');
        end if;
        v_parent_type := coalesce('deal_' || v_channel, 'deal');
        v_parent_id := v_deal_id;
      else
        v_parent_type := 'deal'; v_parent_id := v_deal_id;
      end if;
    end if;

    -- 6. Greek body, Athens time.
    v_when := to_char(new.started_at at time zone 'Europe/Athens', 'DD/MM HH24:MI');
    if new.call_type = 'Outbound' then
      v_body := '📞 Κλήση από ' || v_agent_name || ' στις ' || v_when
        || case when new.disposition = 'ANSWERED'
             then ' — Απαντήθηκε (' || (new.talk_seconds / 60) || ':' || lpad((new.talk_seconds % 60)::text, 2, '0') || ')'
             else ' — Αναπάντητη' end;
    else
      v_body := '📞 Εισερχόμενη από ' || coalesce(v_other, ';') || ' προς ' || v_agent_name || ' στις ' || v_when
        || case when new.disposition = 'ANSWERED'
             then ' — Απαντήθηκε (' || (new.talk_seconds / 60) || ':' || lpad((new.talk_seconds % 60)::text, 2, '0') || ')'
             else ' — Αναπάντητη' end;
    end if;

    -- 7. The comment (author = the agent; task_key marks it as a system row).
    insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key, created_at)
    values (v_parent_type, v_parent_id, v_agent, v_body, '{}', 'call:' || new.yeastar_uid, new.started_at)
    returning id into v_comment_id;

    update public.call_log
       set agent_user_id = v_agent,
           matched_type = v_contact.source,
           matched_id = v_contact.id,
           comment_parent_type = v_parent_type,
           comment_id = v_comment_id
     where yeastar_uid = new.yeastar_uid;
  exception when others then
    update public.call_log
       set agent_user_id = v_agent, route_error = sqlerrm
     where yeastar_uid = new.yeastar_uid;
  end;

  return null;
end $$;

drop trigger if exists call_log_route_comment on public.call_log;
create trigger call_log_route_comment
  after insert on public.call_log
  for each row execute function public.call_log_route_comment();

-- Cron: pull new calls from the sales DB every 2 minutes.
-- DEPLOY-TIME PREREQUISITES: vault secret call_pull_secret + edge secret
-- CALL_PULL_SECRET (same value); deploy pull-calls (verify_jwt=false).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'pull_calls') then
    perform cron.unschedule('pull_calls');
  end if;
  perform cron.schedule(
    'pull_calls',
    '*/2 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/pull-calls',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'call_pull_secret')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
end $$;

-- ROLLBACK:
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'pull_calls') then
--       perform cron.unschedule('pull_calls');
--     end if;
--   end $$;
--   drop trigger if exists call_log_route_comment on public.call_log;
--   drop function if exists public.call_log_route_comment();
--   drop table if exists public.call_pull_config;
--   drop table if exists public.call_log;
--   -- optionally: delete from public.comments where task_key like 'call:%';
