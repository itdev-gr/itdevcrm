-- =============================================================================
-- 20260907200000_campaign_tables.sql
-- Το σχήμα των καμπανιών marketing. Εντελώς ξεχωριστό από την υποδομή των
-- αυτόματων email (email_outbox / email_log / send-email): άλλη ουρά, άλλος
-- ρυθμός, άλλο cron. Αυτό είναι ρητή απόφαση του ιδιοκτήτη (2026-09-07) και
-- ταυτόχρονα τεχνική ανάγκη — το email_outbox είναι FIFO 50 γραμμές/2΄ και
-- 10.000 γραμμές καμπάνιας θα καθυστερούσαν ένα τιμολόγιο ~6,7 ώρες, ενώ το
-- email_pipeline_health() θα έδειχνε μόνιμα "degraded".
-- =============================================================================

create table public.email_campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  status            text not null default 'draft'
                    check (status in ('draft','ready','scheduled','sending','paused','sent','cancelled')),
  identity          text not null default 'marketing',
  subject           text not null default '',
  preheader         text,
  body_md           text not null default '',
  hero_image_url    text,
  reply_to          text not null default 'sales@itdev.gr',
  segment           jsonb not null default '{}'::jsonb,
  daily_cap         int,
  hourly_cap        int,
  send_window_start time not null default '09:00',
  send_window_end   time not null default '18:00',
  send_days         int[] not null default '{1,2,3,4,5}',
  scheduled_at      timestamptz,
  prepared_at       timestamptz,
  started_at        timestamptz,
  finished_at       timestamptz,
  autopause_reason  text,
  created_by        uuid references public.profiles(user_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.email_campaigns is 'Μία καμπάνια marketing. Δεν σχετίζεται με τα αυτόματα email.';

create table public.email_audiences (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default 'import' check (kind in ('import','segment','manual')),
  source_file   text,
  -- Υποχρεωτικό: χωρίς καταγεγραμμένη βάση συναίνεσης δεν στέλνουμε σε
  -- εισαγόμενη λίστα. Η ερώτηση πρέπει να τίθεται τη στιγμή της εισαγωγής.
  consent_basis text not null
                check (consent_basis in ('existing_customer','inquiry','public_b2b','purchased','other')),
  source_note   text,
  row_count     int not null default 0,
  created_by    uuid references public.profiles(user_id),
  created_at    timestamptz not null default now()
);

create table public.email_audience_members (
  id           uuid primary key default gen_random_uuid(),
  audience_id  uuid not null references public.email_audiences(id) on delete cascade,
  email_lower  text not null,
  display_name text,
  company      text,
  extra        jsonb not null default '{}'::jsonb,
  source_row   int,
  created_at   timestamptz not null default now(),
  unique (audience_id, email_lower)
);

create table public.email_campaign_audiences (
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  audience_id uuid not null references public.email_audiences(id) on delete restrict,
  primary key (campaign_id, audience_id)
);

create table public.email_campaign_recipients (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.email_campaigns(id) on delete cascade,
  email_lower        text not null,
  display_name       text,
  company            text,
  lead_id            uuid references public.leads(id) on delete set null,
  client_id          uuid references public.clients(id) on delete set null,
  audience_id        uuid references public.email_audiences(id) on delete set null,
  status             text not null default 'pending'
                     check (status in ('pending','sending','sent','failed','suppressed')),
  suppression_reason text,
  unsubscribe_token  uuid not null default gen_random_uuid(),
  resend_id          text,
  attempts           int not null default 0,
  claimed_at         timestamptz,
  error              text,
  queued_at          timestamptz not null default now(),
  sent_at            timestamptz,
  delivered_at       timestamptz,
  bounced_at         timestamptz,
  bounce_type        text,
  complained_at      timestamptz,
  unsubscribed_at    timestamptz,
  open_count         int not null default 0,
  click_count        int not null default 0,
  first_opened_at    timestamptz,
  first_clicked_at   timestamptz,
  replied_at         timestamptz,
  unique (campaign_id, email_lower)
);
comment on table public.email_campaign_recipients is
  'Είναι ταυτόχρονα η ουρά αποστολής και η γραμμή στοιχείων του κάθε παραλήπτη.';

create index email_campaign_recipients_claim
  on public.email_campaign_recipients (campaign_id, queued_at)
  where status = 'pending';
create index email_campaign_recipients_resend
  on public.email_campaign_recipients (resend_id) where resend_id is not null;
create index email_campaign_recipients_stats
  on public.email_campaign_recipients (campaign_id, status);
create index email_campaign_recipients_reply
  on public.email_campaign_recipients (email_lower, sent_at) where sent_at is not null;

-- Singleton ρυθμίσεων. Το `id boolean primary key check (id)` επιτρέπει
-- ακριβώς μία γραμμή.
create table public.email_marketing_settings (
  id                 boolean primary key default true check (id),
  paused             boolean not null default false,
  daily_cap          int not null default 500,
  hourly_cap         int not null default 200,
  batch_slice        int not null default 300,
  warmup_started_on  date,
  warmup_ladder      int[] not null default '{500,1000,2000,3000,5000,7500,10000}',
  max_bounce_rate    numeric not null default 0.04,
  max_complaint_rate numeric not null default 0.0008,
  fatigue_days       int not null default 30,
  updated_at         timestamptz not null default now()
);
insert into public.email_marketing_settings (id) values (true) on conflict do nothing;

create table public.email_campaign_heartbeat (
  id         boolean primary key default true check (id),
  ran_at     timestamptz not null default now(),
  sent_count int not null default 0,
  note       text
);
insert into public.email_campaign_heartbeat (id) values (true) on conflict do nothing;

-- --- RLS: ανάγνωση μόνο από admin, καμία εγγραφή από client -------------------
do $$
declare t text;
begin
  foreach t in array array['email_campaigns','email_audiences','email_audience_members',
                           'email_campaign_audiences','email_campaign_recipients',
                           'email_marketing_settings','email_campaign_heartbeat']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_is_admin()))',
      t || '_select', t);
  end loop;
end $$;

-- ROLLBACK: drop table (με τη σειρά) email_campaign_recipients, email_campaign_audiences,
--   email_audience_members, email_audiences, email_campaigns,
--   email_marketing_settings, email_campaign_heartbeat;
