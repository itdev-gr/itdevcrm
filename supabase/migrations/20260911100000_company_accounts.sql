-- =============================================================================
-- 20260911100000_company_accounts.sql
-- Owner (2026-09-11): νέα σελίδα Settings → Accounts, όπου μαζεύονται όλοι οι
-- λογαριασμοί που έχει η εταιρία (τίτλος, email, κωδικός, σημειώσεις) και τους
-- βλέπουν ΜΟΝΟ οι admins.
--
-- ΑΠΟΘΗΚΕΥΣΗ ΚΩΔΙΚΩΝ — δεν υπήρχε precedent στο CRM. Ο μόνος συγγενής
-- προηγούμενος (user_google_accounts.refresh_token_enc, 20260602000005) ορίζει
-- τον κανόνα: κρυπτογραφημένη στήλη + ΚΑΜΙΑ client policy + πρόσβαση μόνο
-- μέσω SECURITY DEFINER. Τον ακολουθούμε:
--   * ο κωδικός αποθηκεύεται ΚΡΥΠΤΟΓΡΑΦΗΜΕΝΟΣ (extensions.pgp_sym_encrypt) με
--     κλειδί που ζει στο Vault ('company_accounts_key') — ένα dump της βάσης
--     δεν αποκαλύπτει τίποτα·
--   * ο πίνακας έχει RLS enabled και ΚΑΜΙΑ policy, άρα ΚΑΝΕΝΑΣ client δεν τον
--     διαβάζει απευθείας (ούτε καν σε ciphertext) — όλα περνούν από τα 4 RPCs
--     παρακάτω, που ελέγχουν το ίδιο admin predicate·
--   * η αποκρυπτογράφηση γίνεται ΜΙΑ ΕΓΓΡΑΦΗ ΤΗ ΦΟΡΑ (company_account_password),
--     πίσω από το κουμπί «αποκάλυψη» — η λίστα δεν κουβαλάει ποτέ κωδικούς.
--
-- ΚΑΝΕΝΑ log_activity trigger εδώ: το log_activity() γράφει ΟΛΟΚΛΗΡΗ τη γραμμή
-- σε jsonb (20260502000004:44) — θα αντέγραφε το ciphertext (και σε μελλοντική
-- αλλαγή σχήματος, ό,τι άλλο μπει) στο activity_log.
--
-- ΚΑΝΕΝΑ `revoke ... on table`: το post-mortem 20260703030000 δείχνει ότι το
-- revoke σπάει την πρόσβαση παρά τις policies. Εδώ δεν χρειάζεται ούτως ή
-- άλλως — η απουσία policy είναι ήδη πλήρης φραγή.
--
-- ΠΡΟΑΠΑΙΤΟΥΜΕΝΟ: το κλειδί πρέπει να υπάρχει στο Vault ΠΡΙΝ γραφτεί ο πρώτος
-- κωδικός:
--   select vault.create_secret('<32+ τυχαίοι χαρακτήρες>', 'company_accounts_key');
-- Δεν μπαίνει στο migration ώστε να μη βρεθεί ποτέ σε git ή σε backup του repo.
-- =============================================================================

