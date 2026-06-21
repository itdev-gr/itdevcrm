# Lead Merge — Dead-end rule + Bulk merge (design)

**Date:** 2026-06-22
**Status:** Approved (pending spec review)
**Author:** Marios + Claude
**Builds on:** [[project_lead_merge_duplicates]] — `docs/superpowers/specs/2026-06-21-lead-intake-merge-duplicates-design.md`

## Problem

Two follow-ups to the shipped "merge duplicate leads" feature:

1. **Dead-end targets shouldn't be merged.** If a new duplicate would merge into an
   existing lead that's already written off (stage **Dead End** or **Not Interested**),
   appending campaign/answer info is pointless. Instead the new incoming lead should just
   be **removed** (Discarded).
2. **Bulk merge.** Clearing duplicates one row at a time is slow. The admin wants one
   **"Bulk merge (N)"** button that merges every clear-cut duplicate at once, showing how
   many it will merge, and a confirmation step.

## Scope (decisions locked with the user)

- **Dead-end stages** = sales `pipeline_stages` with code **`dead_end`** or
  **`not_interested`**.
- **"Remove the new lead"** = mark the intake row **`discarded`** (audit record kept, same
  as today's Discard) — not a hard delete.
- The dead-end rule applies **everywhere a merge can happen**: the manual Merge button,
  the auto-merge trigger, and the new bulk action.
- **Bulk merge** processes only the unambiguous rows (**exactly one** lead match), exactly
  like auto-merge. Rows with 2+ lead matches are never bulk-merged.
- The bulk button **count** = rows that will actually merge (single non-dead-end match). In
  the same run it also **removes** the single-match rows whose target is dead-end. A
  **confirmation dialog** runs first.
- Dead-end is judged against the lead's **current** stage at merge time (a lead may have
  moved to Dead End after the duplicate arrived).

## Background (current code)

- `merge_lead_intake(p_id, p_target_lead_id)` — appends `format_intake_merge_block(r)` to
  `leads.intake_log`, sets intake `status='merged'`. (migration `20260621120200`)
- `lead_intake_auto_merge()` — `before insert` trigger; when `auto_merge_enabled` and
  exactly one `match_type='lead'` entry, merges. (migration `20260621120300`)
- `find_lead_duplicates(p_email, p_phone)` — returns `match_type, record_id, display_name,
  context, matched_field, matched_email, matched_phone`; `context` for a lead is its stage
  **display name**. Results stored in `lead_intake.matches` (jsonb) at insert by the Meta
  webhook + `import_leads_to_intake`. (migration `20260619200000`)
- Frontend: `LeadIntakePage.tsx` (header has the auto-merge toggle; rows have
  Merge/Release/Discard), hooks `useMergeLeadIntake`/`useAutoMerge`, helper
  `leadMatchesOf`, rpc wrappers in `src/lib/rpc.ts`, type `LeadIntakeMatch` in
  `hooks/useLeadIntake.ts`. Confirm dialogs use `window.confirm` in this page today.

## Design

### Shared helper — `lead_is_dead_end(p_lead_id uuid) → boolean`

`sql`, `stable`, `security definer`. True when the lead's current sales stage code is in
`('dead_end','not_interested')`. Used by the merge RPC, the auto-merge trigger, and the
bulk RPCs (DRY, single source of truth for the rule).

```sql
create or replace function public.lead_is_dead_end(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    join public.pipeline_stages ps on ps.id = l.stage_id
    where l.id = p_lead_id and ps.board = 'sales'
      and ps.code in ('dead_end','not_interested')
  );
$$;
```

### Dead-end enforcement

- **`merge_lead_intake`** — after validating the target is a real lead match, before
  appending: if `lead_is_dead_end(p_target_lead_id)` → set the intake row `discarded`
  (`reviewed_by=auth.uid()`, `reviewed_at=now()`) and return
  `{ok:true, dropped_dead_end:true}`. Otherwise behave as today.
- **`lead_intake_auto_merge`** — after picking the single target, if
  `lead_is_dead_end(target)` → set `NEW.status='discarded'`, `NEW.reviewed_at=now()`
  (reviewed_by NULL → System) and return (no append). Otherwise merge as today.

### Bulk merge

A pending row is **mergeable** when it has exactly one `match_type='lead'` entry whose
target lead exists and is not dead-end. It is a **dead-end drop** when the single target
exists and is dead-end. (Rows with 0 or 2+ lead matches are ignored by bulk.)

- **`bulk_merge_intake_preview() → jsonb`** — admin-only, `stable`. Returns
  `{mergeable:int, dead_end:int}` computed over all `status='pending'` rows using
  `lead_is_dead_end` against current stages. Drives the button count + dialog.
