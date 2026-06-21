# Lead Intake — Merge Duplicate Leads (design)

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Author:** Marios + Claude

## Problem

When a new lead arrives (Meta webhook or CSV/Excel import) it lands in the
admin-only **Lead Intake** queue (`/sales/lead-intake`). If it matches an
existing record by email or phone, the row is flagged as a **duplicate**.

Today the admin has only two choices per row:

- **Release** → creates a brand-new lead in the *Unique Lead* stage.
- **Discard** → throws the row away (audit record kept).

Neither preserves the *new* information (which campaign it came from, the form
answers the person gave) **onto the lead that already exists**. The user wants a
third option that **adds** the new info to the existing lead **without
overwriting anything**, plus an automatic toggle that does this for the
obvious cases — mirroring the existing auto-distribute toggle.

## Goal

Add a **Merge** action to the Lead Intake page that appends the new lead's info
to a matched existing **pipeline lead**, never overwriting existing data, and an
**auto-merge toggle** that merges the unambiguous cases automatically.

## Scope (decisions locked with the user)

1. **Match target:** pipeline **leads only** for v1. If a row matches *only* an
   already-signed customer (deal-client) and no pipeline lead, the Merge button
   is disabled — handled manually. (Deal-client merging is explicitly out of
   scope for this version.)
2. **Never overwrite:** the merge only ever **appends** a dated block to a new
   text field on the lead. It never changes the lead's name, phone, email,
   notes, stage, owner, or any other existing field.
3. **Two matches → admin picks:** if a row matches more than one pipeline lead,
   the Merge button lets the admin choose which lead to merge into.
4. **Auto-merge is cautious:** when the toggle is ON, a new intake row is
   auto-merged **only when it matches exactly one pipeline lead**. Anything
   ambiguous (zero matches, two+ lead matches, or customer-only matches) stays
   `pending` in the queue for manual review.

## Background — how the relevant code works today

- **Intake table** `public.lead_intake`
  (`supabase/migrations/20260619160000_lead_intake.sql`): columns include
  `status` (`pending|released|discarded`), `source` (`meta|import`),
  `source_data jsonb` (raw payload / form answers / extra import columns),
  `title` (campaign or form name), `contact_info`, `email`, `phone`,
  `phone_normalized`, `matched_on text[]`, `matches jsonb`, `reviewed_by`,
  `reviewed_at`, `released_lead_id`.
- **Duplicate detection** `find_lead_duplicates(p_email, p_phone)`
  (`supabase/migrations/20260619200000_find_lead_duplicates_matched_contact.sql`)
  returns rows with `match_type` (`lead|deal_client|queued`), `record_id`,
  `display_name`, `context`, `matched_field`, `matched_email`, `matched_phone`.
  Results are stored in `lead_intake.matches` (JSONB array) at insert time by
  both the Meta webhook (`api/meta-lead.ts`) and the `import_leads_to_intake`
  RPC. A lead that matches on both email and phone produces a **single** match
  entry, so counting `match_type = 'lead'` entries counts distinct leads.
- **Release RPC** `release_lead_intake(p_id)`
  (`supabase/migrations/20260619190000_lead_import_and_release_unique.sql`):
  admin-only, `security definer`, uses the `app.intake_release` GUC to bypass
  the Unique-Lead stage restriction, then inserts a new lead and marks the
  intake row `released`.
- **Discard RPC** `discard_lead_intake(p_id)`: admin-only, marks row
  `discarded`.
- **Intake UI** `src/features/leads/LeadIntakePage.tsx`: admin-only page,
  renders pending rows + Release/Discard buttons (hooks
  `useReleaseLeadIntake`, `useDiscardLeadIntake`). RPC wrappers live in
  `src/lib/rpc.ts`.
- **Auto-distribute toggle** (pattern we mirror): singleton table
  `public.lead_distribution_state` (`id = true`, `auto_enabled boolean`)
  in `supabase/migrations/20260616124457_lead_distribution.sql`; read/write hook
  `src/features/leads/hooks/useLeadDistribution.ts`; behaviour driven by a
  `before insert` trigger on `leads` (`leads_auto_distribute`).
