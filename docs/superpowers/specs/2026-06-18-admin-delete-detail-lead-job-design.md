# Admin Delete on Lead & Job Detail Pages — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) → ready for implementation plan
**Goal:** Give admins a delete button on each **lead** and **job** detail page that permanently removes the record. Deals are explicitly **out of scope**.

---

## Scope

**In:**
- An admin-only **Delete** button on `LeadDetailPage` and `JobDetailPage`.
- Server-enforced, admin-only deletion for jobs (new RPC); leads reuse the existing `delete_leads` RPC.

**Out (explicit):**
- **Deals** — no delete. (Deleting a deal would cascade-delete its jobs and payment records; the owner chose not to expose this.)
- Bulk delete from detail pages (single-record action; the leads **list** page already has bulk delete and is unchanged).
- Soft-delete/archive/undo — deletion is **permanent**, consistent with the existing lead delete.

---

## Decisions (from brainstorming)

1. **Leads + jobs only.** Not deals.
2. **Permanent** hard delete (matches existing `delete_leads`).
3. **Leads** keep the existing guard: a `won` or converted lead **cannot** be deleted.
4. **Jobs**: any job is deletable. If the job is linked to billing (invoice/payment lines), the confirm dialog **warns** ("on N billing line(s) — they'll be unlinked, amounts kept") but still allows it. Deleting a job does **not** delete payments — the DB nulls the job reference on those lines (`ON DELETE SET NULL`).
5. **Defense in depth:** UI gates on `isAdmin`; the RPCs enforce admin server-side regardless of UI.
6. **Post-delete navigation:** lead → `/sales/leads`; job → `navigate(-1)` (back to the board/deal it was opened from).

---

## Architecture

Mirror the existing lead-delete pattern (RPC → `lib/rpc.ts` wrapper → React-Query hook → UI). New code is the job equivalent plus a small shared button component.

### 1. Database (new migration)

**`delete_jobs(p_ids uuid[])`** — `SECURITY DEFINER`, modeled on `delete_leads` (`supabase/migrations/20260618000005_delete_leads_rpc.sql`):

- First statement: `if not public.current_user_is_admin() then` return `{ ok: false, errors: ['not_admin'] }`.
- Clean up polymorphic children (no FK): `delete from public.comments where parent_type = 'job' and parent_id = any(p_ids)`; same for `public.attachments`.
- `delete from public.jobs where id = any(p_ids)`. The DB handles the rest automatically:
  - `assigned_tasks.job_id` → **CASCADE** (deleted with the job).
  - `monthly_invoice_items.job_id` → **SET NULL** (line kept, unlinked).
  - `deal_payment_lines.job_id` → **SET NULL** (line kept, unlinked).
  - existing after-delete trigger on `jobs` writes the deletion to `activity_log` (audit trail) — no change needed.
- Return `{ ok: true, deleted_count: <int> }`. (No "skipped" set — unlike leads, jobs have no block.)

**`job_billing_ref_count(p_job_id uuid) returns integer`** — `SECURITY DEFINER`, admin-only (mirror the admin check; return `0` if not admin). Returns `count(monthly_invoice_items where job_id = p_job_id) + count(deal_payment_lines where job_id = p_job_id)`. Powers the confirm-dialog billing warning.

**Rollback (in the migration's down section / documented):**
```sql
drop function if exists public.delete_jobs(uuid[]);
drop function if exists public.job_billing_ref_count(uuid);
```
No schema/table changes, so rollback is just dropping the two functions.

### 2. `src/lib/rpc.ts`

Add wrappers mirroring `deleteLeads`:
- `deleteJobs(ids: string[]): Promise<{ ok: boolean; deletedCount: number; errors?: string[] }>` — calls `delete_jobs`, throws on `!ok`, maps snake→camel.
- `jobBillingRefCount(jobId: string): Promise<number>` — calls `job_billing_ref_count`.

### 3. Hooks

- **Leads:** reuse existing `useDeleteLeads` (`src/features/leads/hooks/useDeleteLeads.ts`) and the `isLeadDeletable` helper (`src/features/leads/leadDeletable.ts`). No new lead hook.
- **Jobs:** new `src/features/jobs/hooks/useDeleteJobs.ts` (mirror `useDeleteLeads`): mutation calling `deleteJobs`, invalidates `queryKeys.jobs(...)` (and the relevant board list query) on success.
- **Jobs billing count:** new `src/features/jobs/hooks/useJobBillingRefCount.ts` — `useQuery` calling `jobBillingRefCount(jobId)`; enabled only when the dialog is open and user is admin.

### 4. Shared UI component

`src/components/AdminDeleteAction.tsx` — a small, focused component used by both detail pages:

Props:
- `label: string` (button text, e.g. "Delete lead")
- `confirmTitle: string`, `confirmBody: ReactNode` (supports the optional billing-warning line)
- `disabledReason?: string` (when set, the button is disabled and shows this as a tooltip — used for won/converted leads)
- `onConfirm: () => Promise<void>`
- `pending?: boolean`

Behavior: renders a `variant="destructive"` button (only mounted by callers when `isAdmin`); on click opens the existing `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`); on confirm calls `onConfirm`. One clear responsibility: "an admin-gated destructive action with confirmation."

