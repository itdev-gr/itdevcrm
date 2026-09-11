-- =============================================================================
-- 20260911140000_campaign_live_edit_and_pacing_mode.sql
--
-- Owner 2026-09-11, δύο ζητούμενα πάνω στην τρέχουσα καμπάνια Local SEO:
--   (α) «γενικά στην επεξεργασία να μπορώ να κάνω edit τα πάντα» — σήμερα το
--       campaign_update απορρίπτει ΚΑΘΕ patch μόλις η καμπάνια φύγει από
--       draft/ready (20260907270000:103-105), οπότε μια καμπάνια που τρέχει
--       είναι εντελώς αμετάβλητη: ούτε ρυθμός, ούτε διόρθωση τυπογραφικού.
--   (β) «να μπορώ να διαλέγω αν θέλω κλιμακωτό email chain ή αν θέλω να
--       στέλνει κάθε μέρα ό,τι του πω εγώ» — σήμερα η σκάλα warm-up είναι
--       ΠΑΝΤΑ οροφή (campaign_daily_budget 20260907220000:130,
--       least(σκάλα, όριο)) και δεν εκτίθεται πουθενά· ανεβάζοντας μόνο το
--       ημερήσιο όριο δεν αλλάζει τίποτα, σιωπηλά.
--
-- ΑΣΦΑΛΕΣ ΕΞ ΟΡΙΣΜΟΥ: ο drain ξαναδιαβάζει καμπάνια + budget σε κάθε χτύπο
-- (send-campaign/index.ts:153-164 και :474-477) — μηδενικό caching, καμία
-- επανεκκίνηση· μια αλλαγή ισχύει στον επόμενο κύκλο (≤1 λεπτό).
--
-- Η ΜΙΑ ΕΞΑΙΡΕΣΗ που μένει κλειδωμένη: το `segment`. Ένα patch που το
-- περιέχει μηδενίζει prepared_at και γυρίζει status σε draft (:175-176).
-- Πάνω σε καμπάνια που έχει ήδη στείλει, το build_campaign_recipients
-- αρνείται (already_sent) και το campaign_launch αρνείται (not_prepared) —
-- η καμπάνια αχρηστεύεται ΜΟΝΙΜΑ, με μόνη διέξοδο την ακύρωση. Επιστρέφει
-- πλέον ρητό `recipients_locked` αντί για γενικό invalid_state.
-- (campaign_attach_audience/detach μένουν αμετάβλητα για τον ίδιο λόγο.)
--
-- Redefines — drift-check πριν την εφαρμογή (σύμβαση repo):
--   campaign_update()        — τελευταία εκδοχή repo: 20260907270000
--   campaign_daily_budget()  — τελευταία εκδοχή repo: 20260907220000
-- Τα pre/post md5(pg_get_functiondef(oid)) καταγράφονται από το apply script.
-- =============================================================================

-- --- 1. Επιλογή ρυθμού ανά καμπάνια ------------------------------------------
-- true (προεπιλογή, = σημερινή συμπεριφορά) → η σκάλα warm-up είναι οροφή.
-- false → ισχύει ΑΚΡΙΒΩΣ το ημερήσιο όριο της καμπάνιας/των ρυθμίσεων.
-- Το ωριαίο όριο και το παράθυρο αποστολής ισχύουν και στις δύο λειτουργίες:
-- είναι ομαλοποίηση μέσα στην ημέρα, όχι κλιμάκωση.
alter table public.email_campaigns
  add column if not exists warmup_enabled boolean not null default true;

comment on column public.email_campaigns.warmup_enabled is
  'true = the warm-up ladder caps this campaign''s daily volume (default); false = send exactly the configured daily cap, no ramp. Read by campaign_daily_budget.';

