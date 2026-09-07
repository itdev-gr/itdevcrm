-- =============================================================================
-- 20260907210000_campaign_recipients_build.sql
-- Επιλογή και καθαρισμός παραληπτών καμπάνιας. Διαβάζει από leads/clients
-- (μόνο SELECT + δύο functional indexes) και από email_suppressions· ΔΕΝ
-- αγγίζει καμία στήλη, constraint, trigger ή policy στα leads, clients,
-- email_log, email_outbox, email_templates, και δεν πειράζει το
-- enqueue_lead_email ή το send-email edge function. Αυτό είναι ρητή απαίτηση
-- του ιδιοκτήτη (2026-09-07): μηδενική επίδραση στα υπάρχοντα αυτόματα email.
-- =============================================================================

-- --- Functional indexes για το matching lower(email) -------------------------
-- Μόνο indexes· καμία αλλαγή στηλών.
create index if not exists leads_email_lower on public.leads (lower(email));
create index if not exists clients_email_lower on public.clients (lower(email));

-- --- 1. campaign_segment_emails ------------------------------------------------
-- Κλειστό λεξιλόγιο, ΠΟΤΕ dynamic SQL από το p_segment (jsonb φόρμας χρήστη).
-- Υποστηρίζονται μόνο:
--   {"leads":   {"stage_codes": [...], "sources": [...], "exclude_converted": bool}}
--   {"clients": {"statuses": [...]}}
-- Οποιοδήποτε άλλο κλειδί (στο top level ή μέσα στα leads/clients) αγνοείται
-- σιωπηλά — δεν διευρύνει ποτέ το κοινό. Τιμές λάθος τύπου (π.χ. string αντί
-- για array) επίσης αγνοούνται σιωπηλά αντί να προκαλέσουν σφάλμα, ώστε ένα
-- μισοσυμπληρωμένο φόρμουλαρι να μην σκάει τη build.
--
-- SECURITY DEFINER γιατί πρέπει να βλέπει leads/clients πέρα από τα δικά του
-- RLS row-visibility rules (π.χ. owner_user_id) για να χτίσει σωστό κοινό·
-- γι' αυτό ελέγχει ρητά admin στο εσωτερικό του αντί να βασίζεται στις
-- policies των πινάκων.
create or replace function public.campaign_segment_emails(p_segment jsonb)
returns table (
  email_lower  text,
  display_name text,
  company      text,
  lead_id      uuid,
  client_id    uuid
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_leads             jsonb := p_segment -> 'leads';
  v_clients           jsonb := p_segment -> 'clients';
  v_stage_codes       text[];
  v_sources           text[];
  v_exclude_converted boolean;
  v_statuses          text[];
begin
  if not (select public.current_user_is_admin()) then
    return;
  end if;

  if jsonb_typeof(v_leads) = 'object' then
    v_stage_codes := case when jsonb_typeof(v_leads -> 'stage_codes') = 'array'
      then array(select jsonb_array_elements_text(v_leads -> 'stage_codes')) end;
    v_sources := case when jsonb_typeof(v_leads -> 'sources') = 'array'
      then array(select jsonb_array_elements_text(v_leads -> 'sources')) end;
    v_exclude_converted := case when jsonb_typeof(v_leads -> 'exclude_converted') = 'boolean'
      then (v_leads ->> 'exclude_converted')::boolean else false end;

    return query
    select
      lower(btrim(l.email)) as email_lower,
      nullif(btrim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), '') as display_name,
      l.company_name as company,
      l.id as lead_id,
      null::uuid as client_id
    from public.leads l
    left join public.pipeline_stages ps on ps.id = l.stage_id
    where l.archived = false
      and l.email is not null and btrim(l.email) <> ''
      and (v_stage_codes is null or ps.code = any (v_stage_codes))
      and (v_sources is null or l.source = any (v_sources))
      and (not v_exclude_converted or l.converted_at is null);
  end if;

  if jsonb_typeof(v_clients) = 'object' then
    v_statuses := case when jsonb_typeof(v_clients -> 'statuses') = 'array'
      then array(select jsonb_array_elements_text(v_clients -> 'statuses')) end;

    -- Σκόπιμα ΔΕΝ φιλτράρουμε clients.archived / status='done' εδώ: αυτές οι
    -- διευθύνσεις πρέπει να περάσουν στο pool ώστε το build_campaign_recipients
    -- να τις γράψει ως γραμμή suppressed/closed_client — όχι να εξαφανιστούν
    -- σιωπηλά πριν καν φτάσουν εκεί (απαίτηση 2 του brief).
    return query
    select
      lower(btrim(c.email)) as email_lower,
      c.name as display_name,
      c.name as company,
      null::uuid as lead_id,
      c.id as client_id
    from public.clients c
    where c.email is not null and btrim(c.email) <> ''
      and (v_statuses is null or c.status = any (v_statuses));
  end if;