-- --- 1. Ο πίνακας -------------------------------------------------------------
create table if not exists public.company_accounts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  email        text,
  password_enc bytea,
  notes        text,
  created_by   uuid references public.profiles(user_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.company_accounts is
  'Λογαριασμοί της εταιρίας (Settings → Accounts). Admin-only μέσω RPCs· ο κωδικός είναι κρυπτογραφημένος με κλειδί από το Vault.';
comment on column public.company_accounts.password_enc is
  'pgp_sym_encrypt του κωδικού. Ποτέ σε SELECT προς client — μόνο company_account_password().';

create index if not exists company_accounts_title on public.company_accounts (lower(title));

drop trigger if exists company_accounts_set_updated_at on public.company_accounts;
create trigger company_accounts_set_updated_at
  before update on public.company_accounts
  for each row execute function public.set_updated_at();

-- RLS ON, καμία policy: μηδενική απευθείας πρόσβαση από τον browser.
alter table public.company_accounts enable row level security;

-- --- 2. Το κλειδί (ιδιωτικός helper) -----------------------------------------
-- Δεν δίνεται execute σε κανέναν ρόλο: το καλούν μόνο οι SECURITY DEFINER
-- functions παρακάτω, όπου ο current_user είναι ο owner τους.
create or replace function public.company_accounts_key()
returns text
language plpgsql stable security definer set search_path = public as $$
declare v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'company_accounts_key';
  if v_key is null or v_key = '' then
    raise exception 'company_accounts_key missing from vault' using errcode = '42704';
  end if;
  return v_key;
end $$;
revoke execute on function public.company_accounts_key() from public, anon, authenticated;

-- --- 3. Λίστα — ΧΩΡΙΣ κωδικούς -------------------------------------------------
create or replace function public.company_accounts_list()
returns table (
  id uuid, title text, email text, notes text,
  has_password boolean, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select a.id, a.title, a.email, a.notes,
           (a.password_enc is not null) as has_password,
           a.created_at, a.updated_at
      from public.company_accounts a
     order by lower(a.title), a.created_at;
end $$;
revoke execute on function public.company_accounts_list() from public, anon;
grant execute on function public.company_accounts_list() to authenticated;

-- --- 4. Αποκάλυψη ΕΝΟΣ κωδικού ------------------------------------------------
create or replace function public.company_account_password(p_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare v_enc bytea;
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select password_enc into v_enc from public.company_accounts where id = p_id;
  if v_enc is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_enc, public.company_accounts_key());
end $$;
revoke execute on function public.company_account_password(uuid) from public, anon;
grant execute on function public.company_account_password(uuid) to authenticated;

-- --- 5. Insert / update -------------------------------------------------------
-- p_password: null = μην αγγίξεις τον υπάρχοντα (ώστε το edit να μη σβήνει
-- κωδικό όταν το πεδίο μένει κενό), '' = καθάρισέ τον, αλλιώς = νέος κωδικός.
create or replace function public.company_account_upsert(
  p_id uuid,
  p_title text,
  p_email text default null,
  p_password text default null,
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text;
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'title_required' using errcode = '22023';
  end if;
  if p_password is not null and p_password <> '' then
    v_key := public.company_accounts_key();
  end if;

  if p_id is null then
    insert into public.company_accounts (title, email, notes, password_enc, created_by)
    values (
      btrim(p_title),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      case when v_key is not null then extensions.pgp_sym_encrypt(p_password, v_key) else null end,
      auth.uid()
    )
    returning id into v_id;
  else
    update public.company_accounts set
      title = btrim(p_title),
      email = nullif(btrim(coalesce(p_email, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      password_enc = case
        when p_password is null then password_enc
        when p_password = ''    then null
        else extensions.pgp_sym_encrypt(p_password, v_key)
      end
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.company_account_upsert(uuid, text, text, text, text) from public, anon;
grant execute on function public.company_account_upsert(uuid, text, text, text, text) to authenticated;

-- --- 6. Διαγραφή --------------------------------------------------------------
create or replace function public.company_account_delete(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (select public.current_user_is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.company_accounts where id = p_id;
end $$;
revoke execute on function public.company_account_delete(uuid) from public, anon;
grant execute on function public.company_account_delete(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK:
--   drop function if exists public.company_account_delete(uuid);
--   drop function if exists public.company_account_upsert(uuid, text, text, text, text);
--   drop function if exists public.company_account_password(uuid);
--   drop function if exists public.company_accounts_list();
--   drop function if exists public.company_accounts_key();
--   drop table if exists public.company_accounts;
--   -- και, αν δεν ξαναχρειαστεί: delete from vault.secrets where name = 'company_accounts_key';
