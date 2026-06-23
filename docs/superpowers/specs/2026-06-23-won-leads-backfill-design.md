# Won Leads from Accounting Deals — Backfill + Keep-Visible — Design

Date: 2026-06-23
Status: Draft for approval
Area: sales leads ↔ accounting deals

## Problem

Leads that "won" in the old CRM were migrated straight into `deals` (accounting), with **no corresponding lead** in the new CRM. So the sales **Won** column shows only 3 leads while there are **473 active accounting deals**. The product owner cannot locate won customers in sales, and there is no lead↔deal trace to check for duplicates. Separately, when a lead *is* converted today it vanishes from the `/sales/leads` table (the list hides `converted_at IS NOT NULL`), so won leads feel "discarded."

## Current behaviour (verified)

- `convert_lead_to_client(lead_id)` RPC: creates a client + deal, sets `leads.converted_at`, `leads.converted_client_id`, `leads.converted_deal_id`, and moves the lead to the **Won** stage (`pipeline_stages.code='won'`, board `sales`). Lead and deal share the same `code`. The lead is **kept** (not deleted/archived).
- `/sales/leads` list (`useLeads`) hides converted leads by default via `.is('converted_at', null)` (unless `includeConverted` is passed). The sales **kanban** Won column (`useColumnLeads`) does **not** filter converted, so converted leads already show there.
- Data today: 479 deals (473 active, all have `accounting_stage_id`). Of 473 active deals, **3** have a linked lead, **470** have none; **0** of the 470 match any existing active lead by email/phone or by code. Leads: 4,344 total (9 converted, 147 archived); only 3 in the Won stage.

## Decisions (from brainstorming)

1. **Backfill** — create one Won lead per active accounting deal that has no linked lead (~470), built from the deal + its client, linked back. Dedup-aware.
2. **Keep won visible** — won/converted leads always show in the Won kanban column (already do); add an opt-in "include won/converted" toggle to the `/sales/leads` table (off by default).
3. **Dedup track** — rely on the existing link (`leads.converted_deal_id` + shared `code` + email/phone) + the existing lead-intake dedup. No new warning UI.
4. **HARD CONSTRAINT — no new accounting entries.** The backfill inserts/updates **only `leads` rows**. It creates **zero** new rows in `deals`, `clients`, `jobs`, `payments`, or any accounting table. Each backfilled lead links to the **existing** deal/client and is created already-converted so no conversion/automation runs.

## Design

### Part A — Backfill Won leads (one per deal)

A single, idempotent, dedup-aware SQL migration (applied to prod via the Management API after approval). For every **non-archived** deal `d` with `not exists (select 1 from leads l where l.converted_deal_id = d.id)`:

