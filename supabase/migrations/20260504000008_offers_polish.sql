-- Follow-ups from the offers schema review:
-- 1. Schema-qualify the sequence reference in offers_set_number() so
--    search_path changes can't break it.
-- 2. Add a partial unique index on offer_number to prevent duplicates if a
--    caller bypasses the trigger by passing a value at insert time.
-- 3. Add a storage UPDATE policy so the PDF endpoint's upsert(true) call
--    succeeds on re-generation. (Without it, the second PDF for the same
--    offer fails with a permissions error.)

-- 1. Function with schema-qualified sequence
create or replace function public.offers_set_number()
returns trigger language plpgsql as $$
begin
  if new.offer_number is null then
    new.offer_number := 'OFR-' || to_char(now(), 'YYYYMM') || '-' ||
      lpad(nextval('public.offers_seq')::text, 4, '0');
  end if;
  return new;
end $$;

-- 2. Unique index protecting offer_number
create unique index if not exists offers_number_unique
  on public.offers (offer_number)
  where offer_number is not null;

-- 3. Storage UPDATE policy for PDF re-generation
drop policy if exists storage_offer_pdfs_update on storage.objects;
create policy storage_offer_pdfs_update on storage.objects for update to authenticated
  using (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin() or public.current_user_can('sales', 'edit')
  ))
  with check (bucket_id = 'offer-pdfs' and (
    public.current_user_is_admin() or public.current_user_can('sales', 'edit')
  ));
