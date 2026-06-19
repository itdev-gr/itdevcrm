# Lead CSV/Excel Import + Release-to-Unique-Lead — Design Spec

- **Date:** 2026-06-19
- **Status:** Approved design → build
- **Builds on:** [[project_lead_intake]] (every lead already routes to `lead_intake`)

## Goal

Let an admin import leads from a **CSV or Excel** file into the Lead Intake queue, run them through the same duplicate check as Meta leads, and review/Release them. Also change **Release** so reviewed leads land in the **Unique Lead** column (not New Lead).

## Flow

```
Meta lead  ┐
CSV/Excel  ┼─► lead_intake (dedup-checked, flagged)  ──Release──► Unique Lead column
import     ┘                                            ──Discard──► gone
```

## Components

### 1. Parser — `src/features/leads/leadImport.ts` (unit-tested)
- `parseLeadFile(file): Promise<ImportedLeadRow[]>` — lazy-imports SheetJS (`xlsx`), reads the first sheet of a `.csv`/`.xlsx` into row objects, then `mapRowsToLeads`.
- `mapRowsToLeads(raw: Record<string, unknown>[]): ImportedLeadRow[]` — **pure**, the tested core:
  - Maps each header to a field via case-insensitive alias table (English + Greek):
    - **name** ← name, full name, fullname, full_name, όνομα, ονοματεπώνυμο
    - **email** ← email, e-mail, mail, ηλεκτρονικό ταχυδρομείο
    - **phone** ← phone, phone number, tel, mobile, τηλέφωνο, κινητό
    - **company** ← company, company name, εταιρεία, επιχείρηση
    - **website** ← website, site, url, web, ιστοσελίδα
    - **notes** ← notes, note, comments, σημειώσεις, σχόλια
  - Builds `{ full_name, email, phone, company, website, notes, source_data }`; **unrecognized columns** are preserved in `source_data`.
  - Skips rows where name, email, **and** phone are all blank. Caps at **2000** rows (extra rows dropped with a warning count).
- `ImportedLeadRow = { full_name, email, phone, company, website, notes, source_data }`.

### 2. RPC `import_leads_to_intake(p_rows jsonb)` — new migration, admin-only, SECURITY DEFINER
For each element: split `full_name`, normalize phone (last-10), run `find_lead_duplicates(email, phone)`, insert into `lead_intake` with `source='import'`, `title='Imported lead'`, `matched_on` + `matches`. Returns `{ ok, imported, flagged }`. (Rows inserted earlier in the batch are `pending`, so intra-file duplicates are also flagged via the existing `'queued'` branch.)

### 3. Release → Unique Lead — same migration
- Update `release_lead_intake`: insert with `stage_id = unique_lead` (was `new_lead`), wrapped by `set_config('app.intake_release','on', true)`.
- Update `leads_enforce_stage_restriction`: allow the insert when `current_setting('app.intake_release', true) = 'on'`. This lets the **reviewed-release path** place leads into the mkifokeris-locked Unique Lead column **without** opening that column to manual admin drag-and-drop (the GUC is only set inside `release_lead_intake`).

### 4. Frontend
- `src/lib/rpc.ts`: `importLeadsToIntake(rows): Promise<{ok; imported; flagged} | {ok:false; errors}>` via loose `rpcCall`.
- `src/features/leads/hooks/useImportLeads.ts`: mutation; invalidates `['lead_intake']`.
- `LeadIntakePage.tsx`: **Import CSV/Excel** button (hidden file input, `accept=".csv,.xlsx"`), **Download template** link (client-side Blob CSV: `Name,Email,Phone,Company,Website,Notes`). On select → parse → inline banner "Found N leads — [Import] [Cancel]" → on Import call the hook → inline result "Imported N (M flagged as possible duplicates)". (No toast lib in repo → inline status.)

## Defaults / decisions
- Imported leads `source='import'` ⇒ on Release they go to Unique Lead but get **no welcome email** (the welcome trigger only fires for `manual`/`meta`).
- Admin-only (matches the rest of the intake page + RLS).
- Both `.csv` and `.xlsx` via one library (SheetJS, lazy-loaded to keep the main bundle small).

## Error handling
- Unreadable/zero-row file → inline error, no insert.
- Rows missing name+email+phone → skipped (counted).
- >2000 rows → first 2000 imported, surplus reported.

## Testing
- `leadImport.test.ts`: alias mapping (English + Greek), unknown columns → `source_data`, empty-row skip, row cap, name split.
- RPC: SQL verification with a small batch under a simulated admin (rows land in `lead_intake`, dedup flags correct, release lands in `unique_lead`).
- `LeadIntakePage`: existing tests stay green; light test that Import wiring calls the hook.

## Changes / Revert
- New migration `*_lead_import_and_release_unique.sql` (import RPC + release/enforce changes) with a ROLLBACK block (drop `import_leads_to_intake`; restore `release_lead_intake` to new_lead; restore `leads_enforce_stage_restriction` without the GUC branch).
- Revert the frontend commits (parser, hook, rpc wrapper, UI) + remove `xlsx` dep.