- **Leads table** `public.leads` (`supabase/migrations/20260502000017_leads_table.sql`
  + later): has `notes`, `additional_notes`, `contact_info` free-text columns
  already. We add a new dedicated column rather than reuse these (keeps merged
  campaign data separate from sales-written notes).
- **supabase-js binding gotcha** (`reference_supabase_from_binding`): when
  capturing `from`/`rpc` into a const, always `.bind(supabase)`, or the call
  silently no-ops.

## Design

### Data model changes

1. **New column on `leads`:** `intake_log text` (nullable). Append-only store
   for merged duplicate info. Displayed read-only on the lead detail view.

2. **New intake status `merged`:** extend the `lead_intake.status` check
   constraint to `('pending','released','discarded','merged')`.

3. **New column on `lead_intake`:** `merged_into_lead_id uuid references
   public.leads(id) on delete set null` — points at the lead the row was merged
   into (audit trail, parallel to `released_lead_id`).

4. **New toggle column:** `lead_distribution_state.auto_merge_enabled boolean
   not null default false` (reuses the existing admin-only singleton table).

### The appended block — `format_intake_merge_block(r lead_intake) → text`

A `stable security definer` helper that builds the human-readable block from an
intake row:

```
--- 21/06/2026 · Excel/CSV import ---
Campaign / form: Spring Promo - Web Design
Notes: <contact_info, if any>
Budget?: 2000-5000€
When?: ASAP
```

Rules:
- Header line: `--- <DD/MM/YYYY of created_at> · <source label> ---`
  (`meta` → "Meta lead", `import` → "Excel/CSV import").
- `Campaign / form: <title>` if `title` is non-empty.
- `Notes: <contact_info>` if non-empty.
- Then every key/value from `source_data` (via `jsonb_each_text`), **skipping**
  known Meta system keys that add noise:
  `leadgen_id, form_id, form_name, campaign_id, ad_id, adset_id, platform,
  is_organic, created_time`.

### Manual merge — `merge_lead_intake(p_id uuid, p_target_lead_id uuid) → jsonb`

`security definer`, admin-only. Steps:
1. Reject if not admin → `{ok:false, errors:['not_authorized']}`.
2. Load the intake row; reject if missing / not `pending`
   (`already_<status>`).
3. **Safety:** confirm `p_target_lead_id` is present in `matches` as a
   `match_type = 'lead'` entry → else `target_not_a_match`.
4. Confirm the target lead still exists → else `target_lead_missing`.
5. Build the block via `format_intake_merge_block`, append to the target lead's
   `intake_log` (newline-separated; if currently empty, just the block). Touch
   `leads.updated_at`. **No other lead field is modified.**
6. Mark the intake row: `status='merged'`, `merged_into_lead_id=target`,
   `reviewed_by=auth.uid()`, `reviewed_at=now()`.
7. Return `{ok:true, lead_id:target}`.

### Auto-merge — `before insert` trigger on `lead_intake`

Function `lead_intake_auto_merge()` (`security definer`):
1. If `NEW.status <> 'pending'` → return NEW unchanged.
2. Read `auto_merge_enabled` from `lead_distribution_state`; if off → return NEW.
3. Filter `NEW.matches` to `match_type = 'lead'` entries. If the count is **not
   exactly 1** → return NEW (leave it pending).
4. Target = that one match's `record_id`. If the lead no longer exists → return
   NEW.
5. Append the block to the target lead's `intake_log` (same logic as manual).
6. Set on the NEW row (before it lands): `status='merged'`,
   `merged_into_lead_id=target`, `reviewed_at=now()` (`reviewed_by` stays NULL →
   shows as System, consistent with `reference_activity_log`).

Because `matches` is computed and included in the INSERT values by the webhook /
import RPC, `NEW.matches` is available in a `before insert` trigger. Using
`before insert` means auto-merged rows never appear as `pending` in the queue.

### Frontend changes

- **`src/lib/rpc.ts`:** add `mergeLeadIntake(id, targetLeadId)` wrapper —
  `const rpc = supabase.rpc.bind(supabase)` style (binding gotcha).
- **Hook `useMergeLeadIntake()`** (`src/features/leads/hooks/`): mutation
  wrapper, invalidates the intake query and the leads query on success.