-- --- 2. campaign_daily_budget: σέβεται την επιλογή ---------------------------
-- Σώμα αυτούσιο από 20260907220000· αλλάζει ΜΟΝΟ η γραμμή v_daily_cap.
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
  if not found or v_campaign.status <> 'sending' then
    return 0;
  end if;

  select * into v_settings from public.email_marketing_settings where id = true;
  if not found or v_settings.paused then
    return 0;
  end if;

  v_local_now  := now() at time zone 'Europe/Athens';
  v_day_start  := date_trunc('day', v_local_now) at time zone 'Europe/Athens';
  v_hour_start := date_trunc('hour', v_local_now) at time zone 'Europe/Athens';

  v_ladder_len := coalesce(array_length(v_settings.warmup_ladder, 1), 0);
  -- Άδεια σκάλα = κακή ρύθμιση. Όταν το warm-up είναι ΕΝΕΡΓΟ αυτό σημαίνει
  -- «δεν ξέρουμε οροφή» ⇒ 0 (συντηρητικό, όπως πριν). Όταν είναι ΑΝΕΝΕΡΓΟ η
  -- σκάλα δεν συμμετέχει καθόλου, οπότε δεν πρέπει να μπλοκάρει την αποστολή.
  if v_ladder_len = 0 and v_campaign.warmup_enabled then
    return 0;
  end if;

  if v_campaign.warmup_enabled then
    v_ladder_days := case when v_settings.warmup_started_on is null then 0
      else greatest(0, (v_local_now::date - v_settings.warmup_started_on)) end;
    v_ladder_idx := least(v_ladder_days + 1, v_ladder_len);
    v_ladder_value := v_settings.warmup_ladder[v_ladder_idx];
    v_daily_cap := least(v_ladder_value, coalesce(v_campaign.daily_cap, v_settings.daily_cap));
  else
    v_daily_cap := coalesce(v_campaign.daily_cap, v_settings.daily_cap);
  end if;

  v_hourly_cap := coalesce(v_campaign.hourly_cap, v_settings.hourly_cap);

  -- Domain-wide: οι πάροχοι βλέπουν ΜΙΑ ταυτότητα αποστολής.
  select count(*) into v_sent_today
    from public.email_campaign_recipients
   where status = 'sent' and sent_at >= v_day_start;

  select count(*) into v_sent_hour
    from public.email_campaign_recipients
   where status = 'sent' and sent_at >= v_hour_start;

  return greatest(0, least(v_daily_cap - v_sent_today, v_hourly_cap - v_sent_hour));
end;
$$;

