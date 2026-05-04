create table public.offers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  offer_number text,
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','rejected','expired')),
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
  updated_at timestamptz not null default now()
);

create index offers_lead on public.offers (lead_id) where lead_id is not null;
create index offers_deal on public.offers (deal_id) where deal_id is not null;
create index offers_client on public.offers (client_id) where client_id is not null;
create index offers_status_recent on public.offers (status, created_at desc);

create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

-- offer_number generator: OFR-YYYYMM-#### scoped to the month
create sequence if not exists offers_seq;
create or replace function public.offers_set_number()
returns trigger language plpgsql as $$
begin
  if new.offer_number is null then
    new.offer_number := 'OFR-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('offers_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create trigger offers_set_number_t before insert on public.offers
  for each row execute function public.offers_set_number();

alter table public.offers enable row level security;

-- Read scope mirrors deals: admin + accounting see all,
-- sales see only offers tied to leads/deals they own or won.
create policy offers_select on public.offers for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_onboarding', 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or exists (
      select 1 from public.leads l
       where l.id = offers.lead_id
         and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid())
    )
    or exists (
      select 1 from public.deals d
       where d.id = offers.deal_id
         and (d.owner_user_id = auth.uid() or d.won_by_user_id = auth.uid())
    )
  );

create policy offers_insert on public.offers for insert to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
    or public.current_user_can('sales', 'edit')
  );

create policy offers_update on public.offers for update to authenticated
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

-- Realtime so the lead/deal page picks up the new offer immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offers'
  ) then
    execute 'alter publication supabase_realtime add table public.offers';
  end if;
end $$;

-- Private storage bucket for the generated PDFs.
insert into storage.buckets (id, name, public)
values ('offer-pdfs', 'offer-pdfs', false)
on conflict (id) do nothing;

drop policy if exists storage_offer_pdfs_select on storage.objects;
drop policy if exists storage_offer_pdfs_insert on storage.objects;

create policy storage_offer_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  ));
create policy storage_offer_pdfs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin() or public.current_user_can('sales', 'edit')
  ));
