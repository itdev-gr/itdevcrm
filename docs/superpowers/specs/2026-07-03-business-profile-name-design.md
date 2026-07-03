# Business Profile Name — Lead → Deal → Local SEO Job + Card Title (Design)

**Date:** 2026-07-03
**Status:** Approved (design) — ready for implementation plan
**Scope:** 1 DB migration (2 columns + convert RPC + 2 new triggers) + frontend (lead
form, deal page, kanban card title helper, types, i18n).

## Goal

A **Business Profile Name** (the Google Business Profile's display name) can be added
by **sales** (lead form + deal page), **accounting** (deal page), and **technical**
(the existing "Business profile" field on the Local SEO job Info tab). On the Local
SEO kanban, a card whose job has a Business profile value shows it as the **card
title**; the contact/client name moves into the subtitle.

Mirror of the Business Profile URL feature
(`docs/superpowers/specs/2026-06-26-business-profile-url-design.md`), with one
addition: a late-add sync (deal → job, only-when-empty).

## Data model (one migration)

Two new nullable text columns:

- `leads.business_profile_name`
- `deals.business_profile_name`

`business_profile_name` maps to the **existing** Local SEO Info field
`business_profile` ("Business profile", free text in `jobs.details`) — no new job
field. Jobs where technical already typed a Business profile by hand get the new card
title immediately; their values are never overwritten.

## Who edits where (all three groups)

- **Sales:** lead form (Company section, next to Business Profile URL) +
  deal page Notes area. `deals_update` RLS already allows sales edit.
- **Accounting:** the same deal page Notes area field — `deals_update` RLS already
  includes `accounting_onboarding` edit/move_stage and `accounting_recurring` edit.
  No permission changes needed.
- **Technical:** the existing "Business profile" field on the local_seo (and AI SEO)
  job Info tab, saved via `useUpdateJobDetails` under jobs RLS. Already works today.

## 1. Lead form

`src/features/leads/LeadForm.tsx` — add a **"Business Profile Name"** (`type="text"`)
field immediately after the existing "Business Profile URL" field. It joins the
existing `patch` object and auto-saves to `leads.business_profile_name` via the
existing `useAutoSave` + update path. Greek label: "Όνομα Προφίλ Επιχείρησης".

## 2. Conversion (convert_lead_to_client)

New migration `create or replace function public.convert_lead_to_client(...)` copying
the **current live body** (the 2026-07-02 `cash_charge_vat` version — NOT the June
one) and adding `business_profile_name` to the deals insert column list + values
(`l.business_profile_name`). The executor must verify the live body via
`pg_get_functiondef` before applying (prod fn bodies drift).

## 3. Deal page (editable, sales + accounting)

`src/features/deals/DealNotesArea.tsx` — add the field next to the existing Business
Profile URL input (same `patch` + `useAutoSave` + direct `deals` update). Rendered
un-gated on the deal page; RLS governs who can save (sales, accounting, admins).

## 4. Local SEO job seeding — new BEFORE INSERT trigger on `jobs`

Follow the repo's one-seed-concern-per-trigger pattern (`jobs_seed_web_website`):
a **new** trigger fn, leaving `jobs_seed_local_profile_url` untouched:

```sql
create or replace function public.jobs_seed_local_business_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.service_type = 'local_seo'
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'business_profile','')), '') is null then
    select nullif(trim(coalesce(business_profile_name,'')), '')
      into v_name from public.deals where id = new.deal_id;
    if v_name is not null then
      new.details := coalesce(new.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', v_name);
    end if;
  end if;
  return new;
end $$;
```

Covers every spawn path; the AI-SEO **local child** is `service_type='local_seo'`
with a `deal_id`, so it is covered automatically (same as the URL trigger).

## 5. Late-add sync — AFTER UPDATE trigger on `deals` (new vs URL feature)

If sales/accounting adds the name **after** the local_seo job exists, it flows to the
job so the card title appears — but **only when the job's field is still empty**
(never overwrites technical's manual value). One-way deal → job; job edits never
back-sync to the deal.

```sql
create or replace function public.deals_sync_business_profile_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(trim(coalesce(new.business_profile_name,'')), '') is not null
     and new.business_profile_name is distinct from old.business_profile_name then
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', trim(new.business_profile_name))
     where j.deal_id = new.id
       and j.service_type = 'local_seo'
       and not j.archived
       and nullif(trim(coalesce(j.details->>'business_profile','')), '') is null;
  end if;
  return new;
end $$;

create trigger deals_sync_business_profile_name
  after update of business_profile_name on public.deals
  for each row execute function public.deals_sync_business_profile_name();
```

## 6. Kanban card title

Extract the headline/subtitle computation from `JobsKanbanCard.tsx` into a pure
helper `src/features/jobs/jobCardTitle.ts` (TDD, vitest — pure function, no DB):

- If `service_type` ∈ {`local_seo`, `ai_seo`} and `details.business_profile` is
  non-empty (trimmed) → **headline = Business profile**; subtitle parts =
  [contact name, client name] (the card appends the industry label as today).
- Otherwise unchanged: headline = contact name → client name → deal title → "—";
  subtitle parts = [client name if a contact name exists].

AI-SEO cards render identically on the Web SEO board (same component) — the same job
looks the same everywhere. Board search needs no change: `jobSearch.ts` already
indexes `details.business_profile`.

## Error handling / edge cases

- No name anywhere → card unchanged, `details` gets no `business_profile` key.
- Whitespace-only values are treated as empty (trimmed) at every layer.
- Non-local services spawn unchanged; a `business_profile` key on other service
  types (shouldn't exist) is ignored by the title rule.
- Sync trigger only fires on a real value change to a non-empty value, only fills
  empty job fields, and skips archived jobs.

## Testing

- `jobCardTitle.test.ts` — TDD the title/subtitle rules (7+ cases).
- `npm run build` green (types + eslint; stricter than tsc --noEmit).
- Migration verify (MCP `execute_sql`, `begin…rollback`, test deals inserted with
  `archived = true` to dodge `deals_one_live_per_client`): seed-at-create,
  late-add sync fills empty job, sync never overwrites a non-empty job value.
- Live smoke after deploy: lead → name autosaves → convert → deal shows it →
  Paid In Full → local_seo job Info "Business profile" pre-filled → kanban card
  titled by it; then clean up test rows.

## Changes / Revert

Files:

- migration `supabase/migrations/20260703120000_business_profile_name.sql`
  (2 columns + convert_lead_to_client replace + `jobs_seed_local_business_profile`
  trigger + `deals_sync_business_profile_name` trigger) — rollback SQL at bottom
  (drop triggers+fns; drop columns; restore prior convert body = the
  `cash_charge_vat` version).
- `src/types/supabase.ts` (leads + deals column types, hand-added)
- `src/features/jobs/jobCardTitle.ts` (new) + `jobCardTitle.test.ts` (new)
- `src/features/jobs/JobsKanbanCard.tsx` (use the helper)
- `src/features/leads/LeadForm.tsx` + `src/i18n/locales/{en,el}/leads.json`
- `src/features/deals/DealNotesArea.tsx` + `src/i18n/locales/{en,el}/deals.json`

Revert: revert the commits; run the migration's rollback block.

## Out of scope (YAGNI)

- Backfilling existing leads/deals (sales never captured the name before).
- Job → deal back-sync; overwriting non-empty job values.
- Leads table editor, CSV import/export, Meta-lead API (URL parity).
- Client record; accounting kanban card display changes.
