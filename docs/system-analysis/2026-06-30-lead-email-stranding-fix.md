# Lead Ingestion — Missing-Email Bug & Robustness Fix

**Date:** 2026-06-30
**Question:** Why do some website leads land with no email? How do we stop it for good?

---

## Findings

### The pattern

Some leads (mostly historical, almost gone today) land in `leads`/`lead_intake` with `email = NULL` even though the email is sitting **right there** in `source_data` JSONB under a non-standard key. Three real examples on prod:

```
1. lead_intake row, status=released, source=import, email=NULL
   source_data: { "Φόρμα": "🌐 WEBSITE LEAD FORM — ITDEV-copy",
                  "Διεύθυνση email": "kyranak30@gmail.com", … }

2. leads row 56ea76b9, source=meta, email=NULL
   source_data: { "COL$P": "katreensclothes@gmail.com",
                  "COL$O": "p:+306974784529", … }

3. lead_intake row, status=merged, source=import, email=NULL
   source_data: { "Φόρμα": "ITDEV SALE WHATEVER",
                  "Διεύθυνση email": "vassoula1992@gmail.com", … }
```

### Why it happens

Each ingestion path extracts email by hand-coded **alias lists** (CSV import) or a **regex on key names** (Meta webhook). When a new form, locale, or column label appears, the path doesn't recognize the key, drops the value into `source_data`, and leaves the `email` column NULL.

Concrete:
- `src/features/leads/leadImport.ts:22` — alias list includes `'email'`, `'διεύθυνση email'`, etc. Greek aliases were added 2026-06-24 (commit 5020377). Anything OUTSIDE the list strands.
- `api/meta-lead.ts:160` — non-columnar fallback regex is `/email/i` on KEY names. A Greek label like "Ηλεκτρονικό Ταχυδρομείο" doesn't contain "email" → no match → strands.
- `release_lead_intake` (`supabase/migrations/20260622200000_…sql:68-75`) just copies `r.email` verbatim — no rescue scan of `source_data`. If intake row was stranded, the released lead is stranded too.

### Current blast radius (live, 2026-06-30)

| Population | Count | Recoverable via source_data scan |
| --- | --- | --- |
| Leads with NULL email | 44 | 1 (Meta lead 56ea76b9) |
| lead_intake (released) with NULL email | 24 | 24 |
| lead_intake (merged) with NULL email | 565 | (not surveyed — merge appends to notes, low impact) |
| lead_intake (discarded) with NULL email | 338 | (discarded, no action needed) |
| New arrivals 2026-06-25 onwards | 0 stranded | n/a (alias fix worked) |

So today's damage is **1 leads-table row** + 24 intake rows whose release already happened correctly (they don't actually need fixing since the lead has the email).

### Architectural verdict

The 06-24 alias-list fix worked, but the system is **fragile by design** — every ingestion path maintains its own per-form alias list. A new form template, a new locale, a new vendor → silent stranding. Memory `reference_lead_dedup_stranding` already documents two prior rounds of the same bug. The third round is a matter of when, not if.

---

## Fix: Defense-in-depth at the DB layer

Instead of chasing alias lists per path, add a single safety net the DB enforces no matter who's inserting:

### Layer 1 — `first_email_in_jsonb(jsonb)` SQL helper

A recursive function that walks the JSONB and returns the first value matching an email regex. Same for `first_phone_in_jsonb(jsonb)` (anchored to phones with 8+ digits or starting with `+`).

### Layer 2 — BEFORE INSERT/UPDATE triggers on `lead_intake` and `leads`

When `NEW.email` is null/empty, set it to `first_email_in_jsonb(NEW.source_data)`. Same for phone. Never overwrites a value the caller provided — only fills holes.

Effect: every ingestion path (CSV, Meta webhook, manual UI, RPC, future paths) is automatically protected. No alias list to maintain.

### Layer 3 — One-shot backfill

For the existing stranded rows (1 leads row + 24 intake rows), pull the email from source_data. Backup table saves the pre-state for rollback.

### Layer 4 (NOT shipped — out of scope for "robust", overkill)

I considered adding:
- A daily admin "lead intake health" widget that flags any future strandings.
- A UI display fallback that shows the source_data email when the column is null.

Both are belt-and-braces on top of Layer 2 — pointless once the trigger catches every case.

---

## Migration

See `supabase/migrations/20260630010000_lead_intake_email_extractor.sql`. Summary:

```sql
-- 1) Helpers (recursive, immutable)
create or replace function public.first_email_in_jsonb(p jsonb) returns text …
create or replace function public.first_phone_in_jsonb(p jsonb) returns text …

-- 2) Pre-write triggers on lead_intake + leads
create or replace function public.fill_contact_from_source_data() returns trigger …
create trigger lead_intake_fill_contact before insert or update on public.lead_intake …
create trigger leads_fill_contact before insert or update on public.leads …

-- 3) Backfill + backup table
create table public.contact_backfill_backup_20260630 as …
update public.lead_intake set email = …
update public.leads set email = …
```

Rollback section is at the bottom of the migration file.

---

## What this does NOT do

- Does **not** change the parsers in `leadImport.ts` or `api/meta-lead.ts`. They keep doing their thing; the trigger is a safety net underneath them, not a replacement.
- Does **not** auto-merge duplicates created by previously-stranded rows. Those (if any) need manual cleanup via the existing lead intake merge tool.
- Does **not** touch `discarded` intake rows (no point).
- Does **not** introduce a UI fallback or admin widget (Layer 4 — overkill given the trigger covers the underlying gap).

## Trust footnote

I confirmed via live `pg_proc`/data queries that the prior 06-24 fix is working (zero new strandings since 06-25), and that the residual leads-table damage is exactly 1 row. The trigger pattern is the durable answer regardless of how many stranded historical rows remain.