-- --- 3. campaign_update: επεξεργασία ζωντανής καμπάνιας ----------------------
-- Σώμα από 20260907270000· αλλάζουν ο φρουρός κατάστασης, προστίθεται το
-- warmup_enabled, και σφίγγει η επικύρωση (βλ. σχόλια στη θέση τους).
create or replace function public.campaign_update(p_campaign_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.email_campaigns;
  v_errors   text[] := '{}';
  v_live     boolean;
  v_start    time;
  v_end      time;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if jsonb_typeof(p_patch) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_patch']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  -- Τερματικές καταστάσεις: δεν υπάρχει τίποτα να αλλάξει.
  if v_campaign.status in ('sent', 'cancelled') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  -- Ζωντανή = εκτός draft/ready (scheduled/sending/paused). Εκεί επιτρέπονται
  -- τα πάντα ΕΚΤΟΣ από το segment, που θα την αχρήστευε (βλ. header).
  v_live := v_campaign.status not in ('draft', 'ready');
  if v_live and (p_patch ? 'segment') then
    return jsonb_build_object('ok', false, 'errors', array['recipients_locked']);
  end if;

  -- Οι στήλες name/subject/body_md/reply_to/send_window_start/
  -- send_window_end/send_days είναι NOT NULL· ένα ρητό null (ή κενό/λάθος
  -- τύπου) στο patch για αυτές πρέπει να απορριφθεί καθαρά, όχι να σκάσει
  -- το UPDATE. daily_cap/hourly_cap/scheduled_at είναι nullable — ρητό null
  -- είναι έγκυρο, μόνο κακός τύπος απορρίπτεται.
  if (p_patch ? 'name') and (p_patch ->> 'name' is null or btrim(p_patch ->> 'name') = '') then
    v_errors := v_errors || 'invalid_name';
  end if;
  if (p_patch ? 'subject') and (p_patch ->> 'subject' is null) then
    v_errors := v_errors || 'invalid_subject';
  end if;
  if (p_patch ? 'body_md') and (p_patch ->> 'body_md' is null) then
    v_errors := v_errors || 'invalid_body_md';
  end if;
  if (p_patch ? 'reply_to') and (p_patch ->> 'reply_to' is null or btrim(p_patch ->> 'reply_to') = '') then
    v_errors := v_errors || 'invalid_reply_to';
  end if;
  -- ΣΦΙΓΜΕΝΟ (2026-09-11): μέχρι τώρα ελεγχόταν μόνο ο ΤΥΠΟΣ, οπότε 0 ή
  -- αρνητικό περνούσε και σταματούσε σιωπηλά την αποστολή. Ανεκτό όσο τα
  -- caps ρυθμίζονταν μόνο πριν το launch· επικίνδυνο τώρα που αλλάζουν
  -- πάνω σε καμπάνια που τρέχει.
  if (p_patch ? 'daily_cap') and (p_patch ->> 'daily_cap' is not null)
     and (not pg_input_is_valid(p_patch ->> 'daily_cap', 'int4')
          or (p_patch ->> 'daily_cap')::int <= 0) then
    v_errors := v_errors || 'invalid_daily_cap';
  end if;
  if (p_patch ? 'hourly_cap') and (p_patch ->> 'hourly_cap' is not null)
     and (not pg_input_is_valid(p_patch ->> 'hourly_cap', 'int4')
          or (p_patch ->> 'hourly_cap')::int <= 0) then
    v_errors := v_errors || 'invalid_hourly_cap';
  end if;
  if (p_patch ? 'send_window_start')
     and (p_patch ->> 'send_window_start' is null
          or not pg_input_is_valid(p_patch ->> 'send_window_start', 'time')) then
    v_errors := v_errors || 'invalid_send_window_start';
  end if;
  if (p_patch ? 'send_window_end')
     and (p_patch ->> 'send_window_end' is null
          or not pg_input_is_valid(p_patch ->> 'send_window_end', 'time')) then
    v_errors := v_errors || 'invalid_send_window_end';
  end if;
  -- Ανεστραμμένο παράθυρο = ποτέ αποστολή (inSendWindow κάνει απλό >= / <=).
  -- Ελέγχεται στον ΣΥΝΔΥΑΣΜΟ patch + υπάρχουσας τιμής, γιατί το UI μπορεί να
  -- στείλει μόνο το ένα άκρο.
  if (p_patch ? 'send_window_start' or p_patch ? 'send_window_end')
     and not ('invalid_send_window_start' = any(v_errors) or 'invalid_send_window_end' = any(v_errors)) then
    v_start := coalesce((p_patch ->> 'send_window_start')::time, v_campaign.send_window_start);
    v_end   := coalesce((p_patch ->> 'send_window_end')::time, v_campaign.send_window_end);
    if v_start >= v_end then
      v_errors := v_errors || 'invalid_send_window';
    end if;
  end if;
  if (p_patch ? 'send_days') and (jsonb_typeof(p_patch -> 'send_days') is distinct from 'array') then
    v_errors := v_errors || 'invalid_send_days';
  elsif (p_patch ? 'send_days') and exists (
    select 1 from jsonb_array_elements_text(p_patch -> 'send_days') x
     -- ΣΦΙΓΜΕΝΟ: και το εύρος 1..7 (ISO ημέρα), όχι μόνο η μετατρεψιμότητα σε
     -- int — ένα [0] ή [99] δεν ταιριάζει ποτέ με το isoDow του sender.
     where x is null or not pg_input_is_valid(x, 'int4')
        or x::int < 1 or x::int > 7
  ) then
    v_errors := v_errors || 'invalid_send_days';
  end if;
  if (p_patch ? 'scheduled_at') and (p_patch ->> 'scheduled_at' is not null)
     and not pg_input_is_valid(p_patch ->> 'scheduled_at', 'timestamptz') then
    v_errors := v_errors || 'invalid_scheduled_at';
  end if;
  if (p_patch ? 'warmup_enabled')
     and (p_patch ->> 'warmup_enabled' is null
          or not pg_input_is_valid(p_patch ->> 'warmup_enabled', 'bool')) then
    v_errors := v_errors || 'invalid_warmup_enabled';
  end if;

  if coalesce(array_length(v_errors, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  update public.email_campaigns set
    name              = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
    subject           = case when p_patch ? 'subject' then p_patch ->> 'subject' else subject end,
    preheader         = case when p_patch ? 'preheader' then p_patch ->> 'preheader' else preheader end,
    body_md           = case when p_patch ? 'body_md' then p_patch ->> 'body_md' else body_md end,
    hero_image_url    = case when p_patch ? 'hero_image_url' then p_patch ->> 'hero_image_url' else hero_image_url end,
    reply_to          = case when p_patch ? 'reply_to' then p_patch ->> 'reply_to' else reply_to end,
    segment           = case when p_patch ? 'segment' then coalesce(p_patch -> 'segment', '{}'::jsonb) else segment end,
    daily_cap         = case when p_patch ? 'daily_cap' then nullif(p_patch ->> 'daily_cap', '')::int else daily_cap end,
    hourly_cap        = case when p_patch ? 'hourly_cap' then nullif(p_patch ->> 'hourly_cap', '')::int else hourly_cap end,
    send_window_start = case when p_patch ? 'send_window_start' then (p_patch ->> 'send_window_start')::time else send_window_start end,
    send_window_end   = case when p_patch ? 'send_window_end' then (p_patch ->> 'send_window_end')::time else send_window_end end,
    send_days         = case when p_patch ? 'send_days'
                           then coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_patch -> 'send_days') x), '{}'::int[])
                           else send_days end,
    scheduled_at      = case when p_patch ? 'scheduled_at' then nullif(p_patch ->> 'scheduled_at', '')::timestamptz else scheduled_at end,
    warmup_enabled    = case when p_patch ? 'warmup_enabled' then (p_patch ->> 'warmup_enabled')::boolean else warmup_enabled end,
    -- Το segment είναι πλέον αδύνατο σε ζωντανή καμπάνια (φρουρός παραπάνω),
    -- οπότε αυτά τα δύο αγγίζουν μόνο draft/ready — όπως και πριν.
    prepared_at       = case when p_patch ? 'segment' then null else prepared_at end,
    status            = case when p_patch ? 'segment' then 'draft' else status end,
    updated_at        = now()
  where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
end;
$$;

-- ROLLBACK:
--   Ξανατρέξε τα σώματα campaign_update (20260907270000) και
--   campaign_daily_budget (20260907220000), μετά:
--   alter table public.email_campaigns drop column warmup_enabled;
