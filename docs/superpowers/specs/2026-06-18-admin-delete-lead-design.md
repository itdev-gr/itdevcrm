# Admin "Delete Lead" (permanent) — Design

**Date:** 2026-06-18
**Status:** Approved (proceed to implementation plan)

## Goal

Give **admins only** a way to **permanently delete** leads — distinct from the
existing *Archive* (soft-hide). Scoped to the leads list (`/sales/leads`) for now:
a per-row delete and a "Delete selected" bulk action, both behind a confirmation
dialog, both refusing Won / converted leads. Designed so it can later be extended
to other entities via parallel, entity-specific RPCs.

## Why this is not just `.delete()`

Findings from the codebase that shape the approach:

- **Admin DELETE is already allowed at the DB level.** `20260502000017_leads_table.sql`
  defines `create policy leads_delete on public.leads for delete to authenticated
  using (public.current_user_is_admin())`. No new RLS is needed.
- **FK behaviour is already sane for two children:**
  `email_automations.lead_id` → `on delete cascade`;
  `offers.lead_id` → `on delete set null`.
  (`leads.converted_client_id` / `converted_deal_id` are FKs *from* leads — irrelevant to deleting a lead.)
- **One gap: lead comments are polymorphic with no FK.** `comments(parent_type, parent_id)`
  with `parent_type in ('client','deal','job','lead')` (see `20260502000031_collab_allow_lead.sql`).
  A plain `DELETE FROM leads` would **orphan** `parent_type='lead'` comments — they must be cleaned up explicitly.
- **Deletes are already audited.** An `after insert/update/delete` trigger on `leads`
  calls `log_activity('id')`, attributing to `auth.uid()`. So who/when is recorded for free.
- **A hard delete is NOT restorable.** The activity log records that it happened, but
  the row and its comments are gone. *Archive* remains the "might want it back" path.

Because of the comment gap, the cross-cutting guard, and the need to report what was
skipped, deletion goes through a single **`SECURITY DEFINER` RPC**, not raw PostgREST
`.delete()`. This makes it atomic (comment cleanup + lead delete in one transaction),
enforces the Won/converted guard server-side (the only guard that also covers the API
path), and returns a skip report.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Delete semantics | **Permanent** (hard delete), separate from existing Archive |
| Placement | Leads list: **per-row + bulk**. No kanban/detail/other entities yet. |
| Confirmation | **Confirm dialog** (reuse existing `ConfirmDialog`) |
| Guard rails | **Block Won/converted** (stage code `won` OR `converted_at` set) |
| Visibility | Entire feature gated on `useAuthStore(s => s.isAdmin)` |
| Protected rows in UI | Per-row 🗑 **hides** when not deletable (cleaner than show-disabled) |

## Architecture

```
LeadsListPage (owns confirm state + bulk action + useDeleteLeads)
  ├─ LeadRowEditor (per-row 🗑, admin-only, hidden when !deletable) → onDelete(lead)
  └─ ConfirmDialog (existing component)
        └─ useDeleteLeads.mutate(ids)
              └─ rpc.deleteLeads(ids)
                    └─ supabase.rpc('delete_leads', { p_ids })   [SECURITY DEFINER]
                          ├─ assert current_user_is_admin()
                          ├─ partition ids → deletable / protected(won|converted)
                          ├─ DELETE comments WHERE parent_type='lead' AND parent_id = ANY(deletable)
                          ├─ DELETE leads WHERE id = ANY(deletable)   (automations cascade; offers set null)
                          └─ RETURN { ok, deleted_count, skipped:[ids] }
```

`useDeleteLeads` invalidates `queryKeys.leads()` (`['leads']`), which also refreshes the
kanban (`['leads','kanban',…]` shares the prefix).

## Units (files)

| File | New/Mod | Responsibility |
|---|---|---|
| `supabase/migrations/20260618000005_delete_leads_rpc.sql` | new | `delete_leads(uuid[])` SECURITY DEFINER + grant + ROLLBACK block |
| `src/lib/rpc.ts` | mod | `deleteLeads(ids)` wrapper (loose `rpcCall` pattern; not in generated types) → `{ ok, deletedCount, skipped }` |
| `src/features/leads/leadDeletable.ts` | new | pure `isLeadDeletable(lead)` = stage ≠ `won` && `!converted_at` |
| `src/features/leads/leadDeletable.test.ts` | new | unit tests for the helper |
| `src/features/leads/hooks/useDeleteLeads.ts` | new | react-query mutation; invalidates `queryKeys.leads()` |
| `src/features/leads/LeadRowEditor.tsx` | mod | admin-only 🗑 in the **checkbox cell** (no new column); hidden when `!isLeadDeletable`; new props `isAdmin`, `onDelete` |
| `src/features/leads/LeadsListPage.tsx` | mod | confirm-dialog state; per-row target; bulk "Delete selected" (admin-only) next to bulk-Archive; result handling |
| `src/i18n/locales/en/leads.json` + `el/leads.json` | mod | `delete.*` keys: row button, bulk button, confirm title/description, skipped notice |

### RPC contract

```
delete_leads(p_ids uuid[]) RETURNS jsonb
  -> { "ok": true,  "deleted_count": <int>, "skipped": [<uuid>, ...] }
  -> { "ok": false, "errors": ["not_admin"] }
```
- Deletable filter: `(ps.code is distinct from 'won') and l.converted_at is null`
  (LEFT JOIN stages; `is distinct from` treats a null stage as deletable).
- Protected (→ `skipped`): `ps.code = 'won' or l.converted_at is not null`.

### UI placement detail

The list table's columns are driven by a `cols` array; adding a trailing actions column
would require a matching `<th>`. To avoid column-count drift, the per-row 🗑 lives **inside
the existing first cell** (next to the row checkbox), shown only when `isAdmin &&
isLeadDeletable(lead)`. The bulk "Delete selected" button sits in the existing selection
toolbar beside the bulk-Archive button, rendered only when `isAdmin`.

Bulk path filters the selected set through `isLeadDeletable` client-side (so the confirm
count is truthful); the RPC still re-checks server-side and reports any `skipped`.

## Testing

- **Pure helper** (`leadDeletable.test.ts`): won → false; converted_at set → false;
  ordinary stage + not converted → true; null stage → true.
- **LeadRowEditor** (extend existing test): 🗑 visible for admin + deletable lead;
  absent for non-admin; absent for won/converted lead.
- **RPC**: verified manually in prod after apply (admin deletes a junk lead; a won lead
  is skipped; its comments are gone; `activity_log` has the delete row).

## Changes / Revert

**What changes**
- New RPC `public.delete_leads(uuid[])` (migration `20260618000005`).
- Admin-only permanent delete on `/sales/leads` (per-row + bulk), behind a confirm dialog;
  Won/converted leads refused.

**How to revert**
- DB: run the `-- ROLLBACK:` block in `20260618000005_delete_leads_rpc.sql`
  (`drop function public.delete_leads(uuid[])`). The pre-existing `leads_delete` RLS policy
  is left untouched.
- Code: `git revert` the UI/hook/rpc commits (each task is one atomic commit).
- Note: deleted lead **data** cannot be restored — this only removes the *feature*.

## Out of scope (deliberately)

- Delete on the kanban card or lead-detail page (leads list only, for now).
- Deleting clients / deals / jobs (future: a parallel entity-specific RPC each).
- Undo / trash-bin for hard-deleted leads (Archive already covers reversible hiding).
