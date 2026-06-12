-- =============================================================================
-- Contracts: admin-editable templates + per-client contracts with PDF + send.
-- Template bodies are plain text with {{placeholders}} resolved from the
-- client card at create time; the resolved body is snapshotted onto the
-- contract row and remains editable. PDFs land in the private
-- `contract-pdfs` bucket; sending goes through the send-email edge function
-- with the PDF attached (template key `contract_send`, seeded below).
--
-- Rollback:
--   delete from public.email_templates where key = 'contract_send';
--   drop table public.contracts;
--   drop table public.contract_templates;
--   drop function public.contracts_set_number();
--   drop sequence if exists contracts_seq;
--   drop policy storage_contract_pdfs_select on storage.objects;
--   delete from storage.objects where bucket_id = 'contract-pdfs';
--   delete from storage.buckets where id = 'contract-pdfs';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reusable contract templates (admin-managed, like email_templates).
-- ---------------------------------------------------------------------------
create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contract_templates_set_updated_at
  before update on public.contract_templates
  for each row execute function public.set_updated_at();

alter table public.contract_templates enable row level security;
create policy contract_templates_select on public.contract_templates
  for select to authenticated using (true);
create policy contract_templates_mutate_admin on public.contract_templates
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ---------------------------------------------------------------------------
-- Contracts. Access rides the `clients` board permissions.
-- ---------------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_id uuid references public.contract_templates(id) on delete set null,
  contract_number text,
  title text not null default '',
  body text not null default '',
  status text not null default 'draft'
    check (status in ('draft','sent','signed','declined')),
  pdf_path text,
  created_by uuid references public.profiles(user_id) default auth.uid(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_client on public.contracts (client_id);
create index contracts_status_recent on public.contracts (status, created_at desc);

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- contract_number generator: CTR-YYYYMM-#### (mirrors offers_set_number)
create sequence if not exists contracts_seq;
create or replace function public.contracts_set_number()
returns trigger language plpgsql as $$
begin
  if new.contract_number is null then
    new.contract_number := 'CTR-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('contracts_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create trigger contracts_set_number_t before insert on public.contracts
  for each row execute function public.contracts_set_number();

alter table public.contracts enable row level security;

create policy contracts_select on public.contracts for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
  );
create policy contracts_insert on public.contracts for insert to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  );
create policy contracts_update on public.contracts for update to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
  );
create policy contracts_delete on public.contracts for delete to authenticated
  using (public.current_user_is_admin());

-- Realtime so client tabs pick up new contracts immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contracts'
  ) then
    execute 'alter publication supabase_realtime add table public.contracts';
  end if;
end $$;

-- Private storage bucket for generated PDFs (mirrors offer-pdfs).
insert into storage.buckets (id, name, public)
values ('contract-pdfs', 'contract-pdfs', false)
on conflict (id) do nothing;

drop policy if exists storage_contract_pdfs_select on storage.objects;
create policy storage_contract_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'contract-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
  ));

-- ---------------------------------------------------------------------------
-- Email template for the send flow (admin-editable like the others).
-- ---------------------------------------------------------------------------
insert into public.email_templates (key, description, subject, body, variables, client_facing)
values (
  'contract_send',
  'Αποστολή σύμβασης σε πελάτη (PDF συνημμένο)',
  'Σύμβαση συνεργασίας {{contract_number}} — ITDEV',
  'Αγαπητέ/ή {{client_name}},

Σας αποστέλλουμε συνημμένη τη σύμβαση συνεργασίας «{{contract_title}}» ({{contract_number}}) σε μορφή PDF.

Παρακαλούμε διαβάστε την προσεκτικά και επιστρέψτε μας υπογεγραμμένο αντίγραφο.

Με εκτίμηση,
ITDEV',
  'client_name, contract_title, contract_number',
  true
)
on conflict (key) do nothing;
