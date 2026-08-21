-- =============================================================================
-- Contracts: allow a LEAD as the contract party (pre-conversion contracts).
-- Mirrors the offers/pro_formas dual-entity shape: nullable client_id +
-- lead_id side by side with an at-least-one check. Existing rows all carry
-- client_id and are unaffected. The UI only ever sets exactly one of the two;
-- both-set is tolerated (like offers) so a lead→client conversion backfill
-- stays possible without constraint gymnastics.
--
-- lead_id cascades on lead delete (matches client_id's cascade — `set null`
-- could orphan a row into violating the at-least-one check).
--
-- RLS: client-based clauses unchanged; lead-based contracts ride the sales
-- board permissions or lead ownership (owner/won_by), mirroring leads RLS.
-- The contract-pdfs storage read policy is broadened so sales staff can open
-- lead-contract PDFs (the object path carries only the contract id, so a
-- per-object ownership check is not practical there).
--
-- No function redefinitions in this migration (contracts_set_number is
-- untouched), so no pg_get_functiondef md5 pre/post capture is required.
--
-- Rollback (only if no lead contracts exist):
--   drop policy contracts_select on public.contracts;
--   drop policy contracts_insert on public.contracts;
--   drop policy contracts_update on public.contracts;
--   -- recreate the originals from 20260611120000_contracts_schema.sql L86-104
--   alter table public.contracts drop constraint contracts_party_check;
--   delete from public.contracts where client_id is null;
--   alter table public.contracts alter column client_id set not null;
--   drop index if exists contracts_lead;
--   alter table public.contracts drop column lead_id;
--   drop policy storage_contract_pdfs_select on storage.objects;
--   -- recreate the original from 20260611120000_contracts_schema.sql L124-129
-- =============================================================================

alter table public.contracts
  add column lead_id uuid references public.leads(id) on delete cascade;

alter table public.contracts alter column client_id drop not null;

alter table public.contracts
  add constraint contracts_party_check
  check (client_id is not null or lead_id is not null);

create index contracts_lead on public.contracts (lead_id) where lead_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: extend for lead-based contracts.
-- ---------------------------------------------------------------------------
drop policy contracts_select on public.contracts;
create policy contracts_select on public.contracts for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view_all')
    or exists (
      select 1 from public.leads l
       where l.id = contracts.lead_id
         and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid())
    )
  );

drop policy contracts_insert on public.contracts;
create policy contracts_insert on public.contracts for insert to authenticated
  with check (
    public.current_user_is_admin()
    or (client_id is not null and public.current_user_can('clients', 'edit'))
    or (lead_id is not null and (
      public.current_user_can('sales', 'edit')
      or exists (
        select 1 from public.leads l
         where l.id = contracts.lead_id and l.owner_user_id = auth.uid()
      )
    ))
  );

drop policy contracts_update on public.contracts;
create policy contracts_update on public.contracts for update to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
    or (lead_id is not null and (
      public.current_user_can('sales', 'edit')
      or exists (
        select 1 from public.leads l
         where l.id = contracts.lead_id
           and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid())
      )
    ))
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
    or (lead_id is not null and (
      public.current_user_can('sales', 'edit')
      or exists (
        select 1 from public.leads l
         where l.id = contracts.lead_id
           and (l.owner_user_id = auth.uid() or l.won_by_user_id = auth.uid())
      )
    ))
  );

-- PDF bucket read: sales staff must be able to open lead-contract PDFs.
drop policy if exists storage_contract_pdfs_select on storage.objects;
create policy storage_contract_pdfs_select on storage.objects for select to authenticated
  using (bucket_id = 'contract-pdfs' and (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('sales', 'view')
  ));
