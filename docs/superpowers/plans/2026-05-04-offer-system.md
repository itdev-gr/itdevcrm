# Offer System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the standalone Astro offer-builder app into the CRM so a sales person can press one "Create offer" button on a lead and produce a stored, branded PDF tied to that lead — with a full admin services catalog and Sentry coverage on every new mutation.

**Architecture:** Two new Postgres tables (`service_subpackages` + `offers`), one extended (`service_packages` adds `description`, `subtitle`, `is_active`, allows `'ads'`). The offer builder UI is a single React page reachable from a button on the lead detail page; it reads the catalog from Supabase, lets the user pick items + sub-products + extras + custom prices, computes totals, and writes to `offers`. PDF generation runs as a Vercel serverless function using `@sparticuz/chromium` + `puppeteer-core` against a server-rendered HTML template, then stores the PDF in a private Supabase Storage bucket and returns a signed URL. Sentry is wrapped around every mutation hook + new RPC client.

**Tech Stack:** Supabase (Postgres + RLS + Storage), React 19 + Vite + TanStack Query (existing), Vercel serverless function (new), `puppeteer-core` + `@sparticuz/chromium` for PDFs, `@sentry/react` (already installed).

**Source data:** The standalone app at `/Users/marios/Desktop/Cursor/Offer_system-main/`. Catalog lives at `src/data/catalog.json` (5 categories, ~30 items, sub-products). PDF template lives at `src/templates/OfferPdfTemplate.astro` and `src/lib/pdf-template.ts`. We are porting the catalog data verbatim and matching the PDF visual; we are NOT porting the Firebase auth or Astro routing.

**Open questions (none, all defaults locked by the user):** native port, PDF reproduced via serverless, two-level catalog (item + sub-products), button on lead detail, extend existing `/admin/service-packages`.

---

## File Structure

**New files:**
- `supabase/migrations/20260504000005_offer_catalog_extensions.sql` — extends `service_packages`, adds `service_subpackages` table, allows `'ads'` service_type, seeds the offer-system catalog.
- `supabase/migrations/20260504000006_offers_table.sql` — `offers` table + RLS + storage bucket.
- `src/lib/offers/types.ts` — `OfferItem`, `OfferTotals`, calc helpers.
- `src/lib/offers/calculate.ts` — `calculateTotals()` and pure helpers (testable).
- `src/lib/offers/calculate.test.ts` — vitest tests.
- `src/features/offers/hooks/useOfferCatalog.ts` — fetches packages + subpackages grouped by service_type.
- `src/features/offers/hooks/useCreateOffer.ts` — mutation, wrapped in Sentry.
- `src/features/offers/hooks/useOffer.ts` — fetch one offer.
- `src/features/offers/hooks/useOffersForDeal.ts` — fetch offers for a lead/deal.
- `src/features/offers/OfferBuilderPage.tsx` — full-page form (the port of `OfferBuilder.tsx`).
- `src/features/offers/OfferSummaryPanel.tsx` — bottom summary table.
- `src/features/offers/OfferDetailPage.tsx` — view existing offer + Download PDF button.
- `src/features/offers/OffersTab.tsx` — list of offers shown inside the deal page.
- `api/offer-pdf.ts` — Vercel serverless function.
- `api/_pdf-template.ts` — server-side HTML template (mirrors the Astro template).
- `src/lib/sentry/captureMutation.ts` — generic wrapper that reports errors with context.

**Modified files:**
- `src/types/supabase.ts` — regenerated.
- `src/lib/queryKeys.ts` — adds `offerCatalog`, `offer`, `offersForDeal`.
- `src/features/service_packages/ServicePackagesPage.tsx` — adds the active/inactive toggle, sub-products section, description column.
- `src/features/service_packages/ServicePackageDialog.tsx` — adds description, subtitle, is_active fields.
- `src/features/leads/LeadDetailPage.tsx` — adds "Create offer" button + Offers tab content.
- `src/features/deals/DealDetailPage.tsx` — same Offers tab on the deal side.
- `src/app/router.tsx` — adds `/leads/:leadId/offers/new`, `/offers/:offerId`.
- `src/components/layout/Sidebar.tsx` — no change. Offers are accessed only from the lead/deal context.
- `src/i18n/locales/{en,el}/offers.json` — new namespace (created in Task 1).

**One file deleted:** `src/app/routes/SentryCheckPage.tsx` + its router entry — already verified, no longer needed.

---

## Task 1: Catalog schema + seed