- **Hook `useAutoMerge()`** (`src/features/leads/hooks/`): read/write
  `auto_merge_enabled` on `lead_distribution_state`, mirroring
  `useLeadDistribution`.
- **`LeadIntakePage.tsx`:**
  - Add a **Merge** button per row. Compute `leadMatches = matches.filter(m =>
    m.match_type === 'lead')`.
    - 0 lead matches → button disabled (tooltip: customer-only / no lead match).
    - 1 lead match → click merges directly into it.
    - 2+ lead matches → click reveals a small inline chooser listing each
      matched lead (`display_name` + `context`); selecting one calls the RPC.
  - Add the **auto-merge toggle** checkbox in the page header (admin-only),
    styled like the auto-distribute toggle, wired to `useAutoMerge()`.
- **Lead detail view:** display `intake_log` read-only (labelled "New info from
  duplicates"), shown only when non-empty. Exact component pinned during
  planning.
- **i18n:** add label keys for the Merge button, the chooser, the toggle, and
  the lead-detail field.
- **Types:** regenerate / extend `src/types/supabase.ts` for the new columns and
  the `merged` status.

## Data flow

```
New lead (Meta webhook / import RPC)
  → find_lead_duplicates() → matches jsonb stored on insert
  → BEFORE INSERT trigger lead_intake_auto_merge:
       toggle ON + exactly 1 lead match? → append block, status='merged'
       else → status stays 'pending'
  → if pending: admin sees row on Lead Intake page
       Release  → new lead (existing)
       Discard  → discarded (existing)
       Merge    → merge_lead_intake(id, targetLeadId)
                    → append block to chosen lead.intake_log
                    → status='merged'
```

## Error handling

- All RPCs return `{ok:false, errors:[...]}` for: `not_authorized`, `not_found`,
  `already_<status>`, `target_not_a_match`, `target_lead_missing`.
- Auto-merge trigger fails safe: any non-ideal condition leaves the row
  `pending` (never errors the insert).
- Frontend surfaces RPC errors via the existing toast/error pattern used by
  Release/Discard.

## Testing

- **SQL (pgTAP / manual against a branch DB):**
  - `format_intake_merge_block` formats header, campaign, notes, and
    source_data answers, and skips the Meta system keys.
  - `merge_lead_intake` appends (does not overwrite) and is idempotent-guarded
    (second call on a merged row → `already_merged`).
  - `merge_lead_intake` rejects a non-admin, a non-matching target, a missing
    target.
  - Auto-merge trigger: 1 lead match + toggle ON → row inserted as `merged` with
    `intake_log` appended; 2 matches → stays `pending`; toggle OFF → stays
    `pending`.
- **Frontend (vitest + RTL):**
  - Merge button disabled with 0 lead matches; direct merge with 1; chooser with
    2+.
  - `useAutoMerge` reads and flips the toggle.

## Changes / Revert

**New objects (all additive):**
- `leads.intake_log` column
- `lead_intake.merged_into_lead_id` column + widened `status` check constraint
- `lead_distribution_state.auto_merge_enabled` column
- functions `format_intake_merge_block`, `merge_lead_intake`,
  `lead_intake_auto_merge`; trigger `lead_intake_auto_merge_trg`

**Rollback SQL:**
```sql
drop trigger if exists lead_intake_auto_merge_trg on public.lead_intake;
drop function if exists public.lead_intake_auto_merge();
drop function if exists public.merge_lead_intake(uuid, uuid);
drop function if exists public.format_intake_merge_block(public.lead_intake);
alter table public.lead_distribution_state drop column if exists auto_merge_enabled;
alter table public.lead_intake drop column if exists merged_into_lead_id;
alter table public.lead_intake drop constraint if exists lead_intake_status_check;
alter table public.lead_intake add constraint lead_intake_status_check
  check (status in ('pending','released','discarded'));
alter table public.leads drop column if exists intake_log;
```
(Frontend: revert the LeadIntakePage / rpc.ts / hooks / i18n commits.)

## Out of scope (v1)

- Merging into existing customers (deal-clients).
- Auto-picking among multiple matches.
- Editing / un-merging a merged block from the UI (it's plain appended text on
  the lead; sales can edit the field manually if ever needed — TBD whether the
  field is editable; default read-only).
```