-- =============================================================================
-- Ενιαία λίστα «δεν θέλω email» — Sales + Marketing (owner request 2026-09-11).
--
-- Μέχρι σήμερα η λίστα `email_suppressions` ίσχυε ΜΟΝΟ για τις καμπάνιες (το
-- header του 20260907100000 το λέει ρητά: «η επιβολή γίνεται στη Φάση 1»). Τα
-- αυτόματα sales emails δεν την κοιτούσαν καθόλου: 411 leads και 9 πελάτες με
-- διεύθυνση στη λίστα συνέχιζαν να δέχονται email — 407 από αυτές νεκρές
-- διευθύνσεις που χτυπούν bounce και φθείρουν τη φήμη του domain.
--
-- Αυτό το migration:
--   1. Δίνει ΠΡΟΕΛΕΥΣΗ σε κάθε εγγραφή (`stream`: marketing | sales | manual),
--      ώστε να ξέρουμε από πού ήρθε η κάθε απεγγραφή.
--   2. Σφίγγει τα δικαιώματα: σήμερα ΚΑΘΕ authenticated χρήστης μπορεί να
--      γράψει στη λίστα. Πλέον μόνο service_role (αυτόματα μονοπάτια) και
--      admins (μέσω `admin_suppress_email`).
--   3. Ταξινομεί τα template σε outreach vs transactional
--      (`email_template_is_outreach`) — ΕΝΑ σημείο αλήθειας, το χρησιμοποιούν
--      και το enqueue και ο sender.
--   4. Βάζει τον έλεγχο στο `enqueue_lead_email` (το choke point των leads).
--   5. Anti-drift: trigger στο `email_campaign_recipients.unsubscribed_at` ώστε
--      η εγγραφή στη λίστα να γίνεται στην ΙΔΙΑ συναλλαγή με την απεγγραφή —
--      μέχρι τώρα, αν αποτύχαινε το RPC στο api/campaign-unsubscribe.ts, ο
--      άνθρωπος προστατευόταν μόνο για εκείνη την καμπάνια.
--
-- Τα transactional (πληρωμές, ραντεβού, συμβόλαια, onboarding, internal) ΔΕΝ
-- μπλοκάρονται ποτέ — είναι υποχρέωση προς πελάτη, όχι προώθηση.
-- =============================================================================

-- --- 1. Προέλευση ------------------------------------------------------------
alter table public.email_suppressions
  add column if not exists stream text not null default 'marketing';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.email_suppressions'::regclass
       and conname = 'email_suppressions_stream_check'
  ) then
    alter table public.email_suppressions
      add constraint email_suppressions_stream_check
      check (stream in ('marketing', 'sales', 'manual'));
  end if;
end $$;

comment on column public.email_suppressions.stream is
  'Από πού ήρθε η εγγραφή: marketing (καμπάνια), sales (αυτόματο email), manual (admin).';

-- Backfill από το υπάρχον `source`: campaign:<uuid> → marketing, email_log* → sales.
update public.email_suppressions
   set stream = case
         when source like 'campaign:%' then 'marketing'
         when source like 'email_log%' then 'sales'
         else 'marketing'
       end
 where true;

-- --- 2. suppress_email: νέα παράμετρος stream --------------------------------
-- Η προέλευση δεν αλλάζει μετά την πρώτη εγγραφή (κρατάμε την αρχική αιτία).
-- Η παλιά 3-ορισμάτων υπογραφή έχει default στο p_source, οπότε δεν μπορεί να
-- γίνει CREATE OR REPLACE με νέα ορίσματα — και δύο υπογραφές θα ήταν ούτως ή
-- άλλως ασαφείς για κλήση με 3 ορίσματα. Μία συνάρτηση, δύο νέα προαιρετικά:
-- οι υπάρχοντες καλούντες (resend-webhook, email_log trigger, campaign API)
-- συνεχίζουν να καλούν με 3 ορίσματα και παίρνουν stream='marketing'.
drop function if exists public.suppress_email(text, text, text);