end $$;
revoke execute on function public.campaign_segment_emails(jsonb) from public, anon;
grant execute on function public.campaign_segment_emails(jsonb) to authenticated;

-- --- 2. build_campaign_recipients ----------------------------------------------
-- Επαναλήψιμο όσο η καμπάνια είναι draft: σβήνει τις προηγούμενες γραμμές της
-- ίδιας καμπάνιας και ξαναχτίζει. Κάθε διεύθυνση που αποκλείεται γράφεται ΩΣ
-- ΓΡΑΜΜΗ με status='suppressed' και τον λόγο — ποτέ σιωπηλή απόρριψη.
--
-- Ιεράρχηση λόγου όταν ταιριάζουν περισσότεροι από έναν (δεν το ορίζει το
-- brief ρητά· επιλογή εδώ): invalid > suppressed_list > opted_out >
-- closed_client > internal > fatigue — από το πιο θεμελιώδες πρόβλημα
-- (η διεύθυνση δεν είναι καν έγκυρη) στο πιο "μαλακό"/παροδικό (fatigue).
create or replace function public.build_campaign_recipients(p_campaign_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_campaign     public.email_campaigns;
  v_fatigue_days int;
  v_use_segment  boolean;
  v_built        int := 0;
  v_suppressed   int := 0;
  v_by_reason    jsonb;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;
  if v_campaign.status <> 'draft' then
    return jsonb_build_object('ok', false, 'errors', array['not_draft']);
  end if;

  select fatigue_days into v_fatigue_days from public.email_marketing_settings where id = true;
  v_fatigue_days := coalesce(v_fatigue_days, 30);
  v_use_segment := (v_campaign.segment <> '{}'::jsonb);

  -- Επαναληψιμότητα: καθάρισε τις προηγούμενες γραμμές αυτής της καμπάνιας.
  delete from public.email_campaign_recipients where campaign_id = p_campaign_id;

  with pool as (
    -- (α) Όλες οι συνδεδεμένες λίστες.
    select
      m.email_lower as email_raw, m.display_name, m.company,
      null::uuid as lead_id, null::uuid as client_id, m.audience_id,
      2 as priority
    from public.email_audience_members m
    join public.email_campaign_audiences ca on ca.audience_id = m.audience_id
    where ca.campaign_id = p_campaign_id

    union all

    -- (β) Το segment, αν δεν είναι {}.
    select
      s.email_lower, s.display_name, s.company, s.lead_id, s.client_id, null::uuid,
      case when s.client_id is not null then 0 when s.lead_id is not null then 1 else 2 end
    from public.campaign_segment_emails(v_campaign.segment) s
    where v_use_segment
  ),
  norm as (
    -- Κανονικοποίηση: lower+btrim, αφαίρεση "mailto:", πρώτο κομμάτι πριν από ; ή ,.
    select
      lower(btrim(
        substring(regexp_replace(p.email_raw, '^\s*mailto:\s*', '', 'i') from '^[^;,]*')
      )) as email_lower,
      p.display_name, p.company, p.lead_id, p.client_id, p.audience_id, p.priority
    from pool p
  ),
  dedup as (
    -- Αποδιπλασιασμός: πελάτης (0) > lead (1) > μόνο-λίστα (2).
    select distinct on (email_lower)
      email_lower, display_name, company, lead_id, client_id, audience_id
    from norm
    order by email_lower, priority, lead_id nulls last, client_id nulls last
  ),
  enriched as (
    -- Matching με leads/clients μέσω lower(email) (χρησιμοποιεί τα functional
    -- indexes) — και για γραμμές μόνο-λίστας που τυχαίνει να ταιριάζουν με
    -- πραγματικό lead/client, ώστε τα opted_out/closed_client να πιάνονται.
    select
      d.*,
      lm.lead_id as matched_lead_id, lm.opted_out,
      cm.client_id as matched_client_id, cm.closed
    from dedup d
    left join lateral (
      select
        (select l.id from public.leads l
          where lower(l.email) = d.email_lower and l.archived = false
          order by l.created_at desc limit 1) as lead_id,
        exists (
          select 1 from public.leads l
           where lower(l.email) = d.email_lower and l.email_opt_out
        ) as opted_out
    ) lm on true
    left join lateral (
      select
        (select c.id from public.clients c
          where lower(c.email) = d.email_lower
          order by c.created_at desc limit 1) as client_id,
        exists (
          select 1 from public.clients c
           where lower(c.email) = d.email_lower and (c.status = 'done' or c.archived)
        ) as closed
    ) cm on true
  ),
  classified as (
    select
      e.*,
      case
        when e.email_lower !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'invalid'
        when exists (select 1 from public.email_suppressions es where es.email_lower = e.email_lower)
          then 'suppressed_list'
        when e.opted_out then 'opted_out'
        when e.closed then 'closed_client'
        when e.email_lower like '%@itdev.gr'
          or e.email_lower ~ '^(noreply|no-reply|postmaster|abuse|mailer-daemon)@' then 'internal'
        when exists (
          select 1 from public.email_campaign_recipients r
           where r.email_lower = e.email_lower
             and r.campaign_id <> p_campaign_id
             and r.sent_at > now() - (v_fatigue_days || ' days')::interval
        ) then 'fatigue'
        else null
      end as reason
    from enriched e
  )
  insert into public.email_campaign_recipients
    (campaign_id, email_lower, display_name, company, lead_id, client_id, audience_id,
     status, suppression_reason)
  select
    p_campaign_id,
    c.email_lower,
    c.display_name,
    c.company,
    coalesce(c.lead_id, c.matched_lead_id),
    coalesce(c.client_id, c.matched_client_id),
    c.audience_id,
    case when c.reason is null then 'pending' else 'suppressed' end,
    c.reason
  from classified c;

  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'suppressed')
    into v_built, v_suppressed
    from public.email_campaign_recipients
   where campaign_id = p_campaign_id;

  select coalesce(jsonb_object_agg(t.suppression_reason, t.cnt), '{}'::jsonb) into v_by_reason
    from (
      select suppression_reason, count(*) as cnt
        from public.email_campaign_recipients
       where campaign_id = p_campaign_id and status = 'suppressed'
       group by suppression_reason
    ) t;

  update public.email_campaigns
     set prepared_at = now(), status = 'ready', updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object(
    'ok', true, 'built', v_built, 'suppressed', v_suppressed, 'by_reason', v_by_reason);
end $$;
revoke execute on function public.build_campaign_recipients(uuid) from public, anon;
grant execute on function public.build_campaign_recipients(uuid) to authenticated;

-- ROLLBACK: drop function public.build_campaign_recipients(uuid),
--   public.campaign_segment_emails(jsonb);
--   drop index public.leads_email_lower, public.clients_email_lower;