**Files:**
- Create: `supabase/migrations/20260504000005_offer_catalog_extensions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Extend service_packages to carry the offer-system fields and allow Ads.
alter table public.service_packages
  drop constraint if exists service_packages_service_type_check;
alter table public.service_packages
  add constraint service_packages_service_type_check
  check (service_type in
    ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads'));

alter table public.service_packages
  add column if not exists subtitle text;
alter table public.service_packages
  add column if not exists is_active boolean not null default true;

-- description already exists. Promote it to long-form by removing implicit length.
-- (Postgres text has no limit; nothing to do.)

-- Sub-products live in their own table so the catalog admin can reorder /
-- price them independently of the parent package.
create table if not exists public.service_subpackages (
  id uuid primary key default gen_random_uuid(),
  parent_package_id uuid not null references public.service_packages(id) on delete cascade,
  code text not null,
  display_names jsonb not null,
  description text,
  price numeric(12,2) not null default 0,
  sort_order int not null default 0,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_package_id, code)
);

create trigger service_subpackages_set_updated_at
  before update on public.service_subpackages
  for each row execute function public.set_updated_at();

alter table public.service_subpackages enable row level security;

create policy service_subpackages_select_authenticated
  on public.service_subpackages for select to authenticated using (true);

create policy service_subpackages_mutate_admin
  on public.service_subpackages for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- New ads group so RLS works for the future ads kanban (mirrors the seeded
-- ai_seo / hosting groups). Permissions left empty until the ads board ships.
insert into public.groups (code, display_names, parent_label, position)
values ('ads', '{"en":"Ads","el":"Διαφήμιση"}'::jsonb, 'Technical', 90)
on conflict (code) do nothing;
```

(The seed of catalog rows lives in Task 2 so this migration is reversible without touching data.)

- [ ] **Step 2: Push and regen types**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
SUPABASE_ACCESS_TOKEN=<token> npm run types:gen
```

Expected: migration applied, `src/types/supabase.ts` gains `service_subpackages`, `subtitle`, `is_active`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260504000005_offer_catalog_extensions.sql src/types/supabase.ts
git commit -m "feat(catalog): extend service_packages + add service_subpackages table"
```

---

## Task 2: Seed the offer-system catalog

**Files:**
- Create: `supabase/migrations/20260504000006_seed_offer_catalog.sql`

- [ ] **Step 1: Write the migration**

The migration upserts every row from `Offer_system-main/src/data/catalog.json` into `service_packages` (top-level) and `service_subpackages` (children). Mapping:

| Catalog category | service_type |
|---|---|
| Website Development | web_dev |
| Local SEO | local_seo |
| Web SEO | web_seo |
| AI SEO | ai_seo |
| Social Media | social_media |
| Ads | ads |

For each catalog item: insert `service_packages` with `code = catalog item.id`, `display_names = {"en": label, "el": label}` (Greek labels are already in the catalog), `description`, `default_one_time_amount` for one-time items / `default_monthly_amount` for monthly items, `is_active = true`.

For each `subProducts` entry: insert `service_subpackages` keyed by `(parent_package_id, code = subProduct.id)`.

Use `on conflict (service_type, code) do update` on the parents and `on conflict (parent_package_id, code) do update` on children so the migration is idempotent and re-runs cleanly.

```sql
-- Top-level packages: 30+ rows. Example structure (the migration writes all of them):
insert into public.service_packages
  (service_type, code, display_names, description, default_one_time_amount, default_monthly_amount, sort_order, is_active)
values
  ('web_dev', 'web-dev-landing',
    '{"en":"Landing Page","el":"Landing Page"}'::jsonb,
    'Στοχευμένη Landing Page για conversions, copywriting για leads, ...',
    300, 0, 10, true),
  ('web_dev', 'web-dev-professional', ...),
  ...
on conflict (service_type, code) do update set
  display_names = excluded.display_names,
  description = excluded.description,
  default_one_time_amount = excluded.default_one_time_amount,
  default_monthly_amount = excluded.default_monthly_amount,
  sort_order = excluded.sort_order;

-- Sub-products keyed off parent code:
with parents as (
  select id, code, service_type from public.service_packages
)
insert into public.service_subpackages
  (parent_package_id, code, display_names, description, price, sort_order)
select p.id, sp.code, sp.display_names, sp.description, sp.price, sp.sort_order
from parents p
cross join lateral (values
  ('web-dev-landing', 'extra-booking-stripe', ...),
  ('web-dev-landing', 'extra-diglosso', ...),
  ...
) as sp(parent_code, code, display_names, description, price, sort_order)
where p.code = sp.parent_code
on conflict (parent_package_id, code) do update set
  display_names = excluded.display_names,
  description = excluded.description,
  price = excluded.price,
  sort_order = excluded.sort_order;
```

The full SQL is generated by reading the catalog JSON and writing one VALUES tuple per item. Don't try to hand-type 30+ rows — read the JSON, transform, write to the migration file.

- [ ] **Step 2: Verify**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
```

Then via Management API:

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"query":"select service_type, count(*) from public.service_packages where archived=false group by service_type;"}'
```

Expected counts (matching the catalog):
- web_dev: 3
- local_seo: 3
- web_seo: 3
- ai_seo: 2
- social_media: 6
- ads: 3

