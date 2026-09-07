-- =============================================================================
-- 20260907270000_campaign_authoring_rpcs.sql
-- Κλείνει το κενό της Φάσης 1a: το σχήμα (20260907200000), η επιλογή
-- παραληπτών (20260907210000) και η ουρά/κύκλος ζωής (20260907220000,
-- 20260907260000) ήταν όλα SELECT-only κάτω από RLS, χωρίς ΚΑΜΙΑ RPC για να
-- δημιουργηθεί καμπάνια, να δημιουργηθεί audience, ή να εισαχθούν γραμμές
-- λίστας. Το σύστημα δεν μπορούσε να τροφοδοτηθεί. Αυτό το migration
-- προσθέτει τις authoring RPCs — καμία αγγίζει leads/clients/email_log/
-- email_outbox/email_templates ή οτιδήποτε κάτω από supabase/functions/
-- send-email/: ρητή απαίτηση του ιδιοκτήτη, μηδενική σχέση με το αυτόματο
-- email σύστημα.
--
-- Ίδιο house style με το 20260907220000: admin-only μέσω
-- current_user_is_admin(), SECURITY DEFINER + set search_path = public,
-- άρνηση επιστρέφει {"ok":false,"errors":[...]} αντί για raise, και
-- revoke execute from public, anon / grant execute to authenticated σε κάθε
-- function.
-- =============================================================================

