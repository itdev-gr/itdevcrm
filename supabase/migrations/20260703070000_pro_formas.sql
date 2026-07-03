-- Pro Forma documents («ΠΡΟΤΙΜΟΛΟΓΙΟ»): mirror of the offers document system
-- as a payment document. Same catalog/prices; payment-oriented statuses
-- (draft/sent/paid/cancelled); deliberately NO pipeline side effects
-- (offers move the lead to offer_sent + schedule follow-ups — pro formas
-- do neither, so there is no AFTER INSERT trigger here).

create table public.pro_formas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  source_offer_id uuid references public.offers(id) on delete set null,
  pro_forma_number text,
  status text not null default 'draft'
    check (status in ('draft','sent','paid','cancelled')),
  currency text not null default 'EUR',
  discount_amount numeric(12,2) not null default 0,
  vat_percent numeric(5,2) not null default 0,
  validity_days int not null default 14,
  notes text,
  items jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  pdf_path text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id),
  sent_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Same DB-level door-locks the offers table got in 20260504000009.
alter table public.pro_formas
  add constraint pro_formas_currency_check
    check (currency in ('EUR', 'USD', 'GBP')),
  add constraint pro_formas_vat_percent_check
    check (vat_percent >= 0 and vat_percent <= 100),
  add constraint pro_formas_discount_amount_check
    check (discount_amount >= 0),
  add constraint pro_formas_validity_days_check
    check (validity_days >= 1 and validity_days <= 365),
  add constraint pro_formas_items_shape_check
    check (jsonb_typeof(items) = 'array'),
  add constraint pro_formas_totals_shape_check
    check (jsonb_typeof(totals) = 'object');

create index pro_formas_lead on public.pro_formas (lead_id) where lead_id is not null;
create index pro_formas_deal on public.pro_formas (deal_id) where deal_id is not null;
create index pro_formas_client on public.pro_formas (client_id) where client_id is not null;
create index pro_formas_status_recent on public.pro_formas (status, created_at desc);

create trigger pro_formas_set_updated_at
  before update on public.pro_formas
  for each row execute function public.set_updated_at();

-- pro_forma_number generator: PRF-YYYYMM-#### (schema-qualified sequence,
-- global monotonic counter with a month prefix — same semantics as offers_seq).
create sequence if not exists public.pro_formas_seq;
create or replace function public.pro_formas_set_number()
returns trigger language plpgsql as $$
begin
  if new.pro_forma_number is null then
    new.pro_forma_number := 'PRF-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('public.pro_formas_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create trigger pro_formas_set_number_t before insert on public.pro_formas
  for each row execute function public.pro_formas_set_number();

-- The number trigger is not SECURITY DEFINER, so nextval runs as the
-- inserting role; grant explicitly rather than relying on default privileges
-- (which the grant-boundary remediation has tightened before).
grant usage, select on sequence public.pro_formas_seq to authenticated;

create unique index pro_formas_number_unique
  on public.pro_formas (pro_forma_number)
  where pro_forma_number is not null;

alter table public.pro_formas enable row level security;

-- Policy shapes copied from offers (verify against LIVE offers policies in
-- Task 8 before applying — prod function/policy bodies drift from .sql files).
create policy pro_formas_select on public.pro_formas for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_onboarding', 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or exists (
      select 1 from public.leads l
       where l.id = pro_formas.lead_id
         and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid())
    )
    or exists (
      select 1 from public.deals d
       where d.id = pro_formas.deal_id
         and (d.owner_user_id = auth.uid() or d.won_by_user_id = auth.uid())
    )
  );

create policy pro_formas_insert on public.pro_formas for insert to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
    or public.current_user_can('sales', 'edit')
  );

create policy pro_formas_update on public.pro_formas for update to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  );

-- Realtime so the lead/deal page picks up new pro formas immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pro_formas'
  ) then
    execute 'alter publication supabase_realtime add table public.pro_formas';
  end if;
end $$;

-- Private storage bucket for the generated PDFs.
insert into storage.buckets (id, name, public)
values ('proforma-pdfs', 'proforma-pdfs', false)
on conflict (id) do nothing;

drop policy if exists storage_proforma_pdfs_select on storage.objects;
drop policy if exists storage_proforma_pdfs_insert on storage.objects;
drop policy if exists storage_proforma_pdfs_update on storage.objects;

create policy storage_proforma_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'proforma-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  ));
create policy storage_proforma_pdfs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'proforma-pdfs' and (
    public.current_user_is_admin() or public.current_user_can('sales', 'edit')
  ));
create policy storage_proforma_pdfs_update on storage.objects for update to authenticated
  using (bucket_id = 'proforma-pdfs' and (
    public.current_user_is_admin() or public.current_user_can('sales', 'edit')
  ))
  with check (bucket_id = 'proforma-pdfs' and (
    public.current_user_is_admin() or public.current_user_can('sales', 'edit')
  ));

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- drop policy if exists storage_proforma_pdfs_select on storage.objects;
-- drop policy if exists storage_proforma_pdfs_insert on storage.objects;
-- drop policy if exists storage_proforma_pdfs_update on storage.objects;
-- (bucket objects must be removed via the dashboard first — protect_delete
--  blocks SQL deletes on storage.objects)
-- delete from storage.buckets where id = 'proforma-pdfs';
-- alter publication supabase_realtime drop table public.pro_formas;
-- drop table public.pro_formas cascade;
-- drop function if exists public.pro_formas_set_number();
-- drop sequence if exists public.pro_formas_seq;
