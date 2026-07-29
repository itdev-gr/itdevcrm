# Franchise import completion — design

**Date:** 2026-07-29 · **Owner ask:** finish importing the ClickUp Franchise list (218 tasks) into CRM leads, 100% correct: clean the data, add Budget + Region as real lead fields, put all other info into SALES INFO, import each lead's ClickUp comments into the lead's comments area, and stamp each lead's CRM `created_at` with the ClickUp task-creation date (not the import date).

**Context:** 59/218 already imported on 07-29 (source='franchise', all info crammed into `notes`, `created_at` = import time). Remaining ~159 blocked: the ClickUp MCP connector hit its daily limit (resets ≈07-30 12:15 Athens). Owner supplied a CSV export (`/Users/marios/Downloads/901518303391w2xasgd.csv`).

## What the CSV does and doesn't contain (verified 07-29)

- 218 tasks: `Task ID`, `Task Name`, `Task Link`, `Date Created` (epoch ms) — authoritative id list, dates, names.
- `Comments`: real comment JSON (`text`, `by` = staff email, `date`) on **46 tasks** — enough for the comments requirement, no API needed.
- **Missing:** ALL custom fields — email, phones, Κεφάλαιο επένδυσης (budget), Περιοχή (region), Πότε θέλει να ξεκινήσει, Εμπειρία, Franchise Status. `Task Content` is template junk ("Franchize itdev-copy"/empty). `Status` is "sales" for all rows.
- ⇒ CSV alone cannot produce a correct import of the ~159; custom fields must come from the ClickUp API.

## Decisions (owner AFK at question time — ⭐ defaults chosen, CONFIRM before DB writes)

1. **Data source for the ~159:** ⭐ ClickUp personal API token (`pk_`, ClickUp → Settings → Apps) — 3 calls fetch all 218 with custom fields, finishes same-day. Fallback: MCP connector after the 07-30 12:15 reset (recipe in memory `franchise-clickup-import`). CSV-only rejected (incomplete data).
2. **SALES INFO** = `leads.additional_notes` (form label «Σημείωση πωλήσεων» / "Sales Note").
3. **Budget + Region:** two new nullable text columns `leads.budget`, `leads.region`, editable on the lead form for ALL leads (empty for non-franchise). No RLS change (row-level policies unaffected by new columns).
4. **The 59 already imported:** retrofit to the same shape (backdate `created_at`, split budget/region out of `notes`, move the rest to `additional_notes`, import their comments).

## Target row shape (all 218 franchise leads)

- `title` = task name; `email`/`phone` per the proven 07-29 recipe (regex-validated email, fallback Phone 2; phone = first of Phone/Phone 2/Secondary with ≥10 digits).
- `budget` = Κεφάλαιο επένδυσης value; `region` = Περιοχή value (raw text, cleaned of underscores/placeholder noise).
- `additional_notes` (SALES INFO) = remaining info block: Πότε θέλει να ξεκινήσει, Εμπειρία, ClickUp URL — Greek labels, one per line.
- `notes` = NULL (no longer the dumping ground; contact data lives in real fields).
- `created_at` = ClickUp `Date Created` (epoch ms → timestamptz). No trigger fires on created_at; franchise email guard (`enqueue_lead_email`) already blocks all automated email for source='franchise' (verified 0 enqueued on 07-29).
- `stage` from ClickUp "Franchise Status" custom field, same mapping as 07-29 (New Lead→new_lead, No Answer→no_answer, Working on it→working_on_it, Offer Sent→offer_sent, Hot→hot, Won→won, No Interested→not_interested, Dead End→dead_end; default new_lead). `source='franchise'`, `owner_user_id` NULL, `source_data` = full raw ClickUp extract (keyed by task id — the diff/idempotency key).

## Comments import (all 218, incl. the 59)

- CSV `Comments` JSON → `comments` rows: `parent_type='lead'`, `parent_id=<lead id>`, `body=text`, `created_at` = parsed comment date ("5/6/2026, 7:18:09 PM GMT+3" format), `author_id` = profile whose email matches `by` (e.g. tvogiatzi@itdev.gr is real staff).
- Unmatched author email → fallback `author_id` = admin (info@itdev.gr profile), body prefixed `[ClickUp: <original email>]` so attribution survives.
- Idempotent: skip when an identical (parent_id, body, created_at) comment exists. Inserts via service role (RLS bypass needed for backdated created_at + third-party author_id).

## Retrofit of the 59

- `created_at` ← `source_data->>'date_created'` (fallback: CSV date by task id).
- Parse the existing `notes` Greek block: Κεφάλαιο επένδυσης → `budget`, Περιοχή → `region`, remaining lines → `additional_notes`, then `notes` = NULL.
- Guarded one-shot SQL with backup table `public.leads_franchise_retrofit_backup_20260729` (id + prior notes/additional_notes/created_at; RLS enabled, zero policies) + rollback SQL documented in the plan.

## Dedupe rules (new inserts)

- Skip task ids already present in `leads.source_data->>'id'` (the 59).
- A row whose email/phone matches an EXISTING lead/client is NOT silently inserted or merged: report to owner (the 07-29 Πόπη Αρβύθη precedent — 1 such case known). No automated franchise emails ever (standing rule).

## Approaches considered

- **A (chosen): two-phase.** Phase 1 now: schema + form fields, CSV parse/diff, comments import for the 59, retrofit of the 59. Phase 2 when `pk_` token arrives (or MCP resets): fetch ~159 with custom fields, insert full rows + their comments. Nothing waits on ClickUp that doesn't have to.
- **B: all-at-once tomorrow via MCP.** Simpler sequencing, but everything idles until 12:15+ and burns MCP quota again (~160 heavy task fetches vs 3 API calls).
- **C: CSV-only now.** Rejected — no emails/phones/budget/region/status in the export; violates "100% σωστά".

## Verification

- Final count: franchise leads = 218 − (dup-skips reported to owner); 0 rows with source='franchise' and email enqueued; created_at distribution matches ClickUp dates (none = import day).
- Comments: inserted count ≈ CSV comment count (46 tasks) minus skips; spot-check 3 leads in the UI (author, date, text).
- Budget/region populated wherever ClickUp had values; spot-check 3 in the lead form.
- `npm run build` green (stricter than tsc); LeadForm unit-touched files' tests only (NEVER the full vitest suite — hits prod).