-- --- 1. campaign_create --------------------------------------------------------
create or replace function public.campaign_create(
  p_name           text,
  p_subject        text default '',
  p_body_md        text default '',
  p_preheader      text default null,
  p_hero_image_url text default null,
  p_reply_to       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  insert into public.email_campaigns
    (name, subject, body_md, preheader, hero_image_url, reply_to, created_by)
  values (
    p_name,
    coalesce(p_subject, ''),
    coalesce(p_body_md, ''),
    p_preheader,
    p_hero_image_url,
    -- NULL ⇒ πέφτει στο column default του email_campaigns.reply_to
    -- (20260907200000:21). Ο literal εδώ πρέπει να ταιριάζει με εκείνον.
    coalesce(p_reply_to, 'sales@itdev.gr'),
    auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'campaign_id', v_id);
end;
$$;

revoke execute on function public.campaign_create(text, text, text, text, text, text) from public, anon;
grant execute on function public.campaign_create(text, text, text, text, text, text) to authenticated;

-- --- 2. campaign_update ---------------------------------------------------------
-- Εφαρμόζει ΜΟΝΟ τα επιτρεπόμενα κλειδιά του p_patch, αγνοώντας οτιδήποτε
-- άλλο· γι' αυτό κάθε στήλη ελέγχεται ρητά με `p_patch ? 'κλειδί'` (ύπαρξη
-- κλειδιού, όχι truthiness — ώστε ένα ρητό null στο patch να μπορεί να
-- αδειάσει μια nullable στήλη) αντί για δυναμικό SQL.
-- Μόνο όσο η καμπάνια είναι 'draft' ή 'ready' — μια καμπάνια σε
-- sending/paused/sent/cancelled δεν επεξεργάζεται πια.
-- Αλλαγή στο segment αλλάζει ΠΟΙΟΣ θα το λάβει: η ήδη χτισμένη λίστα
-- παραληπτών είναι πλέον stale, άρα prepared_at μηδενίζει και η κατάσταση
-- γυρνά σε 'draft'.
--
-- Review I-2: πριν το UPDATE, κάθε παρόν κλειδί ελέγχεται ρητά για
-- εγκυρότητα/cast-ability με pg_input_is_valid (διαθέσιμο από PG16+· το
-- project τρέχει PG17, supabase/config.toml:36) ώστε ένα κακό patch
-- ({"daily_cap":"abc"}, {"send_days":null}, {"name":null}, …) να επιστρέψει
-- {"ok":false,"errors":[...]} με το όνομα του κλειδιού αντί για ακατέργαστο
-- Postgres cast/NOT NULL σφάλμα. Το UPDATE-statement παρακάτω παραμένει
-- αναλλοίωτο πέρα από αυτό το πρόσθετο validation block πριν από αυτό.
create or replace function public.campaign_update(p_campaign_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.email_campaigns;
  v_errors   text[] := '{}';
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

  if v_campaign.status not in ('draft', 'ready') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
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
  if (p_patch ? 'daily_cap') and (p_patch ->> 'daily_cap' is not null)
     and not pg_input_is_valid(p_patch ->> 'daily_cap', 'int4') then
    v_errors := v_errors || 'invalid_daily_cap';
  end if;
  if (p_patch ? 'hourly_cap') and (p_patch ->> 'hourly_cap' is not null)
     and not pg_input_is_valid(p_patch ->> 'hourly_cap', 'int4') then
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
  if (p_patch ? 'send_days') and (jsonb_typeof(p_patch -> 'send_days') is distinct from 'array') then
    v_errors := v_errors || 'invalid_send_days';
  elsif (p_patch ? 'send_days') and exists (
    select 1 from jsonb_array_elements_text(p_patch -> 'send_days') x
     where x is null or not pg_input_is_valid(x, 'int4')
  ) then
    v_errors := v_errors || 'invalid_send_days';
  end if;
  if (p_patch ? 'scheduled_at') and (p_patch ->> 'scheduled_at' is not null)
     and not pg_input_is_valid(p_patch ->> 'scheduled_at', 'timestamptz') then
    v_errors := v_errors || 'invalid_scheduled_at';
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
    prepared_at       = case when p_patch ? 'segment' then null else prepared_at end,
    status            = case when p_patch ? 'segment' then 'draft' else status end,
    updated_at        = now()
  where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
end;
$$;

revoke execute on function public.campaign_update(uuid, jsonb) from public, anon;
grant execute on function public.campaign_update(uuid, jsonb) to authenticated;

-- --- 3. campaign_delete ----------------------------------------------------------
-- Μόνο από 'draft' ή 'cancelled', και μόνο αν καμία γραμμή παραλήπτη δεν έχει
-- sent_at (ιστορικό αποστολής δεν σβήνεται ποτέ). Cascade μέσω FK στα
-- email_campaign_recipients / email_campaign_audiences.
create or replace function public.campaign_delete(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.email_campaigns;
  v_has_sent boolean;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  if v_campaign.status not in ('draft', 'cancelled') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  select exists(
    select 1 from public.email_campaign_recipients
     where campaign_id = p_campaign_id and sent_at is not null
  ) into v_has_sent;
  if v_has_sent then
    return jsonb_build_object('ok', false, 'errors', array['already_sent']);
  end if;

  delete from public.email_campaigns where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id);
end;
$$;

revoke execute on function public.campaign_delete(uuid) from public, anon;
grant execute on function public.campaign_delete(uuid) to authenticated;

-- --- 4. campaign_reset_to_draft ---------------------------------------------------
-- Το final review του Phase 1a σημείωσε ότι τίποτα δεν μπορεί να γυρίσει μια
-- καμπάνια σε 'draft' — μια prepared-αλλά-stale λίστα παραληπτών δεν θα
-- μπορούσε ποτέ να ξαναχτιστεί εκτός από raw SQL. Ίδια ασφάλεια με το guard
-- που προστίθεται στο build_campaign_recipients παρακάτω: ΠΟΤΕ μην επιτρέψεις
-- επιστροφή σε draft (και άρα δυνατότητα rebuild) πάνω σε καμπάνια που έχει
-- ήδη γραμμές με sent_at — θα έσβηνε το ιστορικό αποστολής και θα ξανάστελνε
-- σε όλους.
--
-- Review I-1: sent_at γράφεται ΜΟΝΟ αφού επιστρέψει το Resend POST
-- (send-campaign/index.ts:259) — άρα υπάρχει ζωντανό παράθυρο όπου το drain
-- έχει ήδη κάνει claim/POST 100 γραμμές αλλά sent_at είναι ακόμα null: ένα
-- reset εκείνη τη στιγμή θα περνούσε τον παλιό έλεγχο, το επόμενο
-- build_campaign_recipients θα ΔΙΕΓΡΑΦΕ αυτές τις γραμμές, και οι
-- markChunkSent γραφές θα έβρισκαν ids που δεν υπάρχουν πια (σιωπηλό no-op) —
-- ξανά-αποστολή σε πραγματικούς ανθρώπους, χωρίς καν το fatigue rule να το
-- πιάσει (η απόδειξη διαγράφηκε). Ο ίδιος κίνδυνος υπάρχει χωρίς κανέναν
-- admin: recover_stale_campaign_claims γυρίζει claimed γραμμές σε 'pending'
-- με sent_at ακόμα null όταν το status-write απέτυχε μετά την αποστολή
-- (index.ts:267). Γι' αυτό ο έλεγχος πιάνει claimed_at/attempts/status, όχι
-- μόνο sent_at· και το campaign status ελέγχεται ξεχωριστά, ώστε ένα reset
-- να μην είναι ποτέ δυνατό ενώ η καμπάνια είναι ενεργά σε αποστολή ή paused
-- (must go through campaign_pause/resume/cancel αντί για αυτό).
create or replace function public.campaign_reset_to_draft(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign  public.email_campaigns;
  v_in_flight boolean;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  if v_campaign.status in ('sending', 'paused') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  select exists(
    select 1 from public.email_campaign_recipients
     where campaign_id = p_campaign_id
       and (sent_at is not null or claimed_at is not null or attempts > 0
            or status in ('sending', 'sent', 'failed'))
  ) into v_in_flight;
  if v_in_flight then
    return jsonb_build_object('ok', false, 'errors', array['already_sent']);
  end if;

  update public.email_campaigns
     set status = 'draft', prepared_at = null, updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'draft');
end;
$$;

revoke execute on function public.campaign_reset_to_draft(uuid) from public, anon;
grant execute on function public.campaign_reset_to_draft(uuid) to authenticated;

-- --- 5. audience_create -----------------------------------------------------------
-- consent_basis είναι NOT NULL με CHECK (20260907200000:47) — χωρίς
-- καταγεγραμμένη βάση συναίνεσης δεν επιτρέπεται να δημιουργηθεί audience.
-- Ελέγχεται ρητά εδώ (ίδιο κλειστό λεξιλόγιο με το CHECK) ώστε μια κακή τιμή
-- να επιστρέψει καθαρό error αντί το constraint να κάνει raise. Το ίδιο και
-- για το kind.
create or replace function public.audience_create(
  p_name          text,
  p_consent_basis text,
  p_kind          text default 'import',
  p_source_file   text default null,
  p_source_note   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_errors text[] := '{}';
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  -- Ίδιο κλειστό λεξιλόγιο με το CHECK constraint (20260907200000:47).
  -- `x not in (...)` επιστρέφει NULL (όχι true) όταν x είναι NULL, άρα το
  -- `is null` πρέπει να ελέγχεται ρητά — αλλιώς ένα NULL περνούσε τον έλεγχο
  -- σιωπηλά και έσκαγε στο NOT NULL/CHECK constraint του insert (review I-3).
  if p_consent_basis is null
     or p_consent_basis not in ('existing_customer', 'inquiry', 'public_b2b', 'purchased', 'other') then
    v_errors := v_errors || 'invalid_consent_basis';
  end if;
  -- Ίδιο κλειστό λεξιλόγιο με το CHECK constraint (20260907200000:42).
  if p_kind is null or p_kind not in ('import', 'segment', 'manual') then
    v_errors := v_errors || 'invalid_kind';
  end if;

  if coalesce(array_length(v_errors, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  insert into public.email_audiences (name, kind, source_file, consent_basis, source_note, created_by)
  values (p_name, p_kind, p_source_file, p_consent_basis, p_source_note, auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'audience_id', v_id);
end;
$$;

revoke execute on function public.audience_create(text, text, text, text, text) from public, anon;
grant execute on function public.audience_create(text, text, text, text, text) to authenticated;

-- --- 6. audience_add_members --------------------------------------------------------
-- Το Excel-import path· μπορεί να κουβαλήσει χιλιάδες γραμμές, άρα ΕΝΑ
-- set-based insert...select πάνω σε jsonb_array_elements, ποτέ loop.
-- Κανονικοποιεί σε lower(btrim(email)), αφαιρεί "mailto:", κρατά το πρώτο
-- κομμάτι πριν από ';' ή ',' (ίδιο idiom με το build_campaign_recipients,
-- 20260907210000:159-161), απορρίπτει ό,τι αποτυγχάνει το regex, αποδιπλασιώνει
-- ΜΕΣΑ στο batch με row_number(), και βασίζεται στο
-- unique (audience_id, email_lower) με on conflict do nothing για διπλότυπα
-- που υπάρχουν ήδη αποθηκευμένα. Το row_count ενημερώνεται στο τέλος με τον
-- πραγματικό αποθηκευμένο αριθμό.
create or replace function public.audience_add_members(p_audience_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added     int;
  v_invalid   int;
  v_duplicate int;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if not exists (select 1 from public.email_audiences where id = p_audience_id) then
    return jsonb_build_object('ok', false, 'errors', array['audience_not_found']);
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_rows']);
  end if;

  with raw as (
    select ordinality as rn, value as elem
      from jsonb_array_elements(p_rows) with ordinality as t(value, ordinality)
  ),
  normalized as (
    select
      rn,
      lower(btrim(
        substring(regexp_replace(coalesce(elem ->> 'email', ''), '^\s*mailto:\s*', '', 'i') from '^[^;,]*')
      )) as email_lower,
      nullif(btrim(elem ->> 'name'), '') as display_name,
      nullif(btrim(elem ->> 'company'), '') as company,
      -- Τύποι λάθους σχήματος αγνοούνται σιωπηλά αντί να σκάσουν όλο το
      -- batch (ίδιο idiom με campaign_segment_emails, 20260907210000:22-24).
      case when jsonb_typeof(elem -> 'extra') = 'object' then elem -> 'extra' else '{}'::jsonb end as extra,
      case when jsonb_typeof(elem -> 'row') = 'number' then (elem ->> 'row')::int else null end as source_row
    from raw
  ),
  flagged as (
    select *, (email_lower <> '' and email_lower ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') as is_valid
    from normalized
  ),
  deduped as (
    select *, row_number() over (partition by email_lower order by rn) as dupe_rank
    from flagged
  ),
  to_insert as (
    select * from deduped where is_valid and dupe_rank = 1
  ),
  inserted as (
    insert into public.email_audience_members
      (audience_id, email_lower, display_name, company, extra, source_row)
    select p_audience_id, email_lower, display_name, company, extra, source_row
    from to_insert
    on conflict (audience_id, email_lower) do nothing
    returning 1
  )
  select
    (select count(*) from inserted)::int,
    (select count(*) from flagged where not is_valid)::int,
    -- "duplicate" = έγκυρες γραμμές που ΔΕΝ κατέληξαν σε νέα αποθηκευμένη
    -- γραμμή — είτε επειδή ήταν διπλότυπο μέσα στο ίδιο batch (dupe_rank>1),
    -- είτε επειδή χτύπησαν το unique constraint με ήδη υπάρχουσα γραμμή
    -- (on conflict do nothing).
    ((select count(*) from flagged where is_valid) - (select count(*) from inserted))::int
  into v_added, v_invalid, v_duplicate;

  update public.email_audiences
     set row_count = (select count(*) from public.email_audience_members where audience_id = p_audience_id)
   where id = p_audience_id;

  -- Review I-4: μια καμπάνια που έχει ήδη συνδέσει αυτό το audience μπορεί
  -- να έχει ήδη χτίσει (status='ready', prepared_at set) τη λίστα
  -- παραληπτών ΠΡΙΝ από αυτό το import — νέες γραμμές εδώ δεν θα
  -- εμφανίζονταν ποτέ σε αυτήν χωρίς ρητό rebuild, και ένα launch θα
  -- έστελνε σιωπηλά μόνο στην παλιά λίστα. Ίδιο reset με το
  -- campaign_attach_audience/campaign_detach_audience παραπάνω, περιορισμένο
  -- στο ίδιο επεξεργάσιμο παράθυρο (draft/ready) — μια καμπάνια που ήδη
  -- στέλνει/έχει σταλεί/είναι paused δεν πρέπει να τραβηχτεί πίσω σε draft
  -- από ένα άσχετο import.
  update public.email_campaigns ec
     set prepared_at = null, status = 'draft', updated_at = now()
   where ec.status in ('draft', 'ready')
     and exists (
       select 1 from public.email_campaign_audiences ca
        where ca.campaign_id = ec.id and ca.audience_id = p_audience_id
     );

  return jsonb_build_object('ok', true, 'added', v_added, 'invalid', v_invalid, 'duplicate', v_duplicate);
end;
$$;

revoke execute on function public.audience_add_members(uuid, jsonb) from public, anon;
grant execute on function public.audience_add_members(uuid, jsonb) to authenticated;

-- --- 7. audience_delete -----------------------------------------------------------
-- Το FK email_campaign_audiences.audience_id είναι ON DELETE RESTRICT
-- (20260907200000:68) — ελέγχεται πρώτα ρητά ώστε μια audience σε χρήση να
-- επιστρέψει καθαρό {"ok":false,"errors":["in_use"]} αντί το FK να κάνει raise.
create or replace function public.audience_delete(p_audience_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if not exists (select 1 from public.email_audiences where id = p_audience_id) then
    return jsonb_build_object('ok', false, 'errors', array['audience_not_found']);
  end if;

  if exists (select 1 from public.email_campaign_audiences where audience_id = p_audience_id) then
    return jsonb_build_object('ok', false, 'errors', array['in_use']);
  end if;

  delete from public.email_audiences where id = p_audience_id;

  return jsonb_build_object('ok', true, 'audience_id', p_audience_id);
end;
$$;

revoke execute on function public.audience_delete(uuid) from public, anon;
grant execute on function public.audience_delete(uuid) to authenticated;

-- --- 8. campaign_attach_audience / campaign_detach_audience ------------------------
-- Μόνο όσο η καμπάνια είναι 'draft'/'ready' — και οι δύο μηδενίζουν
-- prepared_at και γυρνούν την κατάσταση σε 'draft', ίδιος λόγος με το
-- campaign_update §2: η λίστα κοινού άλλαξε, άρα η χτισμένη λίστα
-- παραληπτών είναι πλέον stale.
create or replace function public.campaign_attach_audience(p_campaign_id uuid, p_audience_id uuid)
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
  if v_campaign.status not in ('draft', 'ready') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  if not exists (select 1 from public.email_audiences where id = p_audience_id) then
    return jsonb_build_object('ok', false, 'errors', array['audience_not_found']);
  end if;

  insert into public.email_campaign_audiences (campaign_id, audience_id)
  values (p_campaign_id, p_audience_id)
  on conflict (campaign_id, audience_id) do nothing;

  update public.email_campaigns
     set prepared_at = null, status = 'draft', updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'audience_id', p_audience_id);
end;
$$;

revoke execute on function public.campaign_attach_audience(uuid, uuid) from public, anon;
grant execute on function public.campaign_attach_audience(uuid, uuid) to authenticated;

create or replace function public.campaign_detach_audience(p_campaign_id uuid, p_audience_id uuid)
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
  if v_campaign.status not in ('draft', 'ready') then
    return jsonb_build_object('ok', false, 'errors', array['invalid_state']);
  end if;

  delete from public.email_campaign_audiences
   where campaign_id = p_campaign_id and audience_id = p_audience_id;

  update public.email_campaigns
     set prepared_at = null, status = 'draft', updated_at = now()
   where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'audience_id', p_audience_id);
end;
$$;

revoke execute on function public.campaign_detach_audience(uuid, uuid) from public, anon;
grant execute on function public.campaign_detach_audience(uuid, uuid) to authenticated;

-- --- 9. marketing_settings_update ---------------------------------------------------
-- Admin-only update του singleton email_marketing_settings (id boolean
-- primary key check (id), 20260907200000:127) — εφαρμόζει μόνο τα
-- επιτρεπόμενα κλειδιά. Αυτός είναι και ο global kill switch (`paused`).
-- Minor (review): ένα emergency-stop RPC δεν επιτρέπεται να απαντήσει
-- {"ok":true} όταν στην πραγματικότητα δεν ενημερώθηκε καμία γραμμή (π.χ. αν
-- η singleton γραμμή λείπει) — ελέγχεται το πραγματικό row count.
create or replace function public.marketing_settings_update(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  if jsonb_typeof(p_patch) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'errors', array['invalid_patch']);
  end if;

  update public.email_marketing_settings set
    paused             = case when p_patch ? 'paused' then (p_patch ->> 'paused')::boolean else paused end,
    daily_cap          = case when p_patch ? 'daily_cap' then (p_patch ->> 'daily_cap')::int else daily_cap end,
    hourly_cap         = case when p_patch ? 'hourly_cap' then (p_patch ->> 'hourly_cap')::int else hourly_cap end,
    batch_slice        = case when p_patch ? 'batch_slice' then (p_patch ->> 'batch_slice')::int else batch_slice end,
    warmup_started_on  = case when p_patch ? 'warmup_started_on' then nullif(p_patch ->> 'warmup_started_on', '')::date else warmup_started_on end,
    warmup_ladder      = case when p_patch ? 'warmup_ladder'
                            then coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_patch -> 'warmup_ladder') x), warmup_ladder)
                            else warmup_ladder end,
    max_bounce_rate    = case when p_patch ? 'max_bounce_rate' then (p_patch ->> 'max_bounce_rate')::numeric else max_bounce_rate end,
    max_complaint_rate = case when p_patch ? 'max_complaint_rate' then (p_patch ->> 'max_complaint_rate')::numeric else max_complaint_rate end,
    fatigue_days       = case when p_patch ? 'fatigue_days' then (p_patch ->> 'fatigue_days')::int else fatigue_days end,
    updated_at         = now()
  where id = true;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'errors', array['settings_row_missing']);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.marketing_settings_update(jsonb) from public, anon;
grant execute on function public.marketing_settings_update(jsonb) to authenticated;

-- --- 10. build_campaign_recipients: ίδιο guard, defence in depth --------------------
-- Το build_campaign_recipients (20260907210000) κάνει DELETE+rebuild στις
-- γραμμές παραλήπτη της καμπάνιας. Αν αυτό έτρεχε ποτέ πάνω σε καμπάνια που
-- είχε ήδη στείλει σε ανθρώπους, το ιστορικό sent_at θα σβηνόταν και θα τους
-- ξανάστελνε όλους. Το campaign_reset_to_draft παραπάνω έχει τον ίδιο έλεγχο,
-- αλλά ΑΥΤΗ είναι η function που κάνει την πραγματική καταστροφική δουλειά —
-- δεν πρέπει να βασίζεται μόνο στην προσοχή των callers της. Αναδημιουργείται
-- εδώ ΑΚΡΙΒΩΣ όπως στο 20260907210000:107-259, με ΜΟΝΗ αλλαγή την προσθήκη
-- αυτού του guard αμέσως μετά τον έλεγχο status <> 'draft'.
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

  -- --- ΝΕΟ guard (20260907270000, διευρύνθηκε μετά το review finding I-1) ----
  -- Ό,τι κι αν λέει το status, το destructive DELETE+rebuild παρακάτω δεν
  -- πρέπει ΠΟΤΕ να τρέξει πάνω σε καμπάνια με γραμμές που είναι ήδη σταλμένες
  -- Η ΣΕ ΕΞΕΛΙΞΗ. sent_at γράφεται ΜΟΝΟ αφού επιστρέψει το Resend POST
  -- (send-campaign/index.ts:259), άρα ένα guard που κοιτάζει μόνο sent_at
  -- έχει ζωντανό παράθυρο: claim/POST έγινε ήδη σε έως 100 γραμμές αλλά
  -- sent_at είναι ακόμα null· ένα rebuild εκείνη τη στιγμή θα τις έσβηνε και
  -- θα τις ξανάστελνε. Γι' αυτό ελέγχονται και claimed_at/attempts/status.
  if exists (
    select 1 from public.email_campaign_recipients
     where campaign_id = p_campaign_id
       and (sent_at is not null or claimed_at is not null or attempts > 0
            or status in ('sending', 'sent', 'failed'))
  ) then
    return jsonb_build_object('ok', false, 'errors', array['already_sent']);
  end if;
  -- --- τέλος νέου guard ---------------------------------------------------------

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

-- ============================================================================
-- ROLLBACK (run manually to roll back this migration):
--   drop function if exists public.marketing_settings_update(jsonb);
--   drop function if exists public.campaign_detach_audience(uuid, uuid);
--   drop function if exists public.campaign_attach_audience(uuid, uuid);
--   drop function if exists public.audience_delete(uuid);
--   drop function if exists public.audience_add_members(uuid, jsonb);
--   drop function if exists public.audience_create(text, text, text, text, text);
--   drop function if exists public.campaign_reset_to_draft(uuid);
--   drop function if exists public.campaign_delete(uuid);
--   drop function if exists public.campaign_update(uuid, jsonb);
--   drop function if exists public.campaign_create(text, text, text, text, text, text);
--   -- restores build_campaign_recipients to its pre-guard shape exactly as it
--   -- stood after 20260907210000 (no already_sent guard) — see that file for
--   -- the full body to reapply verbatim minus the "ΝΕΟ guard" block above.
-- ============================================================================
