-- =============================================================================
-- Η ένδειξη «δεν θέλει email» σε κάθε lead και deal (owner request 2026-09-11).
--
-- Ο owner ζήτησε ένδειξη σε ΟΛΕΣ τις καρτέλες, **αυτόματη**, που «δεν θα μπορεί
-- να την πειράξει κανείς εκτός από τους admin».
--
-- Γιατί στήλη και όχι query στη λίστα:
--   * το `email_suppressions` έχει RLS admin-only — αν το badge διάβαζε από εκεί,
--     οι πωλητές (που είναι και οι χρήστες των καρτελών) δεν θα έβλεπαν τίποτα·
--   * τα kanban φέρνουν εκατοντάδες κάρτες με ένα query — ένα join ανά κάρτα θα
--     ήταν N+1.
-- Η στήλη συγχρονίζεται αυτόματα και προς τις δύο κατευθύνσεις και ένα guger
-- trigger απορρίπτει κάθε χειροκίνητη αλλαγή: «δεν το πειράζει κανείς» δομικά,
-- ακόμη κι από το API.
--
-- Δύο διαφορετικές καταστάσεις, γιατί σημαίνουν εντελώς άλλα πράγματα:
--   refused        = το ζήτησε ο άνθρωπος (unsubscribed / complaint / manual)
--   undeliverable  = η διεύθυνση δεν δουλεύει (hard_bounce / soft_bounce / invalid)
-- Σήμερα: 4 refused, 407 undeliverable στα leads.
-- =============================================================================