And `select count(*) from public.service_subpackages` should return 12 (all rows under the three web-dev parents).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260504000006_seed_offer_catalog.sql
git commit -m "feat(catalog): seed offer-system catalog into service_packages + subpackages"
```

---

## Task 3: Admin Services UI — sub-products + active toggle + description

**Files:**
- Modify: `src/features/service_packages/ServicePackagesPage.tsx`
- Modify: `src/features/service_packages/ServicePackageDialog.tsx`
- Create: `src/features/service_packages/SubpackageDialog.tsx`
- Create: `src/features/service_packages/hooks/useServiceSubpackages.ts`
- Create: `src/features/service_packages/hooks/useUpsertSubpackage.ts`
- Create: `src/features/service_packages/hooks/useArchiveSubpackage.ts`

The existing page already supports add / edit / archive. This task adds:
1. An **Active** toggle column that calls a new mutation flipping `is_active`.
2. A **Description** column, truncated to one line with full text on hover.
3. A **Sub-products** expandable row under each package showing its sub-packages, with their own add / edit / archive controls.

- [ ] **Step 1: Add `useUpsertSubpackage` + `useArchiveSubpackage` hooks** mirroring the existing `useUpsertServicePackage` / `useArchiveServicePackage` patterns. Each is wrapped in the Sentry `captureMutation` helper from Task 14 — for now, just define the hooks; Sentry hardening lands in the final task.

- [ ] **Step 2: Add `useServiceSubpackages(parentId)` hook** that fetches `select * from service_subpackages where parent_package_id = ? and archived = false order by sort_order`.

- [ ] **Step 3: Update `ServicePackageDialog`** to include `description` (textarea), `subtitle` (input), and `is_active` (checkbox) fields. Save them via the existing upsert mutation.

- [ ] **Step 4: Build `SubpackageDialog`** identical in shape to `ServicePackageDialog` but with a `parentId` prop and only `code`, `display_names`, `description`, `price`, `sort_order`, `is_active` fields.

- [ ] **Step 5: Update `ServicePackagesPage`** so each package row has an expand button. Expanding fetches the sub-packages and renders them as a nested table with **+ Add sub-product**, **Edit**, **Archive** controls and the same Active toggle.

- [ ] **Step 6: Verify in the running app**

Open `/admin/service-packages`. You should see the seeded catalog grouped by service type, expandable to see web-dev sub-products. Archive toggles a row; Active checkbox flips `is_active`. Adding a new package and a sub-product saves and appears immediately.

- [ ] **Step 7: Commit**

```bash
git add src/features/service_packages
git commit -m "feat(admin): manage service sub-products + active toggle + description"
```

---

## Task 4: Offers schema + storage bucket

**Files:**
- Create: `supabase/migrations/20260504000007_offers_table.sql`

- [ ] **Step 1: Write the migration**

```sql
-- An offer is sales-side proposal artifact tied to a lead. After conversion
-- it follows the deal (deal_id is set lazily). The serialized line items in
-- `items` are immutable once the offer is created — re-issuing means a new
-- row, never an update.
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  offer_number text,                         -- human-readable, populated by trigger
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','rejected','expired')),
  currency text not null default 'EUR',
  discount_amount numeric(12,2) not null default 0,
  vat_percent numeric(5,2) not null default 0,
  validity_days int not null default 14,
  notes text,
  items jsonb not null default '[]'::jsonb,  -- frozen line items
  totals jsonb not null default '{}'::jsonb, -- subtotal/discount/taxable/vat/total
  pdf_path text,                             -- offers/<id>.pdf inside private bucket
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

-- offer_number generator: OFR-YYYYMM-####, scoped to the month
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

-- Read scope mirrors deals: admin + accounting see all, sales see only
-- offers tied to leads/deals they own or won.
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
```

- [ ] **Step 2: Push, regen types, verify**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
SUPABASE_ACCESS_TOKEN=<token> npm run types:gen
```

Verify the bucket exists:

```bash
curl -s -X POST .../database/query -d '{"query":"select id, name, public from storage.buckets where id=$$offer-pdfs$$;"}'
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260504000007_offers_table.sql src/types/supabase.ts
git commit -m "feat(offers): offers table, RLS, storage bucket, offer_number sequence"
```

---

## Task 5: Money helpers + tests