1. **Try to reuse an existing lead (avoid duplicates).** Look for a non-archived, non-converted lead matching `d`'s client by normalised email or phone.
   - Exactly one match → **move/link it**: set `stage_id = won`, `converted_at`, `converted_deal_id = d.id`, `converted_client_id = d.client_id` (no new row).
   - Zero matches → **create** a new Won lead (the common case — 470/470 today).
   - Two or more matches → **skip** and record in the run report for manual handling (don't guess).
2. **Create path** — insert a `leads` row from the deal + client:
   - `code = d.code` (shared code; deal codes don't collide with existing lead codes — verified 0 matches).
   - `stage_id` = Won stage id.
   - `converted_at = coalesce(d.actual_close_date, d.invoiced_date, d.created_at)` (historical won date).
   - `converted_deal_id = d.id`, `converted_client_id = d.client_id`.
   - Contact from the client: `company_name`, `contact_first_name`, `contact_last_name`, `email`, `phone`, `phone_normalized`, `address`, `industry`, `country`, `vat_number`, `website`.
   - `title = d.title`; `estimated_one_time_value`/`estimated_monthly_value` from the deal; `owner_user_id = coalesce(d.won_by_user_id, d.owner_user_id)`; `won_by_user_id = d.won_by_user_id`.
   - `source` = a value allowed by the live `leads.source` CHECK constraint (the plan reads the constraint first; likely reuse the same value migrated deals used, or `'import'`). Backfilled rows are identified/reverted via the backup table of inserted ids — not via a custom source value. `archived = false`; all other NOT-NULL columns satisfied with table defaults / sensible values (the plan enumerates the exact column list from the live schema).
3. **No accounting side effects.** Because `converted_at`/`converted_deal_id` are pre-set and the row goes straight to Won, the `convert_lead_to_client` RPC is never invoked. The plan first **audits every trigger on `public.leads`** (INSERT/UPDATE) and confirms none create deals/clients/jobs/payments or fire emails/distribution for a Won-stage, already-converted row; if any would, the backfill sets the relevant guard (e.g. `automations_enabled = false`) or runs with the automation GUC off.

**Idempotency & safety:** re-running skips deals already linked. Every inserted lead id (and any moved lead's prior `stage_id`/`converted_*`) is captured in a backup table `leads_won_backfill_backup_20260623`, which is the authoritative record for identification and rollback. Rollback = delete the created rows and restore moved rows from the backup (SQL included in the migration).

### Part B — Keep won/converted leads visible (going forward)

- **Kanban:** no change — the Won column already lists converted leads.
- **Leads list:** `useLeads` already accepts `includeConverted`. Add a small **"Include won/converted"** toggle to the `/sales/leads` table UI that flips it (default off). When on, converted/won leads appear (with their existing Won badge / converted indicator). This makes them locatable without cluttering the default working list.
- **No change to the conversion RPC** — converting already keeps the lead in Won and sets the link, which is exactly "not discarded."

### Part C — Dedup track

- The link (`leads.converted_deal_id`, shared `code`, email/phone on the won lead) is the track. The backfill populates it for all ~470 deals, so every won customer is now represented by a linked Won lead.
- The existing lead-intake dedup already checks incoming leads against won clients/deals, so new duplicates of a won customer are flagged. No new feature.

## Components / files

- New migration `supabase/migrations/20260623xxxxxx_backfill_won_leads_from_deals.sql` (backup table + backfill + rollback SQL). Applied to prod via Management API after approval (no new accounting rows).
- Frontend: `/sales/leads` page — add the "Include won/converted" toggle wired to `useLeads({ includeConverted })` (the hook already supports it). Small UI change + a unit test for the toggle.
- A pre-flight verification script (read-only) that lists `leads` triggers and confirms no accounting cascade, plus post-run counts.

## Testing / verification

- **Pre-flight (read-only):** enumerate triggers on `public.leads`; confirm none create accounting rows for a Won/converted insert. Snapshot counts of `deals`, `clients`, `jobs`, `payments`.
- **Backfill verify:** after running, assert deals/clients/jobs/payments counts are **unchanged**; Won-stage lead count ≈ prior + created; every active deal now has a linked lead; spot-check 5 created leads link to the right deal/client and carry the right code/contact.
- **Frontend:** unit test that the leads list toggle passes `includeConverted` and that converted leads appear only when on.
- **Live smoke:** `/sales/kanban` Won column shows the won leads; `/sales/leads` toggle reveals them; a deal's client matches its won lead by code.

## Non-goals

- No active duplicate-warning UI (option not chosen).
- No change to `convert_lead_to_client`, to `deals`/accounting, or to the dashboard Won metric (which counts deals, not leads — unaffected).
- One Won lead **per deal** (a client with N deals gets N won leads, each a distinct sale distinguished by `converted_deal_id`) — not deduped per client.

## Changes / Revert

- **DB:** the migration creates only `leads` rows (+ a backup table). Rollback SQL: delete the lead rows whose ids are in `leads_won_backfill_backup_20260623`, and restore any moved leads' prior `stage_id`/`converted_*` from the same table. **No accounting rows are created, so nothing to revert there.**
- **Frontend:** revert the leads-list toggle commit. No other UI touched.
- Backups: `leads_won_backfill_backup_20260623`.