create or replace function public.suppress_email(
  p_email text,
  p_reason text,
  p_source text default null,
  p_stream text default 'marketing',
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return;
  end if;
  if coalesce(p_stream, '') not in ('marketing', 'sales', 'manual') then
    p_stream := 'marketing';
  end if;

  insert into public.email_suppressions
    (email_lower, reason, source, stream, note, bounce_count, first_seen_at, last_seen_at)
  values (v_email, p_reason, p_source, p_stream, p_note,
          case when p_reason like '%bounce' then 1 else 0 end, now(), now())
  on conflict (email_lower) do update
    set reason = case
          when public.email_suppressions.reason = 'unsubscribed' then 'unsubscribed'
          when excluded.reason = 'unsubscribed' then 'unsubscribed'
          when public.email_suppressions.reason = 'complaint' then 'complaint'
          when excluded.reason = 'complaint' then 'complaint'
          when public.email_suppressions.reason = 'hard_bounce' then 'hard_bounce'
          else excluded.reason
        end,
        bounce_count = public.email_suppressions.bounce_count
                       + case when excluded.reason like '%bounce' then 1 else 0 end,
        last_seen_at = now(),
        source = coalesce(excluded.source, public.email_suppressions.source),
        -- η προέλευση μένει αυτή της πρώτης εγγραφής
        stream = public.email_suppressions.stream,
        note = coalesce(excluded.note, public.email_suppressions.note);
end $$;

-- Το email_log είναι η ουρά των sales/transactional email — τα bounces και τα
-- παράπονα που έρχονται από εκεί σημειώνονται ως 'sales'. (Το resend-webhook
-- των καμπανιών καλεί με 3 ορίσματα και παίρνει το default 'marketing'.)
create or replace function public.email_log_suppression_sync()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'complained' then
    perform public.suppress_email(new.to_email, 'complaint', 'email_log', 'sales', null);
  elsif new.status = 'bounced' then
    perform public.suppress_email(new.to_email, 'hard_bounce', 'email_log', 'sales', null);
  end if;
  return new;
end $$;

-- --- 3. Δικαιώματα: μόνο service_role + admins --------------------------------
-- Σήμερα ΚΑΘΕ authenticated χρήστης μπορούσε να γράψει στη λίστα.
revoke execute on function public.suppress_email(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.suppress_email(text, text, text, text, text) to service_role;

-- Ίχνος για κάθε χειροκίνητη επέμβαση στη λίστα. Το activity_log απαιτεί uuid
-- entity, ενώ εδώ το κλειδί είναι διεύθυνση — δικός του, μικρός πίνακας.
create table if not exists public.email_suppression_audit (
  id            uuid primary key default gen_random_uuid(),
  email_lower   text not null,
  action        text not null check (action in ('added', 'removed')),
  reason        text,
  stream        text,
  note          text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.email_suppression_audit enable row level security;
drop policy if exists email_suppression_audit_select on public.email_suppression_audit;
create policy email_suppression_audit_select on public.email_suppression_audit
  for select to authenticated
  using ((select public.current_user_is_admin()));
create index if not exists email_suppression_audit_email
  on public.email_suppression_audit (email_lower, created_at desc);

-- Χειροκίνητη προσθήκη από admin (π.χ. το ζήτησε τηλεφωνικά).
create or replace function public.admin_suppress_email(
  p_email text,
  p_reason text default 'manual',
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'note_required' using errcode = '22023';
  end if;
  if coalesce(p_reason, '') not in ('manual', 'unsubscribed') then
    p_reason := 'manual';
  end if;
  perform public.suppress_email(p_email, p_reason, 'admin', 'manual', btrim(p_note));

  insert into public.email_suppression_audit
    (email_lower, action, reason, stream, note, actor_user_id)
  values (lower(btrim(p_email)), 'added', p_reason, 'manual', btrim(p_note), auth.uid());
end $$;
revoke execute on function public.admin_suppress_email(text, text, text) from public, anon;
grant execute on function public.admin_suppress_email(text, text, text) to authenticated;

-- Αφαίρεση: admin-only ΚΑΙ με υποχρεωτική αιτιολόγηση, που καταγράφεται.
create or replace function public.unsuppress_email(p_email text, p_note text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_row public.email_suppressions;
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'note_required' using errcode = '22023';
  end if;

  select * into v_row from public.email_suppressions
   where email_lower = lower(btrim(p_email));
  if v_row.email_lower is null then
    return false;
  end if;

  delete from public.email_suppressions where email_lower = v_row.email_lower;
  get diagnostics v_n = row_count;

  -- Ίχνος: ποιος έβγαλε ποιον από τη λίστα, πότε και γιατί.
  insert into public.email_suppression_audit
    (email_lower, action, reason, stream, note, actor_user_id)
  values (v_row.email_lower, 'removed', v_row.reason, v_row.stream,
          btrim(p_note), auth.uid());
  return v_n > 0;
end $$;
revoke execute on function public.unsuppress_email(text, text) from public, anon;
grant execute on function public.unsuppress_email(text, text) to authenticated;

-- --- 4. Ταξινόμηση template ---------------------------------------------------
-- ΕΝΑ σημείο αλήθειας. Outreach = κρύα/nurture προσέγγιση → σέβεται την
-- απεγγραφή. Οτιδήποτε άλλο (πληρωμές, ραντεβού, συμβόλαια, onboarding
-- πληρωμένου πελάτη, internal, χειρόγραφο `custom`) στέλνεται ΠΑΝΤΑ.
create or replace function public.email_template_is_outreach(p_template_key text)
returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_template_key, '') in (
    -- ζωντανή καμπάνια Under Development
    'ud_welcome', 'ud_noanswer_1', 'ud_noanswer_2', 'ud_noanswer_3',
    'ud_offer_checkin', 'ud_offer_followup_1', 'ud_offer_followup_2',
    -- κλασικό pipeline (αποσυρμένα, μένουν για την περίπτωση επαναφοράς)
    'lead_welcome', 'noanswer_day0', 'noanswer_day2', 'noanswer_day5',
    'noanswer_day10', 'offer_followup_day2', 'offer_followup_day5',
    'offer_followup_day10', 'reengage_90d',
    -- μαζικά
    'company_announcement', 'chatgpt_ads_campaign'
  );
$$;

-- --- 5. Το enqueue των leads σέβεται τη λίστα ---------------------------------
-- Ίδιο στυλ με τους υπάρχοντες ελέγχους (archived / franchise / email_opt_out /
-- automations_enabled): σιωπηλό false, καμία εγγραφή στην ουρά.
-- Βάση: 20260825170000_sales_emails_from_owner.sql:47-87 (verbatim + ο νέος έλεγχος).
create or replace function public.enqueue_lead_email(target_lead_id uuid, tpl_key text, dkey text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  v_identity text;
begin
  select * into l from public.leads where id = target_lead_id;
  if l is null or l.archived then return false; end if;
  -- Franchise leads receive NO automated email (central gate; owner-gated).
  if l.source = 'franchise' then return false; end if;
  if l.email is null or l.email = '' then return false; end if;
  if l.email_opt_out or not l.automations_enabled then return false; end if;

  -- Καθολική λίστα «δεν θέλω email» (2026-09-11). Μόνο για outreach template:
  -- τα transactional (won_welcome, scheduled_*) περνούν κανονικά.
  if public.email_template_is_outreach(tpl_key)
     and exists (select 1 from public.email_suppressions s
                  where s.email_lower = lower(btrim(l.email))) then
    return false;
  end if;

  if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
    return false;
  end if;
  if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sending','sent')) then
    return false;
  end if;

  if tpl_key = 'won_welcome' and (
       exists (select 1 from public.email_log
                where template_key = 'won_welcome' and status = 'sent'
                  and lower(btrim(to_email)) = lower(btrim(l.email)))
    or exists (select 1 from public.email_outbox
                where template_key = 'won_welcome' and status in ('pending','sending','sent')
                  and lower(btrim(to_email)) = lower(btrim(l.email)))
  ) then
    return false;
  end if;

  v_identity := case when tpl_key = 'won_welcome' then 'accounting' else 'sales' end;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key, send_as_user_id)
  values (v_identity, l.email, tpl_key, public.lead_email_payload(l), dkey,
          case when tpl_key = 'won_welcome' then null else l.owner_user_id end);
  return true;
end $$;

-- --- 6. Anti-drift: η απεγγραφή γράφει τη λίστα στην ίδια συναλλαγή -----------
create or replace function public.campaign_unsub_suppression_sync()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.suppress_email(
    new.email_lower, 'unsubscribed',
    'campaign:' || new.campaign_id::text, 'marketing', null);
  return new;
end $$;

drop trigger if exists campaign_unsub_suppression_sync on public.email_campaign_recipients;
create trigger campaign_unsub_suppression_sync
  after update of unsubscribed_at on public.email_campaign_recipients
  for each row
  when (new.unsubscribed_at is not null and old.unsubscribed_at is null)
  execute function public.campaign_unsub_suppression_sync();

-- ROLLBACK:
--   drop trigger if exists campaign_unsub_suppression_sync on public.email_campaign_recipients;
--   drop function if exists public.campaign_unsub_suppression_sync();
--   drop function if exists public.email_template_is_outreach(text);
--   drop function if exists public.admin_suppress_email(text, text, text);
--   drop function if exists public.unsuppress_email(text, text);
--   drop function if exists public.suppress_email(text, text, text, text, text);
--   -- επαναφορά enqueue_lead_email από 20260825170000_sales_emails_from_owner.sql
--   -- επαναφορά suppress_email/unsuppress_email + grants από 20260907100000
--   alter table public.email_suppressions drop column if exists stream;