**Files:**
- Create: `src/lib/offers/types.ts`
- Create: `src/lib/offers/calculate.ts`
- Create: `src/lib/offers/calculate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/offers/calculate.test.ts
import { describe, it, expect } from 'vitest';
import { calculateTotals } from './calculate';
import type { OfferItem } from './types';

const item = (lineTotal: number): OfferItem => ({
  category: 'web_dev',
  itemId: 'x',
  label: 'X',
  description: '',
  unitPrice: lineTotal,
  qty: 1,
  lineTotal,
});

describe('calculateTotals', () => {
  it('sums line totals into subtotal', () => {
    const r = calculateTotals([item(100), item(200)], 0, 0);
    expect(r.subtotal).toBe(300);
    expect(r.total).toBe(300);
  });

  it('clamps discount to subtotal', () => {
    const r = calculateTotals([item(100)], 500, 0);
    expect(r.discountAmount).toBe(100);
    expect(r.taxable).toBe(0);
    expect(r.total).toBe(0);
  });

  it('applies VAT to the post-discount taxable', () => {
    const r = calculateTotals([item(100)], 0, 24);
    expect(r.vatAmount).toBeCloseTo(24);
    expect(r.total).toBeCloseTo(124);
  });

  it('rejects negative discount', () => {
    const r = calculateTotals([item(100)], -50, 0);
    expect(r.discountAmount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/lib/offers/calculate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + helpers**

```ts
// src/lib/offers/types.ts
export type OfferItem = {
  category: string;
  itemId: string;
  label: string;
  description: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
};

export type OfferTotals = {
  subtotal: number;
  discountAmount: number;
  taxable: number;
  vatAmount: number;
  total: number;
};
```

```ts
// src/lib/offers/calculate.ts
import type { OfferItem, OfferTotals } from './types';

export function calculateTotals(
  items: OfferItem[],
  discountAmount: number,
  vatPercent: number,
): OfferTotals {
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const effectiveDiscount = Math.min(Math.max(0, discountAmount), subtotal);
  const taxable = subtotal - effectiveDiscount;
  const vatAmount = taxable * (vatPercent / 100);
  return {
    subtotal,
    discountAmount: effectiveDiscount,
    taxable,
    vatAmount,
    total: taxable + vatAmount,
  };
}

export function formatEur(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(amount);
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/lib/offers/calculate.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offers
git commit -m "feat(offers): typed calculate helpers + unit tests"
```

---

## Task 6: Catalog hook + offer mutation hook

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Create: `src/features/offers/hooks/useOfferCatalog.ts`
- Create: `src/features/offers/hooks/useCreateOffer.ts`
- Create: `src/features/offers/hooks/useOffer.ts`
- Create: `src/features/offers/hooks/useOffersForLeadOrDeal.ts`

- [ ] **Step 1: Add query keys**

```ts
// In src/lib/queryKeys.ts, inside the queryKeys object:
offerCatalog: () => ['offer-catalog'] as const,
offer: (id: string) => ['offer', id] as const,
offersForLead: (leadId: string) => ['offers', 'lead', leadId] as const,
offersForDeal: (dealId: string) => ['offers', 'deal', dealId] as const,
```

- [ ] **Step 2: Catalog fetch hook**

```ts
// src/features/offers/hooks/useOfferCatalog.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CatalogSubpackage = {
  id: string;
  code: string;
  display_names: { en?: string; el?: string };
  description: string | null;
  price: number;
  sort_order: number;
};

export type CatalogPackage = {
  id: string;
  service_type: string;
  code: string;
  display_names: { en?: string; el?: string };
  description: string | null;
  subtitle: string | null;
  default_one_time_amount: number;
  default_monthly_amount: number;
  setup_fee: number;
  sort_order: number;
  subpackages: CatalogSubpackage[];
};

