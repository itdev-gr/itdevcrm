-- =============================================================================
-- 20260907220000_campaign_queue_ops.sql
-- Ουρά αποστολής, έλεγχος κύκλου ζωής, στατιστικά και pacing για τις καμπάνιες
-- marketing (email_campaign_recipients / email_campaigns). Νέο, ξεχωριστό cron
-- — δεν αγγίζει καθόλου το cron job του transactional outbox, τα claim/
-- recovery functions του (βλ. 20260625150000), ή οτιδήποτε κάτω από
-- supabase/functions/send-email/.
-- Ρητή απαίτηση του ιδιοκτήτη (2026-09-07): μηδενική επίδραση στα υπάρχοντα
-- αυτόματα email.
-- =============================================================================

-- --- 1. claim_campaign_recipients --------------------------------------------
-- Ίδιο μοτίβο κλειδώματος με το claim_email_outbox
-- (20260625150000_email_drain_claim_infra.sql:26-42): FOR UPDATE SKIP LOCKED
-- ώστε δύο ταυτόχρονα drains να μην πιάσουν ποτέ την ίδια γραμμή.
-- Διαφορές από το transactional claim: παίρνει campaign id, όριο attempts<3
-- (όχι <5), και προσθέτει join στο email_campaigns για να μην κλειδώσει ποτέ
-- γραμμές καμπάνιας που δεν είναι πλέον 'sending' (π.χ. μόλις ακυρώθηκε ή
-- μπήκε σε pause ανάμεσα σε δύο drain ticks) — άμυνα σε βάθος πέρα από ό,τι
-- ζητά ρητά το brief, καθώς εδώ ένα claim είναι έως 100 πραγματικοί άνθρωποι.
create or replace function public.claim_campaign_recipients(p_campaign_id uuid, p_limit int default 100)
returns setof public.email_campaign_recipients
language sql
security definer
set search_path = public
as $$
  update public.email_campaign_recipients r
     set status = 'sending', claimed_at = now(), attempts = r.attempts + 1
   where r.id in (
     select er.id
       from public.email_campaign_recipients er
       join public.email_campaigns ec on ec.id = er.campaign_id
      where er.campaign_id = p_campaign_id
        and er.status = 'pending'
        and er.attempts < 3
        and ec.status = 'sending'
      order by er.queued_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning r.*;
$$;

revoke all on function public.claim_campaign_recipients(uuid, int) from public, anon, authenticated;

-- --- 2. recover_stale_campaign_claims ----------------------------------------
-- Ίδιο σχήμα με το recover_stale_email_claims, ΑΛΛΑ 30 λεπτά κατώφλι αντί για
-- 5': με batch αποστολή (έως 100 γραμμές ανά claim), μια πρόωρη επαναφορά θα
-- ξανάστελνε σε έως 100 πραγματικά άτομα ενώ το προηγούμενο batch απλώς αργεί
-- να ολοκληρωθεί (rate-limited προς το Resend), όχι επειδή κόλλησε.
create or replace function public.recover_stale_campaign_claims(p_older_than interval default interval '30 minutes')
returns int
language sql
security definer
set search_path = public
as $$
  with reset as (
    update public.email_campaign_recipients
       set status = 'pending', claimed_at = null
     where status = 'sending'
       and claimed_at is not null
       and claimed_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from reset;
$$;

revoke all on function public.recover_stale_campaign_claims(interval) from public, anon, authenticated;

-- --- 3. campaign_daily_budget -------------------------------------------------
-- Πόσα emails επιτρέπεται να φύγουν ΤΩΡΑ. Αυτό είναι το function με το
-- πραγματικό ρίσκο (deliverability domain-wide) — βλέπε σχόλια inline.
create or replace function public.campaign_daily_budget(p_campaign_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_campaign     public.email_campaigns;
  v_settings     public.email_marketing_settings;
  v_local_now    timestamp;
  v_day_start    timestamptz;
  v_hour_start   timestamptz;
  v_ladder_len   int;
  v_ladder_days  int;
  v_ladder_idx   int;
  v_ladder_value int;
  v_daily_cap    int;
  v_hourly_cap   int;
  v_sent_today   int;
  v_sent_hour    int;
begin
  select * into v_campaign from public.email_campaigns where id = p_campaign_id;
  -- Άγνωστη καμπάνια, ή καμπάνια που δεν είναι ενεργά σε αποστολή (π.χ. σε
  -- pause/cancelled/draft) ⇒ μηδενικό budget. Δεν το ζητά ρητά το brief, αλλά
  -- είναι η ασφαλής ερμηνεία: μια καμπάνια που δεν είναι 'sending' δεν πρέπει
  -- να παίρνει budget ποτέ, ό,τι κι αν λέει η σκάλα.
  if not found or v_campaign.status <> 'sending' then
    return 0;
  end if;

  select * into v_settings from public.email_marketing_settings where id = true;
  if not found or v_settings.paused then
    return 0;
  end if;

  -- Όρια ημέρας/ώρας σε Europe/Athens, όχι UTC (το send window του ιδιοκτήτη
  -- εκφράζεται σε τοπική ώρα) — ίδιο idiom με
  -- 20260831240000_ud_business_hours_due.sql / 20260903170000_email_times_athens.sql:
  -- timestamptz -> naive τοπική ώρα, date_trunc, naive -> timestamptz πίσω.
  v_local_now  := now() at time zone 'Europe/Athens';
  v_day_start  := date_trunc('day', v_local_now) at time zone 'Europe/Athens';
  v_hour_start := date_trunc('hour', v_local_now) at time zone 'Europe/Athens';

  -- Θέση στη σκάλα warm-up: μέρες από το warmup_started_on, clamped στο
  -- τελευταίο σκαλί. NULL warmup_started_on ⇒ μέρα 0 (το πιο συντηρητικό,
  -- πρώτο σκαλί). Άδειος πίνακας σκάλας (κακή ρύθμιση) ⇒ 0 budget αντί για
  -- σφάλμα ή απεριόριστο.
  v_ladder_len := coalesce(array_length(v_settings.warmup_ladder, 1), 0);
  if v_ladder_len = 0 then
    return 0;
  end if;
  v_ladder_days := case when v_settings.warmup_started_on is null then 0
    else greatest(0, (v_local_now::date - v_settings.warmup_started_on)) end;
  v_ladder_idx := least(v_ladder_days + 1, v_ladder_len);
  v_ladder_value := v_settings.warmup_ladder[v_ladder_idx];

  v_daily_cap  := least(v_ladder_value, coalesce(v_campaign.daily_cap, v_settings.daily_cap));
  v_hourly_cap := coalesce(v_campaign.hourly_cap, v_settings.hourly_cap);

  -- Domain-wide: οι πάροχοι βλέπουν ΜΙΑ ταυτότητα αποστολής, άρα μετράμε ό,τι
  -- έχει ήδη σταλεί σήμερα/αυτή την ώρα από ΟΛΕΣ τις καμπάνιες, όχι μόνο αυτή.
  select count(*) into v_sent_today
    from public.email_campaign_recipients
   where status = 'sent' and sent_at >= v_day_start;

  select count(*) into v_sent_hour
    from public.email_campaign_recipients
   where status = 'sent' and sent_at >= v_hour_start;

  return greatest(0, least(v_daily_cap - v_sent_today, v_hourly_cap - v_sent_hour));
end;
$$;

-- Σκόπιμα ΧΩΡΙΣ έλεγχο current_user_is_admin() εδώ: το καλεί το send-campaign
-- edge function μέσω service_role key σε κάθε drain tick, όπου δεν υπάρχει
-- πραγματικό auth.uid() (θα ήταν πάντα NULL) — ένας τέτοιος έλεγχος θα
-- επέστρεφε πάντα 0 και θα σταματούσε σιωπηλά κάθε αποστολή. Η προστασία
-- είναι το ίδιο revoke-all μοτίβο με τα claim/recover functions παραπάνω:
-- κανένα grant σε authenticated, άρα άχρηστο σε client-side κλήσεις — μόνο ο
-- service_role (μέσω cron/edge function) το τρέχει ποτέ.
revoke all on function public.campaign_daily_budget(uuid) from public, anon, authenticated;

-- --- 4. Κύκλος ζωής: launch / pause / resume / cancel ------------------------
-- Admin-only, με ελέγχους μετάβασης. Η άρνηση επιστρέφει
-- {"ok":false,"errors":[...]} αντί να κάνει raise, ώστε το frontend να δείξει
-- λίστα λόγων στον χρήστη αντί για γενικό σφάλμα.
create or replace function public.campaign_launch(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign    public.email_campaigns;
  v_errors      text[] := '{}';
  v_has_pending boolean;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  -- Launch ξεκινά μόνο από 'ready' (μετά το build_campaign_recipients) ή
  -- 'scheduled'. Το 'paused' έχει δικό του ρήμα (resume) — δεν το δεχόμαστε
  -- εδώ, ώστε το ξεκίνημα να είναι πάντα ρητή, ξεχωριστή ενέργεια.
  if v_campaign.status not in ('ready', 'scheduled') then
    v_errors := v_errors || 'invalid_state';
  end if;
  if v_campaign.prepared_at is null then
    v_errors := v_errors || 'not_prepared';
  end if;
  if coalesce(btrim(v_campaign.subject), '') = '' then
    v_errors := v_errors || 'empty_subject';
  end if;
  if coalesce(btrim(v_campaign.body_md), '') = '' then
    v_errors := v_errors || 'empty_body';
  end if;

  select exists(
    select 1 from public.email_campaign_recipients
     where campaign_id = p_campaign_id and status = 'pending'
  ) into v_has_pending;
  if not v_has_pending then
    v_errors := v_errors || 'no_pending_recipients';
  end if;

  if coalesce(array_length(v_errors, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  update public.email_campaigns
     set status = 'sending', started_at = coalesce(started_at, now()), updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'sending');
end;
$$;

revoke execute on function public.campaign_launch(uuid) from public, anon;
grant execute on function public.campaign_launch(uuid) to authenticated;

create or replace function public.campaign_pause(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.email_campaigns;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  if v_campaign.status <> 'sending' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  update public.email_campaigns
     set status = 'paused', updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'paused');
end;
$$;

revoke execute on function public.campaign_pause(uuid) from public, anon;
grant execute on function public.campaign_pause(uuid) to authenticated;

create or replace function public.campaign_resume(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.email_campaigns;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  if v_campaign.status <> 'paused' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  -- Ένα χειροκίνητο resume καθαρίζει και τυχόν autopause_reason: ο χειριστής
  -- είδε το γιατί σταμάτησε και αποφάσισε ρητά να συνεχίσει.
  update public.email_campaigns
     set status = 'sending', autopause_reason = null, updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'sending');
end;
$$;

revoke execute on function public.campaign_resume(uuid) from public, anon;
grant execute on function public.campaign_resume(uuid) to authenticated;

create or replace function public.campaign_cancel(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.email_campaigns;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  -- Terminal: μια ήδη σταλμένη ή ήδη ακυρωμένη καμπάνια δεν ακυρώνεται ξανά.
  -- Κάθε άλλη κατάσταση (draft/ready/scheduled/sending/paused) μπορεί.
  if v_campaign.status in ('sent', 'cancelled') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  update public.email_campaigns
     set status = 'cancelled', finished_at = coalesce(finished_at, now()), updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'cancelled');
end;
$$;

revoke execute on function public.campaign_cancel(uuid) from public, anon;
grant execute on function public.campaign_cancel(uuid) to authenticated;

-- --- 5. campaign_stats ---------------------------------------------------------
-- Πλήθη ανά status, ανά suppression_reason, και οι μετρητές
-- sent/delivered/bounced/complained/unsubscribed. SECURITY DEFINER παρακάμπτει
-- το RLS (admin-only select) του email_campaign_recipients, άρα ελέγχει ρητά
-- admin εσωτερικά.
create or replace function public.campaign_stats(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select jsonb_build_object(
    'ok', true,
    'campaign_id', p_campaign_id,
    'by_status', coalesce((
      select jsonb_object_agg(t.status, t.cnt) from (
        select status, count(*) as cnt
          from public.email_campaign_recipients
         where campaign_id = p_campaign_id
         group by status
      ) t
    ), '{}'::jsonb),
    'by_suppression_reason', coalesce((
      select jsonb_object_agg(t.suppression_reason, t.cnt) from (
        select suppression_reason, count(*) as cnt
          from public.email_campaign_recipients
         where campaign_id = p_campaign_id and suppression_reason is not null
         group by suppression_reason
      ) t
    ), '{}'::jsonb),
    'sent', (select count(*) from public.email_campaign_recipients where campaign_id = p_campaign_id and sent_at is not null),
    'delivered', (select count(*) from public.email_campaign_recipients where campaign_id = p_campaign_id and delivered_at is not null),
    'bounced', (select count(*) from public.email_campaign_recipients where campaign_id = p_campaign_id and bounced_at is not null),
    'complained', (select count(*) from public.email_campaign_recipients where campaign_id = p_campaign_id and complained_at is not null),
    'unsubscribed', (select count(*) from public.email_campaign_recipients where campaign_id = p_campaign_id and unsubscribed_at is not null)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.campaign_stats(uuid) from public, anon;
grant execute on function public.campaign_stats(uuid) to authenticated;

-- --- 6. Cron: drain + stale-claim recovery ------------------------------------
-- Ίδιο μοτίβο Vault/pg_net με 20260602000002_email_drain_cron.sql:1-24 — μόνο
-- το όνομα του job, το schedule και η στοχευόμενη function αλλάζουν. Ξεχωριστό
-- job από το transactional outbox drain, ώστε να μην αγγίζεται ποτέ.
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'drain_campaign_sends') then
    perform cron.unschedule('drain_campaign_sends');
  end if;
  perform cron.schedule(
    'drain_campaign_sends',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-campaign',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := jsonb_build_object('drain', true)
      );
    $cron$
  );
end $$;

-- Ανάκτηση κολλημένων claims κάθε 10': απευθείας κλήση SQL function, όχι HTTP
-- (δεν χρειάζεται το edge function για αυτό).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recover_campaign_claims') then
    perform cron.unschedule('recover_campaign_claims');
  end if;
  perform cron.schedule(
    'recover_campaign_claims',
    '*/10 * * * *',
    $cron$ select public.recover_stale_campaign_claims(); $cron$
  );
end $$;

-- ============================================================================
-- ROLLBACK (run manually to roll back this migration):
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'drain_campaign_sends') then
--       perform cron.unschedule('drain_campaign_sends');
--     end if;
--     if exists (select 1 from cron.job where jobname = 'recover_campaign_claims') then
--       perform cron.unschedule('recover_campaign_claims');
--     end if;
--   end $$;
--   drop function if exists public.campaign_stats(uuid);
--   drop function if exists public.campaign_cancel(uuid);
--   drop function if exists public.campaign_resume(uuid);
--   drop function if exists public.campaign_pause(uuid);
--   drop function if exists public.campaign_launch(uuid);
--   drop function if exists public.campaign_daily_budget(uuid);
--   drop function if exists public.recover_stale_campaign_claims(interval);
--   drop function if exists public.claim_campaign_recipients(uuid, int);
--   update public.email_campaign_recipients set status='pending', claimed_at=null where status='sending';
-- ============================================================================
