# Lead Duplicate Intake — Design Spec

- **Date:** 2026-06-19
- **Status:** Approved design (pending spec review) → next: implementation plan
- **Owner:** Marios (product)

## 1. Context & Goal

Meta lead ads flow into the CRM through Zapier → `POST/GET /api/meta-lead?key=<META_LEAD_SECRET>`
(`api/meta-lead.ts`). Today every accepted lead is inserted straight into the `leads`
table, lands in the **Unique Lead** sales column, and immediately queues a welcome
email.

The agency receives the same person more than once (re-submitted forms, the same
phone across campaigns, people who are already customers). We want a **duplicate
guard** on the webhook so repeat contacts don't silently pollute the sales board or
get auto-emailed.

**Goal:** Every incoming Zapier lead is checked for a duplicate. Clean leads behave
exactly as today. Possible duplicates are held in a review queue where an authorised
user **Releases** them onto the board or **Discards** them.

### Non-goals (YAGNI)
- No fuzzy / name / company matching — **email and phone only**.
- No automatic merging of records — release or discard only.
- No interception of **manually-created** or **CSV-imported** leads — this rule runs
  on the Zapier webhook path only.
- No new notification channel beyond an in-app pending-count badge.

## 2. The Duplicate Rule

An incoming lead is a **duplicate** when its **email matches** OR its **normalized
phone matches** at least one of:

1. any existing **lead** (`leads`, any stage — the review screen shows the matched
   lead's stage for context), or
2. any **client that has ≥ 1 deal** (`clients` with an existing `deals` row).
   Clients with **no** deal are ignored (per product decision).

Matching details:
- **Email:** case-insensitive, trimmed; only when the incoming email is non-empty.
- **Phone:** normalized to the last 10 digits (`right(regexp_replace(phone,'[^0-9]','','g'),10)`),
  the same scheme used by `phone_normalized` and `find_contact_by_phone()`; only when
  the normalized value is exactly 10 digits.
- A lead with **neither** an email nor a usable phone has nothing to match → treated
  as **clean**.

## 3. Flow

```
Zapier ─► /api/meta-lead
            │  (existing field extraction + leadgen_id retry-dedup,
            │   now also checking the intake queue)
            ▼
        find_lead_duplicates(email, phone)
            ├─ no match ─► INSERT into leads  ─► Unique Lead column
            │                                    (welcome email queues — unchanged)
            └─ match ────► INSERT into lead_intake (status='pending')
                              · NOT in leads, NO welcome email, NO round-robin
                              · stores what it matched
                                   │
                          Lead Intake review page
                              ├─ Release ► release_lead_intake() → INSERT into leads
                              │             → Unique Lead (welcome email queues now)
                              └─ Discard ► discard_lead_intake() → status='discarded'
                                            (kept as an audit row, never reaches board)
```

**Why a separate `lead_intake` table instead of a flag on `leads`:** inserting a
`source='meta'` row into `leads` fires `trg_leads_email_automations_ins` (queues the
welcome email) and `leads_auto_distribute_trg` (round-robin assignment). Holding
duplicates in their own table avoids emailing / assigning an unreviewed contact, and
keeps every existing `leads` query, RLS policy, and kanban count untouched.

## 4. Data Model

### 4.1 New table `lead_intake`
Mirrors the columns the webhook would have inserted into `leads`, plus review
metadata. One row per held duplicate.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `created_at` | timestamptz | `now()` |
| `status` | text | `'pending' \| 'released' \| 'discarded'`, default `'pending'`, CHECK |
| `source` | text | `'meta'` (default) |
| `source_data` | jsonb | raw Zapier payload (incl. `leadgen_id`) |
| `title` | text | form name / "Meta lead" |
| `contact_first_name` | text | |
| `contact_last_name` | text | |
| `email` | text | |
| `phone` | text | raw |
| `phone_normalized` | text | last-10-digit form, stored for matching/display |
| `website` | text | |
| `company_name` | text | |
| `contact_info` | text | custom-answer notes |
| `matched_on` | text[] | which fields hit, e.g. `{email}`, `{phone}`, `{email,phone}` |
| `matches` | jsonb | array of `{match_type, record_id, display_name, context, matched_field}` for display + linking |
| `reviewed_by` | uuid | profile/user who released/discarded (nullable) |
| `reviewed_at` | timestamptz | nullable |
| `released_lead_id` | uuid | FK → `leads.id`, set on release (nullable) |

Index: partial index on `status` for the pending list; index on `phone_normalized`
and `lower(email)` so the webhook can also dedup retries against the queue.

### 4.2 Function `find_lead_duplicates(p_email text, p_phone text)`
`STABLE SECURITY DEFINER`, returns a set of:
`(match_type text, record_id uuid, display_name text, context text, matched_field text)`

- `match_type ∈ {'lead','deal_client'}`
- Normalizes `p_phone` internally; ignores blank email / non-10-digit phone.
- `lead` branch: `leads` where email or `phone_normalized` matches; `context` = matched
  lead's stage display name.
- `deal_client` branch: `clients` where email or `phone_normalized` matches **and**
  `EXISTS (SELECT 1 FROM deals d WHERE d.client_id = clients.id)`; `context` = the
  client's deal code(s).
- `matched_field ∈ {'email','phone'}`.

This function is the single source of truth for "the rule" — called by the webhook and
re-callable from the review UI.

### 4.3 RPCs (both `SECURITY DEFINER`, authorisation-checked)
- `release_lead_intake(p_id uuid) → uuid` — verify caller authorised + row `pending`;
  `INSERT INTO leads (…)` from the intake row (this fires the normal default-stage +
  welcome-email path); set `status='released'`, `released_lead_id`, `reviewed_by=auth.uid()`,
  `reviewed_at=now()`; return new `lead_id`.
- `discard_lead_intake(p_id uuid) → void` — verify authorised + `pending`; set
  `status='discarded'`, `reviewed_by`, `reviewed_at`.
- Bulk wrappers accept `uuid[]` (release-all / discard-all) for the queue's bulk actions.

### 4.4 RLS
`lead_intake` RLS enabled. Authenticated `SELECT`/`UPDATE` permitted only for:
admins **OR** holders of the `sales/view_all` capability (sales manager `tvogiatzi`)
**OR** `mkifokeris@itdev.gr` — the same circle that controls the Unique Lead intake
column today (reuse the existing admin/capability helper used by leads-management RLS).
`INSERT` happens only via the service-role webhook (bypasses RLS); no client INSERT
policy.

## 5. API Change — `api/meta-lead.ts`

After the existing field extraction and **before** the current `leads` insert:

1. **Retry dedup (extended):** the existing `leadgen_id` lookup also checks
   `lead_intake` (so a Meta retry of an already-held duplicate returns `deduped`
   instead of creating a second intake row).
2. Call `find_lead_duplicates(email, phone)` (service-role RPC).
3. **No matches →** existing `leads` insert (unchanged response `{ ok, lead_id }`).
4. **Matches →** `INSERT INTO lead_intake` with `matched_on` + `matches`; respond
   `{ ok: true, held: true, intake_id }` (HTTP 200 so Zapier still sees success).

No change to auth, field extraction, or the clean-path behaviour.

## 6. Review UI — "Lead Intake"

- **New page/route** under the sales area (e.g. `/sales/lead-intake`), new component
  `LeadIntakePage.tsx` + `useLeadIntake` hook. Bilingual label (el/en), e.g.
  "Έλεγχος Διπλότυπων" / "Lead Intake".
- **List:** `lead_intake` where `status='pending'`, newest first. Each row shows
  name, email, phone, form/source, created time, and **match badges** built from
  `matches`, e.g. `📧 same email as lead «Χ» (Won)` / `📞 phone matches deal client
  «Υ» (000123)`, each linking to the matched lead (`/sales/leads/:id`) or client/deal.
- **Actions per row:** **Release ▸** and **Discard ✕**; plus checkbox bulk
  Release/Discard. Confirm on Discard.
- **Sidebar badge:** pending count next to the nav item (lightweight count query/RPC).
- **Access:** page guarded to the same roles as the RLS policy.

## 7. Edge Cases

- **No email & no usable phone →** clean (cannot match).
- **Two near-simultaneous submissions of the same person:** first goes clean → `leads`;
  the second matches it (now in `leads`) → intake. Acceptable; true race is rare.
- **Match only to a Won/Lost lead:** still held; the badge shows the stage so the
  reviewer can release knowingly (e.g. a genuine re-engagement).
- **Released lead then immediately re-submitted:** matches the just-released lead →
  held again. Expected.
- **Discarded rows are retained** (`status='discarded'`) for audit; they never enter
  `leads`.

## 8. Affected / New Files

- **Modify:** `api/meta-lead.ts` (dup check + intake branch + extended retry dedup).
- **New migration:** `supabase/migrations/<ts>_lead_intake.sql` — table, indexes,
  `find_lead_duplicates`, `release_lead_intake`, `discard_lead_intake` (+ bulk), RLS,
  rollback block.
- **New UI:** `src/features/leads/LeadIntakePage.tsx`, `src/features/leads/hooks/useLeadIntake.ts`.
- **Modify:** `src/lib/rpc.ts` (release/discard wrappers); app routes; sales sidebar nav.
- **Regenerate:** `src/types/supabase.ts` after the migration.

## 9. Testing Strategy (TDD)

- **`find_lead_duplicates`:** email-only match; phone-only match; both; no-match;
  deal-client matched only when a deal exists (client without a deal → no match);
  blank email / non-10-digit phone ignored.
- **Webhook routing:** clean payload → row in `leads`, none in `lead_intake`;
  duplicate payload → row in `lead_intake`, none in `leads`, no welcome email queued;
  `leadgen_id` retry of a held lead → `deduped`, no second intake row.
- **RPCs:** release inserts into `leads` + flips status + stamps reviewer; discard
  flips status without touching `leads`; unauthorised caller rejected.
- **UI:** queue renders match badges + links; release/discard (single + bulk) mutate
  and refresh; pending badge count.

## 10. Changes / Revert

All schema lives in one migration with a ROLLBACK block:
- `DROP TABLE lead_intake;` `DROP FUNCTION find_lead_duplicates, release_lead_intake,
  discard_lead_intake (+ bulk);`
- Revert the `api/meta-lead.ts` commit → webhook returns to direct-insert behaviour.
- Revert the UI commit → remove page, route, nav item, rpc wrappers.

No existing rows are modified by deploying this; the clean path is byte-for-byte the
current behaviour, so rollback is safe at any time. Held duplicates that were not yet
reviewed would simply stop being intercepted on rollback (future Zapier leads insert
directly again).

## 11. Open Questions

None blocking. Defaults confirmed: match leads in any stage; reviewers = admins +
sales manager (`tvogiatzi`) + `mkifokeris`; webhook-level rule (manual/CSV untouched).