export function useOfferCatalog() {
  return useQuery({
    queryKey: queryKeys.offerCatalog(),
    queryFn: async (): Promise<CatalogPackage[]> => {
      const { data, error } = await supabase
        .from('service_packages')
        .select(
          'id, service_type, code, display_names, description, subtitle, default_one_time_amount, default_monthly_amount, setup_fee, sort_order, subpackages:service_subpackages(id, code, display_names, description, price, sort_order)',
        )
        .eq('archived', false)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CatalogPackage[];
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Single-offer fetch hook**

```ts
// src/features/offers/hooks/useOffer.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useOffer(offerId: string) {
  return useQuery({
    queryKey: queryKeys.offer(offerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('id', offerId)
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Not found');
      return data;
    },
    enabled: !!offerId,
  });
}
```

- [ ] **Step 4: Per-lead/per-deal list hook**

```ts
// src/features/offers/hooks/useOffersForLeadOrDeal.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useOffersForLead(leadId: string) {
  return useQuery({
    queryKey: queryKeys.offersForLead(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!leadId,
  });
}

export function useOffersForDeal(dealId: string) {
  return useQuery({
    queryKey: queryKeys.offersForDeal(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!dealId,
  });
}
```

- [ ] **Step 5: Create-offer mutation**

```ts
// src/features/offers/hooks/useCreateOffer.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { Sentry } from '@/lib/sentry';
import type { OfferItem, OfferTotals } from '@/lib/offers/types';

type Input = {
  lead_id?: string | null;
  deal_id?: string | null;
  client_id?: string | null;
  currency: string;
  discount_amount: number;
  vat_percent: number;
  validity_days: number;
  notes: string | null;
  items: OfferItem[];
  totals: OfferTotals;
};

export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Input): Promise<string> => {
      const { data, error } = await supabase
        .from('offers')
        .insert({
          lead_id: input.lead_id ?? null,
          deal_id: input.deal_id ?? null,
          client_id: input.client_id ?? null,
          status: 'draft',
          currency: input.currency,
          discount_amount: input.discount_amount,
          vat_percent: input.vat_percent,
          validity_days: input.validity_days,
          notes: input.notes,
          items: input.items as unknown as object[],
          totals: input.totals as unknown as object,
        })
        .select('id')
        .single();
      if (error || !data) {
        Sentry.captureException(error ?? new Error('insert returned no row'), {
          tags: { feature: 'offers', op: 'create' },
        });
        throw new Error(error?.message ?? 'Failed to create offer');
      }
      return data.id;
    },
    onSuccess: (_id, vars) => {
      void qc.invalidateQueries({ queryKey: ['offers'] });
      if (vars.lead_id)
        void qc.invalidateQueries({ queryKey: queryKeys.offersForLead(vars.lead_id) });
      if (vars.deal_id)
        void qc.invalidateQueries({ queryKey: queryKeys.offersForDeal(vars.deal_id) });
    },
  });
}
```

- [ ] **Step 6: Build check**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queryKeys.ts src/features/offers/hooks
git commit -m "feat(offers): catalog + offer query/mutation hooks with Sentry capture"
```

---

## Task 7: Offer builder UI

**Files:**
- Create: `src/features/offers/OfferBuilderPage.tsx`
- Create: `src/features/offers/OfferSummaryPanel.tsx`

This is the largest UI port. It mirrors `Offer_system-main/src/components/OfferBuilder.tsx` but reads from Supabase via `useOfferCatalog`, pre-fills client info from the lead it was launched against, and writes the offer via `useCreateOffer`.

- [ ] **Step 1: Build `OfferSummaryPanel.tsx`**

A read-only-with-edit-buttons table at the bottom of the builder showing every selected line item, qty, unit price, line total, plus the totals block (subtotal / discount / VAT / total). Mirror the columns of the existing accounting `PaymentsPanel`.

```tsx
// src/features/offers/OfferSummaryPanel.tsx
import { Button } from '@/components/ui/button';
import type { OfferItem } from '@/lib/offers/types';
import { calculateTotals, formatEur } from '@/lib/offers/calculate';

type Props = {
  items: OfferItem[];
  discountAmount: number;
  vatPercent: number;
  onRemove: (item: OfferItem) => void;
};

export function OfferSummaryPanel({ items, discountAmount, vatPercent, onRemove }: Props) {
  const totals = calculateTotals(items, discountAmount, vatPercent);
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No items selected yet.</p>;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-normal">Service</th>
            <th className="px-3 py-2 font-normal">Description</th>
            <th className="px-3 py-2 font-normal text-right">Qty</th>
            <th className="px-3 py-2 font-normal text-right">Unit</th>
            <th className="px-3 py-2 font-normal text-right">Total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={`${it.category}-${it.itemId}`} className="border-t">
              <td className="px-3 py-2">{it.label}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{it.description}</td>
              <td className="px-3 py-2 text-right">{it.qty}</td>
              <td className="px-3 py-2 text-right">{formatEur(it.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatEur(it.lineTotal)}</td>
              <td className="px-3 py-2">
                <Button size="sm" variant="link" onClick={() => onRemove(it)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 text-xs">
          <tr>
            <td colSpan={4} className="px-3 py-2 text-right font-medium">Subtotal</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatEur(totals.subtotal)}</td>
            <td />
          </tr>
          {totals.discountAmount > 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right">Discount</td>
              <td className="px-3 py-2 text-right tabular-nums">-{formatEur(totals.discountAmount)}</td>
              <td />
            </tr>
          )}
          {vatPercent > 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right">VAT ({vatPercent}%)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatEur(totals.vatAmount)}</td>
              <td />
            </tr>
          )}
          <tr className="border-t">
            <td colSpan={4} className="px-3 py-2 text-right font-bold">Total</td>
            <td className="px-3 py-2 text-right font-bold tabular-nums">{formatEur(totals.total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build `OfferBuilderPage.tsx`** (full file — see Step 4 below for the UI structure).

The page accepts `:leadId` from the route, fetches the lead, fetches the catalog, lets the user pick categories on the left (sidebar), see items in the middle (with sub-products expandable per item), see the summary at the bottom. The form has: client name (pre-filled), email (pre-filled), currency (default EUR), discount (€), VAT (%, default 24), validity (days, default 14), notes (textarea). Submit button: **Create offer** → calls `useCreateOffer` → on success navigate to `/offers/<id>`.

- [ ] **Step 3: Wire `OfferBuilderPage` to `useOfferCatalog`, `useCreateOffer`, `useLead`**, manage selection state with three Maps:
  - `selectedItems: Map<string, OfferItem>` keyed by `${service_type}-${code}`.
  - `selectedSubpackages: Map<string, Set<string>>` keyed the same way.
  - `customPriceByItem: Record<string, number>` for items with `default_*=0` (custom-priced).

When the user toggles an item: insert/remove from `selectedItems`, recompute `lineTotal = unitPrice + Σ selected subpackages' price`. The display label is `package.display_names[lang]`; the description is the full description from the catalog.

- [ ] **Step 4: Submit handler**

```ts
async function onSubmit() {
  const items: OfferItem[] = [...selectedItems.values()];
  const totals = calculateTotals(items, discountAmount, vatPercent);
  const offerId = await create.mutateAsync({
    lead_id: leadId,
    client_id: lead?.converted_client_id ?? null,
    deal_id: lead?.converted_deal_id ?? null,
    currency, discount_amount: discountAmount, vat_percent: vatPercent,
    validity_days: validityDays, notes: notes.trim() || null,
    items, totals,
  });
  navigate(`/offers/${offerId}`);
}
```

- [ ] **Step 5: Build check + commit**

```bash
npm run build
git add src/features/offers/OfferBuilderPage.tsx src/features/offers/OfferSummaryPanel.tsx
git commit -m "feat(offers): builder UI ported from offer-system, sourced from Supabase catalog"
```

---

## Task 8: Routes + Lead detail page button

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/features/leads/LeadDetailPage.tsx`
- Create: `src/features/offers/OffersTab.tsx`

- [ ] **Step 1: Add lazy routes**

```tsx
// In src/app/router.tsx, with the other lazyPage declarations:
const OfferBuilderPage = lazyPage(
  () => import('@/features/offers/OfferBuilderPage'),
  'OfferBuilderPage',
);
const OfferDetailPage = lazyPage(
  () => import('@/features/offers/OfferDetailPage'),
  'OfferDetailPage',
);
```

```tsx
// In the children of the ShellLayout outlet:
{ path: 'leads/:leadId/offers/new', element: <OfferBuilderPage /> },
{ path: 'offers/:offerId', element: <OfferDetailPage /> },
```

- [ ] **Step 2: Build `OffersTab.tsx`** — a list of offers for a lead/deal:

```tsx
import { Link } from 'react-router-dom';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/offers/calculate';
import { useOffersForLead, useOffersForDeal } from './hooks/useOffersForLeadOrDeal';

export function OffersTab({ leadId, dealId }: { leadId?: string; dealId?: string }) {
  const lead = useOffersForLead(leadId ?? '');
  const deal = useOffersForDeal(dealId ?? '');
  const offers = (leadId ? lead.data : deal.data) ?? [];
  if (offers.length === 0) return <p className="text-sm text-muted-foreground">No offers yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {offers.map((o) => (
        <li key={o.id} className="flex items-center justify-between px-4 py-2 text-sm">
          <div>
            <div className="font-medium">
              {o.offer_number ?? o.id.slice(0, 8)} · {o.status}
            </div>
            <div className="text-[11px] text-slate-500">
              {formatDate(o.created_at)} · {formatEur(Number((o.totals as { total: number }).total ?? 0))}
            </div>
          </div>
          <Link to={`/offers/${o.id}`} className="text-blue-600 underline text-xs">View →</Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Add the "Create offer" button + Offers tab on `LeadDetailPage`**

Find the existing tabs (`Overview`, `Comments`, etc.) and add an **Offers** tab. In the header (right side, next to existing buttons), add:

```tsx
<Button
  type="button"
  onClick={() => navigate(`/leads/${leadId}/offers/new`)}
  disabled={readOnly}
>
  Create offer
</Button>
```

The button is hidden when `readOnly` (already converted), since post-conversion offers come from the deal page.

- [ ] **Step 4: Add Offers tab on `DealDetailPage`** (read-only list — sales manages offers, accounting just sees them).

- [ ] **Step 5: Build check + commit**

```bash
npm run build
git add src/app/router.tsx src/features/leads/LeadDetailPage.tsx src/features/deals/DealDetailPage.tsx src/features/offers/OffersTab.tsx
git commit -m "feat(offers): Create offer button on lead, Offers tab on lead+deal"
```

---

## Task 9: Offer detail page

**Files:**
- Create: `src/features/offers/OfferDetailPage.tsx`
- Create: `src/features/offers/hooks/useUpdateOfferStatus.ts`

- [ ] **Step 1: Status update mutation**

```ts
// src/features/offers/hooks/useUpdateOfferStatus.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { Sentry } from '@/lib/sentry';

export function useUpdateOfferStatus(offerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired') => {
      const { error } = await supabase
        .from('offers')
        .update({ status, sent_at: status === 'sent' ? new Date().toISOString() : null })
        .eq('id', offerId);
      if (error) {
        Sentry.captureException(error, { tags: { feature: 'offers', op: 'status' } });
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.offer(offerId) });
      void qc.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}
```

- [ ] **Step 2: Build `OfferDetailPage`** — pulls the offer via `useOffer(offerId)`, renders:
- Header: `OFR-XXXXXX-NNNN`, status badge, created date, validity (created_at + validity_days).
- Body: client/company info card, line items table (read-only mirror of `OfferSummaryPanel`), totals.
- Right side: status select (draft/sent/accepted/rejected/expired), Download PDF button (hooked up in Task 12).

- [ ] **Step 3: Build check + commit**

```bash
npm run build
git add src/features/offers/OfferDetailPage.tsx src/features/offers/hooks/useUpdateOfferStatus.ts
git commit -m "feat(offers): offer detail page with status mutation"
```

---

## Task 10: Server-side PDF template

**Files:**
- Create: `api/_pdf-template.ts`

- [ ] **Step 1: Port the HTML template** from `Offer_system-main/src/templates/OfferPdfTemplate.astro` into a TypeScript function returning an HTML string. Same CSS, same layout. Inputs: a single `OfferRecord` object (the row from `offers` joined with client info).

```ts
// api/_pdf-template.ts
import type { OfferItem, OfferTotals } from '../src/lib/offers/types';

type Args = {
  offerId: string;
  offerNumber: string | null;
  clientName: string;
  companyName: string | null;
  email: string | null;
  currency: string;
  vatPercent: number;
  validityDays: number;
  notes: string | null;
  items: OfferItem[];
  totals: OfferTotals;
  createdAt: string;
};

export function renderOfferHtml(args: Args): string {
  const validUntil = new Date(args.createdAt);
  validUntil.setDate(validUntil.getDate() + args.validityDays);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" />
<style>
  /* CSS copied verbatim from OfferPdfTemplate.astro */
  ...
</style></head>
<body>
  <header>
    <h1>${args.companyName ?? args.clientName}</h1>
    <p>Offer ${args.offerNumber ?? args.offerId.slice(0, 8)}</p>
  </header>
  <!-- items table, totals, footer — direct copy of the template -->
</body></html>`;
}
```

- [ ] **Step 2: Commit the template**

```bash
git add api/_pdf-template.ts
git commit -m "feat(offers): port HTML template for offer PDFs"
```

---

## Task 11: Vercel serverless PDF endpoint

**Files:**
- Create: `api/offer-pdf.ts`
- Modify: `package.json` — add `puppeteer-core` and `@sparticuz/chromium` to deps, mirroring the offer-system's versions.
- Modify: `vercel.json` — set `functions: { "api/offer-pdf.ts": { "maxDuration": 60 } }`.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save puppeteer-core @sparticuz/chromium
```

- [ ] **Step 2: Add the function**

```ts
// api/offer-pdf.ts
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { renderOfferHtml } from './_pdf-template';

export const config = { maxDuration: 60 };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const offerId = url.searchParams.get('id');
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!offerId || !token) return new Response('missing', { status: 400 });

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  // Validate the user can read the offer (RLS enforces this).
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return new Response('unauthorized', { status: 401 });

  const { data: offer, error } = await supabase
    .from('offers').select('*').eq('id', offerId).single();
  if (error || !offer) return new Response(error?.message ?? 'not found', { status: 404 });

  const { data: client } = offer.client_id
    ? await supabase.from('clients').select('name, email').eq('id', offer.client_id).single()
    : { data: null };

  const html = renderOfferHtml({
    offerId: offer.id,
    offerNumber: offer.offer_number,
    clientName: client?.name ?? 'Client',
    companyName: client?.name ?? null,
    email: client?.email ?? null,
    currency: offer.currency,
    vatPercent: Number(offer.vat_percent),
    validityDays: offer.validity_days,
    notes: offer.notes,
    items: offer.items as any,
    totals: offer.totals as any,
    createdAt: offer.created_at,
  });

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    const path = `offers/${offer.id}.pdf`;
    await supabase.storage.from('offer-pdfs').upload(path, pdf, {
      contentType: 'application/pdf', upsert: true,
    });
    await supabase.from('offers').update({ pdf_path: path }).eq('id', offer.id);

    const { data: signed } = await supabase.storage.from('offer-pdfs')
      .createSignedUrl(path, 60 * 5);
    return new Response(JSON.stringify({ url: signed?.signedUrl }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Set Vercel env var** (manual)

```
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
```

Add via Vercel dashboard for production + preview.

- [ ] **Step 4: Update vercel.json**

```json
{
  "rewrites": [
    { "source": "/((?!assets/|api/|favicon\\.svg|icons\\.svg).*)", "destination": "/index.html" }
  ],
  "functions": { "api/offer-pdf.ts": { "maxDuration": 60 } }
}
```

- [ ] **Step 5: Commit**

```bash
git add api/offer-pdf.ts package.json package-lock.json vercel.json
git commit -m "feat(offers): vercel serverless PDF endpoint with chromium + puppeteer"
```

---

## Task 12: Wire Download PDF button

**Files:**
- Modify: `src/features/offers/OfferDetailPage.tsx`
- Create: `src/features/offers/hooks/useDownloadOfferPdf.ts`

- [ ] **Step 1: Hook**

```ts
// src/features/offers/hooks/useDownloadOfferPdf.ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Sentry } from '@/lib/sentry';

export function useDownloadOfferPdf() {
  return useMutation({
    mutationFn: async (offerId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/offer-pdf?id=${offerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = new Error(`PDF generation failed: ${res.status}`);
        Sentry.captureException(err, { tags: { feature: 'offers', op: 'pdf' } });
        throw err;
      }
      const { url } = (await res.json()) as { url: string };
      return url;
    },
  });
}
```

- [ ] **Step 2: Use the hook on `OfferDetailPage`**

```tsx
const download = useDownloadOfferPdf();

<Button onClick={async () => {
  const url = await download.mutateAsync(offer.id);
  window.open(url, '_blank', 'noopener');
}}>
  {download.isPending ? 'Generating…' : 'Download PDF'}
</Button>
```

- [ ] **Step 3: Test end-to-end** — open an offer, click Download PDF, confirm a new tab opens with the rendered PDF.

- [ ] **Step 4: Commit**

```bash
git add src/features/offers/OfferDetailPage.tsx src/features/offers/hooks/useDownloadOfferPdf.ts
git commit -m "feat(offers): Download PDF button calls serverless function and opens signed URL"
```

---

## Task 13: Sentry mutation wrapper + harden existing mutations

**Files:**
- Create: `src/lib/sentry/captureMutation.ts`
- Modify: every existing `useMutation` callsite (~20 files) — short, mechanical change.

- [ ] **Step 1: Generic helper**

```ts
// src/lib/sentry/captureMutation.ts
import { Sentry } from '@/lib/sentry';

type MutationFn<TIn, TOut> = (input: TIn) => Promise<TOut>;

/**
 * Wrap a mutationFn so any thrown error is captured to Sentry with
 * structured tags before re-throwing. Lets every useMutation report
 * silently-handled failures while keeping the existing alert/toast
 * behavior intact.
 */
export function captureMutation<TIn, TOut>(
  feature: string,
  op: string,
  fn: MutationFn<TIn, TOut>,
): MutationFn<TIn, TOut> {
  return async (input) => {
    try {
      return await fn(input);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature, op },
        extra: { input },
      });
      throw err;
    }
  };
}
```

- [ ] **Step 2: Wrap one mutation as the worked example**

```ts
// src/features/deals/hooks/useDealPayments.ts (top of useUpdateDealPayment)
mutationFn: captureMutation('deal_payments', 'update', async ({ id, patch }) => {
  const { error } = await supabase.from('deal_payments').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}),
```

- [ ] **Step 3: Sweep the rest** — use a single editor pass across `src/features/**/hooks/*.ts`. For each `useMutation({ mutationFn: ... })`:

```ts
// before
mutationFn: async (input) => { ... }
// after
mutationFn: captureMutation('<feature>', '<op>', async (input) => { ... })
```

`<feature>` = parent folder under `src/features/` (e.g. `'leads'`, `'deals'`, `'jobs'`). `<op>` = the action verb (`'create'`, `'update'`, `'archive'`, `'block'`, `'unblock'`, `'move_stage'`, etc.).

- [ ] **Step 4: Build check**

```bash
npm run build
```

- [ ] **Step 5: Smoke test** — open `/sentry-check`, click Break the world, confirm event lands. Trigger one harness'd mutation that's set to fail (block a non-existent job via dev-tools) and confirm a captured event with the right tags.

- [ ] **Step 6: Delete `SentryCheckPage`** (verification done)

```bash
rm src/app/routes/SentryCheckPage.tsx
# remove the route entry from src/app/router.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/sentry src/features src/app/router.tsx
git rm src/app/routes/SentryCheckPage.tsx
git commit -m "feat(sentry): captureMutation wrapper across every mutation; drop check page"
```

---

## Task 14: Final smoke + push

- [ ] **Step 1: Push migrations**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
```

- [ ] **Step 2: Push branch**

```bash
git push origin main
```

- [ ] **Step 3: Manual smoke**

1. Open a lead → click **Create offer** → builder opens with client name pre-filled.
2. Pick "Επαγγελματική Ιστοσελίδα" + the "Hosting απλό site" sub-product → summary updates → **Create offer**.
3. Land on the offer detail page → **Download PDF** → PDF opens in new tab with branded layout.
4. Switch status to "sent" → row updates immediately on the lead's Offers tab.
5. As admin, open `/admin/service-packages` → see ~20 packages across 6 service types. Edit a Local SEO price, refresh the offer builder → the new price shows up.
6. Sentry dashboard shows one or two test errors tagged `feature:offers`.

- [ ] **Step 4: Stop**

The plan is complete. Production state:
- Catalog migrated.
- Offer builder reachable from every lead.
- Offer rows stored in `public.offers`, PDFs in `offer-pdfs` bucket.
- Sentry captures all mutation failures with structured tags.