alter table public.leads   add column if not exists email_optout_state text;
alter table public.clients add column if not exists email_optout_state text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.leads'::regclass
                    and conname = 'leads_email_optout_state_check') then
    alter table public.leads add constraint leads_email_optout_state_check
      check (email_optout_state is null or email_optout_state in ('refused', 'undeliverable'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.clients'::regclass
                    and conname = 'clients_email_optout_state_check') then
    alter table public.clients add constraint clients_email_optout_state_check
      check (email_optout_state is null or email_optout_state in ('refused', 'undeliverable'));
  end if;
end $$;

comment on column public.leads.email_optout_state is
  'ΑΥΤΟΜΑΤΟ, παράγεται από email_suppressions. refused = το ζήτησε· undeliverable = νεκρή διεύθυνση. Μην το γράφετε με το χέρι.';
comment on column public.clients.email_optout_state is
  'ΑΥΤΟΜΑΤΟ, παράγεται από email_suppressions. refused = το ζήτησε· undeliverable = νεκρή διεύθυνση. Μην το γράφετε με το χέρι.';

-- --- Ο κανόνας: λόγος → κατάσταση --------------------------------------------
create or replace function public.suppression_state_for_reason(p_reason text)
returns text
language sql immutable set search_path = public as $$
  select case
    when p_reason in ('unsubscribed', 'complaint', 'manual') then 'refused'
    when p_reason in ('hard_bounce', 'soft_bounce', 'invalid') then 'undeliverable'
    else null
  end;
$$;

-- Η κατάσταση για μια διεύθυνση (null αν δεν είναι στη λίστα).
create or replace function public.email_optout_state_for(p_email text)
returns text
language sql stable security definer set search_path = public as $$
  select public.suppression_state_for_reason(s.reason)
    from public.email_suppressions s
   where s.email_lower = lower(btrim(coalesce(p_email, '')))
   limit 1;
$$;
revoke execute on function public.email_optout_state_for(text) from public, anon;
grant execute on function public.email_optout_state_for(text) to authenticated, service_role;

-- --- Κατεύθυνση Α: αλλαγή στη λίστα → ενημέρωση των καρτελών ------------------
create or replace function public.suppressions_sync_entities()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := coalesce(new.email_lower, old.email_lower);
  v_state text := case when tg_op = 'DELETE'
                       then null
                       else public.suppression_state_for_reason(new.reason) end;
begin
  update public.leads l
     set email_optout_state = v_state
   where lower(btrim(coalesce(l.email, ''))) = v_email
     and l.email_optout_state is distinct from v_state;

  update public.clients c
     set email_optout_state = v_state
   where lower(btrim(coalesce(c.email, ''))) = v_email
     and c.email_optout_state is distinct from v_state;

  return coalesce(new, old);
end $$;

drop trigger if exists suppressions_sync_entities on public.email_suppressions;
create trigger suppressions_sync_entities
  after insert or update of reason or delete on public.email_suppressions
  for each row execute function public.suppressions_sync_entities();

-- --- Κατεύθυνση Β: αλλαγή email σε lead/client → υπολογισμός της σημαίας ------
create or replace function public.entity_email_optout_refresh()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email_optout_state := public.email_optout_state_for(new.email);
  return new;
end $$;

drop trigger if exists leads_email_optout_refresh on public.leads;
create trigger leads_email_optout_refresh
  before insert or update of email on public.leads
  for each row execute function public.entity_email_optout_refresh();

drop trigger if exists clients_email_optout_refresh on public.clients;
create trigger clients_email_optout_refresh
  before insert or update of email on public.clients
  for each row execute function public.entity_email_optout_refresh();

-- --- Backfill -----------------------------------------------------------------
update public.leads l
   set email_optout_state = public.suppression_state_for_reason(s.reason)
  from public.email_suppressions s
 where s.email_lower = lower(btrim(coalesce(l.email, '')))
   and l.email_optout_state is distinct from public.suppression_state_for_reason(s.reason);

update public.clients c
   set email_optout_state = public.suppression_state_for_reason(s.reason)
  from public.email_suppressions s
 where s.email_lower = lower(btrim(coalesce(c.email, '')))
   and c.email_optout_state is distinct from public.suppression_state_for_reason(s.reason);

create index if not exists leads_email_optout_state_idx
  on public.leads (email_optout_state) where email_optout_state is not null;
create index if not exists clients_email_optout_state_idx
  on public.clients (email_optout_state) where email_optout_state is not null;

-- --- Guard: η στήλη δεν μπορεί να πάρει τιμή που δεν λέει η λίστα -------------
-- Μπαίνει ΤΕΛΕΥΤΑΙΟ, αφού τελειώσει το backfill (που γράφει απευθείας).
--
-- Ο έλεγχος είναι στην ΤΙΜΗ, όχι στο ποιος γράφει: όποιο μονοπάτι κι αν έγραψε,
-- η τιμή πρέπει να συμφωνεί με τη λίστα. Έτσι ο συγχρονισμός και η αλλαγή email
-- περνούν φυσιολογικά (γράφουν τη σωστή τιμή), ενώ μια χειροκίνητη απόπειρα να
-- «σβηστεί» ή να μπει η ένδειξη αυθαίρετα απορρίπτεται. (Ένας έλεγχος με
-- pg_trigger_depth θα έσπαγε την απλή αλλαγή διεύθυνσης σε μια καρτέλα.)
create or replace function public.email_optout_state_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.email_optout_state is distinct from public.email_optout_state_for(new.email) then
    raise exception 'email_optout_state is maintained automatically from the suppression list'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists leads_email_optout_state_guard on public.leads;
create trigger leads_email_optout_state_guard
  before update of email_optout_state on public.leads
  for each row execute function public.email_optout_state_guard();

drop trigger if exists clients_email_optout_state_guard on public.clients;
create trigger clients_email_optout_state_guard
  before update of email_optout_state on public.clients
  for each row execute function public.email_optout_state_guard();

-- ROLLBACK:
--   drop trigger if exists leads_email_optout_refresh on public.leads;
--   drop trigger if exists clients_email_optout_refresh on public.clients;
--   drop trigger if exists suppressions_sync_entities on public.email_suppressions;
--   drop trigger if exists leads_email_optout_state_guard on public.leads;
--   drop trigger if exists clients_email_optout_state_guard on public.clients;
--   drop function if exists public.entity_email_optout_refresh(),
--        public.suppressions_sync_entities(), public.email_optout_state_guard(),
--        public.email_optout_state_for(text), public.suppression_state_for_reason(text);
--   alter table public.leads   drop column if exists email_optout_state;
--   alter table public.clients drop column if exists email_optout_state;