### 5. Wiring

- **`LeadDetailPage`** (`src/features/leads/LeadDetailPage.tsx`): in the header action area, when `isAdmin`, render `<AdminDeleteAction>`:
  - `disabledReason` = won/converted message when `!isLeadDeletable(lead)`, else undefined.
  - `onConfirm` = `await useDeleteLeads.mutateAsync([leadId])` then `navigate('/sales/leads')`.
- **`JobDetailPage`** (`src/features/jobs/JobDetailPage.tsx`): in the header action area, when `isAdmin`, render `<AdminDeleteAction>`:
  - `confirmBody` includes the billing warning line when `useJobBillingRefCount(jobId) > 0`.
  - `onConfirm` = `await useDeleteJobs.mutateAsync([jobId])` then `navigate(-1)`.

---

## Behavior details

**Lead delete**
- Button label: "Delete lead". Visible only to admins.
- Won/converted lead → button disabled, tooltip: "Won or converted leads can't be deleted." (server `delete_leads` also blocks this — defense in depth.)
- Confirm copy: "Delete this lead? This permanently removes the lead and its comments. This can't be undone."
- Success → toast/redirect to `/sales/leads`; `queryKeys.leads()` invalidated.

**Job delete**
- Button label: "Delete job". Visible only to admins.
- Confirm copy: "Delete this job? This permanently removes the job and its tasks and comments. This can't be undone."
- If `job_billing_ref_count > 0`, append: "This job is on {n} billing line(s) — they'll be unlinked (their amounts are kept)."
- Success → `navigate(-1)`; invalidate job + board queries.

**Security**
- Both RPCs are `SECURITY DEFINER` and call `current_user_is_admin()` before any delete; a non-admin (or a forged client) gets `not_admin` and nothing is deleted.
- UI buttons are only rendered when `useAuthStore((s) => s.isAdmin)`.

---

## i18n

Add keys (en + el):
- `leads` namespace: `delete.single` ("Delete lead"), `delete.confirm_single_title`/`_body`, `delete.blocked_won_converted`.
- `jobs` namespace: `delete.single` ("Delete job"), `delete.confirm_title`/`_body`, `delete.billing_warning` (with `{{count}}` interpolation).

---

## Testing

- **`isLeadDeletable`** — already covered; no change.
- **`useDeleteJobs`** — hook test: success path invalidates queries; `!ok` throws (mirror `useDeleteLeads` test if one exists, else add).
- **`AdminDeleteAction`** — component tests: renders button; clicking opens confirm; confirm calls `onConfirm`; `disabledReason` disables the button and exposes the tooltip text.
- **`LeadDetailPage`** — admin sees the button; non-admin does not; won/converted lead → disabled with reason.
- **`JobDetailPage`** — admin sees the button; non-admin does not; billing warning shown when count > 0, hidden when 0.
- **`delete_jobs` SQL** — verified manually against the dev/prod DB after the migration (admin deletes a throwaway test job; confirm tasks gone, invoice/payment lines retained but `job_id` nulled, comments/attachments removed). Document the check; it isn't unit-testable in Vitest.
- **E2E (optional)** — admin opens a test job, deletes it, lands back on the board and the card is gone.

---

## Changes / Revert

**New files:**
- `supabase/migrations/<ts>_delete_jobs_rpc.sql` — `delete_jobs` + `job_billing_ref_count`.
- `src/features/jobs/hooks/useDeleteJobs.ts`, `src/features/jobs/hooks/useJobBillingRefCount.ts`
- `src/components/AdminDeleteAction.tsx` (+ test)

**Modified files:**
- `src/lib/rpc.ts` (two wrappers)
- `src/features/leads/LeadDetailPage.tsx`, `src/features/jobs/JobDetailPage.tsx` (mount the button)
- `src/i18n/locales/{en,el}/{leads,jobs}.json` (delete keys)

**Revert:**
- Each task is an atomic commit (`git revert <sha>` per piece).
- DB: run the rollback (`drop function delete_jobs`, `drop function job_billing_ref_count`). No tables/columns added, so nothing else to undo.
- Reverting the UI commits removes the buttons; the existing `delete_leads` RPC and the leads list-page delete are untouched.

---

## Out of scope / future

- **Deal delete** — deliberately excluded. If ever needed, it requires deciding the fate of cascaded jobs + payment records first.
- Bulk delete from detail pages.
- Undo/soft-delete.