- **`bulk_merge_intake() → jsonb`** — admin-only, `security definer`. Loops all pending
  single-lead-match rows: dead-end target → discard; otherwise append
  `format_intake_merge_block` to the target's `intake_log` + mark `merged`
  (`merged_into_lead_id`, `reviewed_by=auth.uid()`, `reviewed_at=now()`). Targets that no
  longer exist are skipped. Returns `{merged:int, dropped:int}`. Runs in a single
  transaction; acceptable for the current backlog (~1.3k pending) — note in the plan if it
  needs batching later.

### Duplicate detection — add `stage_code`

Recreate `find_lead_duplicates` (drop+create; the return signature changes) to also return
**`stage_code text`** — the matched lead's stage code for `match_type='lead'` (NULL for
`deal_client`/`queued`). This lets the UI label dead-end matches accurately for *new* rows.
Backward compatible (adds one key to each match object). Server enforcement remains
authoritative, so the existing backlog (matches without `stage_code`) is still handled
correctly by the live-stage checks above.

### Frontend

- **`LeadIntakeMatch`** type gains `stage_code: string | null`.
- **rpc.ts:** `bulkMergeIntakePreview()` and `bulkMergeIntake()` wrappers (loose `rpcCall`).
- **Hooks:** `useBulkMergePreview()` (query, key `['lead_intake','bulk_preview']`) and
  `useBulkMergeIntake()` (mutation; invalidates `['lead_intake']`, `['leads']`, and the
  preview key).
- **`LeadIntakePage` header:** a **"Bulk merge (N)"** button (admin) next to the auto-merge
  toggle, where `N = preview.mergeable`. Disabled when `N === 0` or the mutation/preview is
  pending. On click → `window.confirm` (matching the page's existing pattern) with
  `t('leads:intake.bulk_confirm', {count:N, dead:M})`. On confirm → `bulkMergeIntake()` →
  toast/alert `t('leads:intake.bulk_done', {merged, dropped})`.
- **Manual Merge button:** unchanged trigger; since the RPC now enforces dead-end, clicking
  Merge on a dead-end-target row removes it instead — the hook surfaces
  `t('leads:intake.merge_removed_dead_end')` when the result has `dropped_dead_end`.
- **i18n** (el + en): `bulk_merge` (`"Bulk merge ({{count}})"`), `bulk_confirm`, `bulk_done`,
  `merge_removed_dead_end`.

## Data flow

```
new lead → find_lead_duplicates (now incl. stage_code) → matches stored
auto-merge trigger (toggle on, 1 lead match):
   target dead-end?  → discard (remove)   else → merge
manual Merge button → merge_lead_intake:
   target dead-end?  → discard (remove)   else → append + merged
Bulk merge (N) button → confirm → bulk_merge_intake:
   for each pending single-lead-match row: dead-end → discard ; else → merge
```

## Error handling

- All RPCs admin-gate → `{ok:false, errors:['not_authorized']}` (preview/bulk raise or
  return error consistently with siblings).
- `bulk_merge_intake` skips rows whose target lead was deleted/converted (no crash).
- Frontend surfaces errors via the existing alert/toast pattern; preview failure → button
  shows 0/disabled.

## Testing

- **SQL:** `lead_is_dead_end` true for dead_end/not_interested, false otherwise;
  `merge_lead_intake` discards (not appends) when target dead-end and returns
  `dropped_dead_end`; auto-merge trigger discards on dead-end single match;
  `bulk_merge_intake_preview` counts mergeable vs dead_end correctly; `bulk_merge_intake`
  merges the live ones and discards the dead-end ones and returns correct totals. (Verified
  read-only where possible; stateful paths confirmed via a throwaway in-app test like the
  prior feature, never toggling shared config in prod.)
- **Frontend (vitest):** `leadMatchesOf` unchanged; bulk button shows the count, is
  disabled at 0, and calls the mutation on confirm; dead-end single-match manual merge
  shows the removed message.

## Changes / Revert

**New/changed objects:** `lead_is_dead_end` (new); `merge_lead_intake`,
`lead_intake_auto_merge`, `find_lead_duplicates` (replaced — dead-end checks + stage_code);
`bulk_merge_intake_preview`, `bulk_merge_intake` (new). Frontend: type + 2 rpc wrappers +
2 hooks + LeadIntakePage header + i18n.

**Rollback SQL:**
```sql
drop function if exists public.bulk_merge_intake();
drop function if exists public.bulk_merge_intake_preview();
-- restore prior merge_lead_intake / lead_intake_auto_merge / find_lead_duplicates from
-- migrations 20260621120200, 20260621120300, 20260619200000 respectively
drop function if exists public.lead_is_dead_end(uuid);
```
(Frontend: revert the LeadIntakePage / rpc.ts / hooks / type / i18n commits.)

## Out of scope (v1)

- Treating Won/converted leads as dead-end (only `dead_end` + `not_interested`).
- Bulk-handling ambiguous (2+ match) rows.
- Backfilling `stage_code` into existing queued `matches` (server live-checks cover them).
