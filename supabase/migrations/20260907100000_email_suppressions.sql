-- =============================================================================
-- 20260907100000_email_suppressions.sql
-- Καθολική λίστα «μην στέλνεις». Μέχρι σήμερα τίποτα δεν εμπόδιζε μια νέα
-- αποστολή να ξαναχτυπήσει διεύθυνση που έχει ήδη απορριφθεί μόνιμα: ο μόνος
-- έλεγχος ήταν ανά dedupe_key, και κάθε νέα καμπάνια έχει εξ ορισμού νέο key.
-- Αυτή η φάση ΧΤΙΖΕΙ τη λίστα· η επιβολή της γίνεται στη Φάση 1 (καμπάνιες).
-- Καμία υπάρχουσα ροή email δεν αλλάζει εδώ.
-- =============================================================================

create table if not exists public.email_suppressions (
  email_lower   text primary key,
  reason        text not null check (reason in ('hard_bounce','soft_bounce','complaint','manual','invalid','unsubscribed')),
  source        text,
  bounce_count  int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  note          text
);

comment on table public.email_suppressions is
  'Διευθύνσεις που δεν πρέπει να λάβουν άλλο email. Κλειδί: lower(btrim(email)).';

alter table public.email_suppressions enable row level security;

drop policy if exists email_suppressions_select on public.email_suppressions;
create policy email_suppressions_select on public.email_suppressions
  for select to authenticated
  using ((select public.current_user_is_admin()));

-- Καμία policy για insert/update/delete: όλες οι εγγραφές περνούν από τις
-- SECURITY DEFINER συναρτήσεις παρακάτω.

-- --- Upsert helper -----------------------------------------------------------
-- Η αιτία δεν «υποβαθμίζεται» ποτέ. Ιεραρχία (από υψηλότερη σε χαμηλότερη):
-- unsubscribed (ρητή απόφαση χρήστη) > complaint (spam) > hard_bounce (bounce).
create or replace function public.suppress_email(
  p_email text,
  p_reason text,
  p_source text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return;
  end if;

  insert into public.email_suppressions (email_lower, reason, source, bounce_count, first_seen_at, last_seen_at)
  values (v_email, p_reason, p_source, case when p_reason like '%bounce' then 1 else 0 end, now(), now())
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
        source = coalesce(excluded.source, public.email_suppressions.source);
end $$;
revoke execute on function public.suppress_email(text, text, text) from public, anon;
grant execute on function public.suppress_email(text, text, text) to authenticated;

-- --- Admin removal -----------------------------------------------------------
create or replace function public.unsuppress_email(p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.email_suppressions where email_lower = lower(btrim(p_email));
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke execute on function public.unsuppress_email(text) from public, anon;
grant execute on function public.unsuppress_email(text) to authenticated;

-- --- Backfill από το ιστορικό ------------------------------------------------
-- Το email_log δεν ξεχωρίζει μόνιμα από προσωρινά bounces (η διάκριση μπαίνει
-- στη Φάση 1 από το webhook). Καταγράφουμε ό,τι ξέρουμε: παράπονο ή bounce.
insert into public.email_suppressions (email_lower, reason, source, bounce_count, first_seen_at, last_seen_at)
select lower(btrim(l.to_email)),
       case when bool_or(l.status = 'complained') then 'complaint' else 'hard_bounce' end,
       'email_log_backfill',
       count(*) filter (where l.status = 'bounced'),
       min(l.created_at),
       max(l.created_at)
  from public.email_log l
 where l.status in ('bounced', 'complained')
   and l.to_email is not null
   and lower(btrim(l.to_email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
 group by lower(btrim(l.to_email))
on conflict (email_lower) do nothing;

-- --- Συντήρηση από εδώ και πέρα ----------------------------------------------
create or replace function public.email_log_suppression_sync()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'complained' then
    perform public.suppress_email(new.to_email, 'complaint', 'email_log');
  elsif new.status = 'bounced' then
    perform public.suppress_email(new.to_email, 'hard_bounce', 'email_log');
  end if;
  return new;
end $$;

drop trigger if exists email_log_suppression_sync on public.email_log;
create trigger email_log_suppression_sync
  after insert or update of status on public.email_log
  for each row
  when (new.status in ('bounced', 'complained'))
  execute function public.email_log_suppression_sync();

create index if not exists email_log_status_to_email
  on public.email_log (status, to_email)
  where status in ('bounced', 'complained');

-- ROLLBACK: drop trigger email_log_suppression_sync on public.email_log;
--           drop function public.email_log_suppression_sync(), public.suppress_email(text,text,text),
--                public.unsuppress_email(text);
--           drop table public.email_suppressions;
