-- Validation gaps surfaced by the offer pipeline stress test:
-- the table accepted negative VAT, vat > 100, validity 0/-5, bogus currency,
-- discount > subtotal, malformed items / totals JSONB. The frontend prevents
-- most of these but a buggy or malicious client can write them. Lock the
-- door at the database level.

alter table public.offers
  drop constraint if exists offers_currency_check;
alter table public.offers
  add constraint offers_currency_check
  check (currency in ('EUR', 'USD', 'GBP'));

alter table public.offers
  drop constraint if exists offers_vat_percent_check;
alter table public.offers
  add constraint offers_vat_percent_check
  check (vat_percent >= 0 and vat_percent <= 100);

alter table public.offers
  drop constraint if exists offers_discount_amount_check;
alter table public.offers
  add constraint offers_discount_amount_check
  check (discount_amount >= 0);

alter table public.offers
  drop constraint if exists offers_validity_days_check;
alter table public.offers
  add constraint offers_validity_days_check
  check (validity_days >= 1 and validity_days <= 365);

alter table public.offers
  drop constraint if exists offers_items_shape_check;
alter table public.offers
  add constraint offers_items_shape_check
  check (jsonb_typeof(items) = 'array');

alter table public.offers
  drop constraint if exists offers_totals_shape_check;
alter table public.offers
  add constraint offers_totals_shape_check
  check (jsonb_typeof(totals) = 'object');
