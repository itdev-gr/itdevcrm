# Accounting Delete of New-Deal Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounting can permanently delete a job to fix mistakes — but ONLY while the job's deal has never once reached **Paid In Full**; admins keep unrestricted delete.

**Architecture:** "Has the deal EVER been Paid In Full?" is not durably recorded today: `deals.accounting_completed_at` is stamped only by the manual `complete_accounting` RPC, while the automatic lifecycle mover (migration `20260828100000`, balance ≤ 0 → `paid_in_full`) moves deals in and out of the stage with no permanent trace. So the plan adds a write-once column `deals.first_paid_in_full_at` (BEFORE UPDATE trigger stamps it the first time `accounting_stage_id` lands on the `paid_in_full` stage + backfill from `accounting_completed_at` / current stage), then loosens the `delete_jobs` RPC: admin → unchanged; accounting (`current_user_can('accounting_onboarding','edit')`) → allowed only when every target job's deal has `first_paid_in_full_at IS NULL`, else error `deal_was_paid_in_full`. The job page shows the Delete button to accounting under the same rule (helper `canDeleteJob` in the existing `permissions.ts`), and `job_billing_ref_count` opens to accounting so the billing-lines warning works for them too.

**Tech Stack:** Postgres (SECURITY DEFINER RPC + trigger, applied via the Supabase Management API script), React 19 + TanStack Query, react-i18next (`jobs` ns), Vitest.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`. Work on `main` (team norm: atomic commits straight to `main`, rebase before push). Other Claude sessions share this checkout: `git add` ONLY the files each task names, and check `git diff --cached` before each commit.
- **`npm run build` is the strict gate** (`tsc -b` → `eslint . --max-warnings=0` → `vite build`) before every commit touching `src/`. Prettier on files you create/edit heavily.
- **Migrations are the source of truth.** No CLI/psql: the owner applies the migration by running a prepared curl script via `!` (classifier blocks token calls from the agent). Migration carries a `-- ROLLBACK:` section. **Apply the migration to prod BEFORE pushing the frontend commits** (Vercel auto-deploys `main`; the new RPC behavior must exist before the button appears for accounting).
- `src/types/supabase.ts` is hand-edited: add `first_paid_in_full_at: string | null` to the `deals` block's Row (`?: string | null` in Insert/Update).
- The Paid-In-Full stage is `pipeline_stages(board='accounting_onboarding', code='paid_in_full')` (seed `20260502000002`, position 60, terminal 'paid'). Match on `code`, never display name.
- Frontend permission approximation follows the existing pattern (`canEditBilling` in `JobDetailPage.tsx:115`): accounting = `groupCodes.includes('accounting')`; the RPC enforces the real `current_user_can('accounting_onboarding','edit')`.
- Exact RPC error codes: `not_allowed` (caller is neither admin nor accounting) and `deal_was_paid_in_full` (accounting caller, ≥1 target job's deal was ever paid in full → **nothing is deleted**, all-or-nothing). The old `not_admin` code disappears; the frontend surfaces errors via the existing `alert` in the confirm handler (`JobDetailPage.tsx:783-790`) — Task 3 maps `deal_was_paid_in_full` to a translated message.
- Exact copy (EN / EL) for the new i18n keys under `jobs:delete`:
  - `not_allowed_paid`: **This deal has already been Paid In Full at least once — only an admin can delete this job.** / **Το deal έχει ήδη εξοφληθεί πλήρως τουλάχιστον μία φορά — μόνο admin μπορεί να διαγράψει αυτό το job.**
- Assumption (stated, proceed under it): "ο πελάτης είναι new deal" = the job's **deal** has never reached Paid In Full. No extra "deal age" or stage-position condition. `first_paid_in_full_at` is write-once and never cleared — a deal that was ever paid stays admin-only forever, even if later moved back to Awaiting Payment.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260831130000_accounting_delete_new_deal_jobs.sql` (create) | `deals.first_paid_in_full_at` + stamp trigger + backfill; replace `delete_jobs` + `job_billing_ref_count` |
| `src/types/supabase.ts` (modify) | `deals` Row/Insert/Update gain `first_paid_in_full_at` |
| `src/features/jobs/permissions.ts` (modify) + `.test.ts` | `canDeleteJob(isAdmin, groupCodes, dealFirstPaidInFullAt)` |
| `src/features/jobs/hooks/useJob.ts` (modify) | deal join also selects `first_paid_in_full_at` |
| `src/features/jobs/JobDetailPage.tsx` (modify) | Delete button gate + translated `deal_was_paid_in_full` error |
| `src/i18n/locales/{en,el}/jobs.json` (modify) | `delete.not_allowed_paid` |
| `docs/boards/accounting.md` (modify) | Document the accounting delete rule |

---

### Task 1: Migration — `first_paid_in_full_at` + relaxed `delete_jobs` (+ types)

**Files:**
- Create: `supabase/migrations/20260831130000_accounting_delete_new_deal_jobs.sql`
- Modify: `src/types/supabase.ts` (the `deals` table block — Row/Insert/Update; find with `grep -n "accounting_completed_at" src/types/supabase.ts`, insert alphabetically after `expected_close_date`)
- Create (scratch, NOT committed): `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-acc-delete-migration.sh`

**Interfaces:**
- Consumes: `pipeline_stages`, `deals.accounting_stage_id/accounting_completed_at`, `current_user_is_admin()`, `current_user_can(text,text)` (migration `20260502000005`), existing `delete_jobs(uuid[])` / `job_billing_ref_count(uuid)` from `20260618000030_delete_jobs_rpc.sql`.
- Produces: column `public.deals.first_paid_in_full_at timestamptz null` (write-once); trigger `deals_stamp_first_paid_in_full`; `delete_jobs(p_ids uuid[])` returning `{ok:true, deleted_count}` | `{ok:false, errors:['not_allowed'|'deal_was_paid_in_full']}`; `job_billing_ref_count(p_job_id)` returning the real count for admin OR accounting, 0 otherwise. Tasks 2–3 rely on the exact error strings and column name.

- [ ] **Step 1: Write the migration**

```sql
-- Accounting may hard-delete jobs to fix mistakes, but ONLY while the deal has
-- never once been Paid In Full (owner request 2026-08-31). "Ever paid" was not
-- durably recorded: accounting_completed_at is stamped only by the manual
-- complete_accounting RPC, while apply_payment_status (20260828100000) moves
-- deals into/out of paid_in_full with no permanent trace. So:
--   1) deals.first_paid_in_full_at — write-once stamp, trigger on stage change,
--      backfilled from accounting_completed_at and the current stage;
--   2) delete_jobs: admin unchanged; accounting allowed iff EVERY target job's
--      deal has first_paid_in_full_at IS NULL (all-or-nothing, else
--      'deal_was_paid_in_full'); other callers get 'not_allowed';
--   3) job_billing_ref_count: accounting also sees the billing-lines count.

alter table public.deals add column if not exists first_paid_in_full_at timestamptz;

comment on column public.deals.first_paid_in_full_at is
  'First time the deal ever reached accounting stage paid_in_full. Write-once, never cleared; gates accounting''s job hard-delete (delete_jobs).';

create or replace function public.deals_stamp_first_paid_in_full()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.first_paid_in_full_at is null
     and new.accounting_stage_id is distinct from old.accounting_stage_id
     and exists (
       select 1 from public.pipeline_stages ps
        where ps.id = new.accounting_stage_id
          and ps.board = 'accounting_onboarding' and ps.code = 'paid_in_full'
     ) then
    new.first_paid_in_full_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists deals_stamp_first_paid_in_full on public.deals;
create trigger deals_stamp_first_paid_in_full
  before update of accounting_stage_id on public.deals
  for each row execute function public.deals_stamp_first_paid_in_full();

-- Backfill: manual completes have the exact first-paid moment; deals sitting in
-- paid_in_full today without the stamp get now() (best available evidence).
update public.deals d
   set first_paid_in_full_at = coalesce(d.accounting_completed_at, now())
 where d.first_paid_in_full_at is null
   and (d.accounting_completed_at is not null
        or d.accounting_stage_id in (
          select id from public.pipeline_stages
           where board = 'accounting_onboarding' and code = 'paid_in_full'));

-- Replaces the admin-only version from 20260618000030_delete_jobs_rpc.sql.
create or replace function public.delete_jobs(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_is_admin boolean;
  v_blocked int;
begin
  v_is_admin := public.current_user_is_admin();
  if not v_is_admin and not public.current_user_can('accounting_onboarding', 'edit') then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_allowed'));
  end if;

  if not v_is_admin then
    -- Accounting: every target job's deal must never have been Paid In Full.
    select count(*) into v_blocked
      from public.jobs j
      join public.deals d on d.id = j.deal_id
     where j.id = any(p_ids)
       and d.first_paid_in_full_at is not null;
    if v_blocked > 0 then
      return jsonb_build_object('ok', false, 'errors', jsonb_build_array('deal_was_paid_in_full'));
    end if;
  end if;

  -- Polymorphic comments/attachments (parent_type='job') have no FK => delete explicitly.
  delete from public.comments where parent_type = 'job' and parent_id = any(p_ids);
  delete from public.attachments where parent_type = 'job' and parent_id = any(p_ids);

  -- assigned_tasks cascade; deal_payment_lines.job_id set null (existing FKs).
  delete from public.jobs where id = any(p_ids);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_count', v_count);
end;
$$;

-- Billing-lines count for the delete-confirmation warning: admin OR accounting.
create or replace function public.job_billing_ref_count(p_job_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case
    when not (public.current_user_is_admin()
              or public.current_user_can('accounting_onboarding', 'edit')) then 0
    else (select count(*) from public.deal_payment_lines where job_id = p_job_id)::int
  end;
$$;

-- ROLLBACK:
-- (restore the 20260618000030 bodies of delete_jobs/job_billing_ref_count, then)
-- drop trigger if exists deals_stamp_first_paid_in_full on public.deals;
-- drop function if exists public.deals_stamp_first_paid_in_full();
-- alter table public.deals drop column if exists first_paid_in_full_at;
```

- [ ] **Step 2: Hand-edit the generated types**

In `src/types/supabase.ts`, in the `deals` block (the one containing `accounting_completed_at`), insert alphabetically after `expected_close_date` in Row:

```ts
          first_paid_in_full_at: string | null
```

and in Insert and Update:

```ts
          first_paid_in_full_at?: string | null
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` → exit 0.

- [ ] **Step 4: Prepare the apply script**

Write `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-acc-delete-migration.sh` (same shape as the disconnect one — POST the whole file to `https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`, curl only, then verification):

```bash
#!/usr/bin/env bash
# Applies supabase/migrations/20260831130000_accounting_delete_new_deal_jobs.sql to CRM prod.
# Usage (repo root):  ! SUPABASE_ACCESS_TOKEN=sbp_... bash <this file>
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN=sbp_... first}"
R=xujlrclyzxrvxszepquy
FILE=supabase/migrations/20260831130000_accounting_delete_new_deal_jobs.sql
q(){ BODY=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' "$1"); curl -sS -X POST "https://api.supabase.com/v1/projects/$R/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data "$BODY"; echo; }
BODY=$(node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync(process.argv[1], "utf8")}))' "$FILE")
curl -sS -X POST "https://api.supabase.com/v1/projects/$R/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data "$BODY"; echo
q "select count(*) filter (where first_paid_in_full_at is not null) as stamped, count(*) as total from deals"
q "select tgname from pg_trigger where tgrelid='public.deals'::regclass and tgname='deals_stamp_first_paid_in_full'"
q "select md5(pg_get_functiondef('public.delete_jobs(uuid[])'::regprocedure))"
```

Expected: first `[]`, then a stamped/total row (stamped > 0 on a live DB), the trigger name, and an md5.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260831130000_accounting_delete_new_deal_jobs.sql src/types/supabase.ts
git commit -m "feat(accounting): deals.first_paid_in_full_at + delete_jobs open to accounting for never-paid deals"
```

---

### Task 2: `canDeleteJob` helper

**Files:**
- Modify: `src/features/jobs/permissions.ts` (append)
- Create: `src/features/jobs/permissions.test.ts` — NOTE: this test file already exists; APPEND a new `describe` block to it, do not overwrite the existing `canViewJobPricing` tests.

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function canDeleteJob(isAdmin: boolean, groupCodes: string[], dealFirstPaidInFullAt: string | null | undefined): boolean`. Task 3 imports it in `JobDetailPage.tsx`.

- [ ] **Step 1: Write the failing tests** (append to `src/features/jobs/permissions.test.ts`)

```ts
describe('canDeleteJob', () => {
  it('admins can always delete', () => {
    expect(canDeleteJob(true, [], '2026-08-01T00:00:00Z')).toBe(true);
    expect(canDeleteJob(true, [], null)).toBe(true);
  });
  it('accounting can delete only while the deal was never Paid In Full', () => {
    expect(canDeleteJob(false, ['accounting'], null)).toBe(true);
    expect(canDeleteJob(false, ['accounting'], undefined)).toBe(true);
    expect(canDeleteJob(false, ['accounting'], '2026-08-01T00:00:00Z')).toBe(false);
  });
  it('everyone else never deletes', () => {
    expect(canDeleteJob(false, ['local_seo'], null)).toBe(false);
    expect(canDeleteJob(false, [], null)).toBe(false);
  });
});
```

Update the import line at the top to `import { canViewJobPricing, canDeleteJob } from './permissions';`.

- [ ] **Step 2: Run to verify it fails**

`npx vitest run src/features/jobs/permissions.test.ts` → FAIL (`canDeleteJob` not exported).

- [ ] **Step 3: Implement** (append to `src/features/jobs/permissions.ts`)

```ts
/** Hard delete of a job. Admins always; accounting only while the job's deal has
 *  never once reached Paid In Full (deals.first_paid_in_full_at is null — the
 *  delete_jobs RPC enforces the same rule server-side, migration 20260831130000).
 *  Mistake-fixing on fresh deals only; a deal that was ever paid stays admin-only. */
export function canDeleteJob(
  isAdmin: boolean,
  groupCodes: string[],
  dealFirstPaidInFullAt: string | null | undefined,
): boolean {
  if (isAdmin) return true;
  return groupCodes.includes('accounting') && dealFirstPaidInFullAt == null;
}
```

- [ ] **Step 4: Run to verify it passes**

`npx vitest run src/features/jobs/permissions.test.ts` → PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/features/jobs/permissions.ts src/features/jobs/permissions.test.ts
git add src/features/jobs/permissions.ts src/features/jobs/permissions.test.ts
git commit -m "feat(jobs): canDeleteJob — accounting may delete only never-paid deals' jobs"
```

---

### Task 3: Wire the job page — button gate, deal field, translated error

**Files:**
- Modify: `src/features/jobs/hooks/useJob.ts` (the `.select(...)` string: change `deal:deals(id, code, title, payment_method)` → `deal:deals(id, code, title, payment_method, first_paid_in_full_at)`)
- Modify: `src/features/jobs/hooks/useJobs.ts` (the `JobRow` type: in the `deal?: { id: string; code: string | null; title: string | null }` shape add `first_paid_in_full_at?: string | null`)
- Modify: `src/features/jobs/JobDetailPage.tsx`
- Modify: `src/i18n/locales/en/jobs.json`, `src/i18n/locales/el/jobs.json` (inside the existing `"delete"` object, after `"billing_warning"` — mind the comma)

**Interfaces:**
- Consumes: `canDeleteJob` (Task 2); RPC error string `deal_was_paid_in_full` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: i18n**

EN `jobs.json` `delete` object gains:

```json
    "not_allowed_paid": "This deal has already been Paid In Full at least once — only an admin can delete this job."
```

EL:

```json
    "not_allowed_paid": "Το deal έχει ήδη εξοφληθεί πλήρως τουλάχιστον μία φορά — μόνο admin μπορεί να διαγράψει αυτό το job."
```

Verify both files parse (`node -e "JSON.parse(...)"` as in previous plans).

- [ ] **Step 2: JobDetailPage changes**

1. Import: add `canDeleteJob` to the existing `import { canViewJobPricing } from './permissions';` line.
2. Near the other permission consts (~line 116) add:

```tsx
  const canDelete = canDeleteJob(isAdmin, groupCodes, job?.deal?.first_paid_in_full_at ?? null);
```

Place it AFTER `job` is loaded — the render guard already ensures `job` exists at the button; if the const sits before the early returns, keep the `job?.` optional chain exactly as written.
3. Button gate (~line 412): change `{isAdmin && (` → `{canDelete && (` for the Delete button block only (the Archive button's gate is untouched).
4. Error mapping in the delete `ConfirmDialog`'s `onConfirm` catch (~line 787): replace `alert((e as Error).message);` with:

```tsx
            const msg = (e as Error).message;
            alert(msg.includes('deal_was_paid_in_full') ? t('delete.not_allowed_paid') : msg);
```

- [ ] **Step 3: Build + tests**

`npm run build` → exit 0. `npx vitest run src/features/jobs` → all pass.

- [ ] **Step 4: Manual check (needs Task 1 applied to prod, or run against it after apply)**

As an accounting (non-admin) user: a job whose deal was never Paid In Full shows **Delete**; deleting works and returns to the previous page. A job of an ever-paid deal shows no Delete button; if the RPC is somehow called anyway (stale tab), the alert shows the translated message. Admin: unchanged everywhere.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/features/jobs/JobDetailPage.tsx src/features/jobs/hooks/useJob.ts
git add src/features/jobs/hooks/useJob.ts src/features/jobs/hooks/useJobs.ts src/features/jobs/JobDetailPage.tsx src/i18n/locales/en/jobs.json src/i18n/locales/el/jobs.json
git commit -m "feat(accounting): job Delete button for accounting on never-paid deals, translated guard error"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/boards/accounting.md`

- [ ] **Step 1: Document the rule**

In the permissions/notes area of `docs/boards/accounting.md` (near the line "Accounting never edits a job's *work* directly on a tech board — but accounting …", ~line 112), add:

```markdown
- **Deleting a job (mistake fixing):** accounting can permanently delete a job
  from the job page, but only while its deal has **never once** been Paid In
  Full (`deals.first_paid_in_full_at` is empty — stamped automatically the
  first time the deal ever enters Paid In Full and never cleared). After a
  deal has been paid even once, job deletion is admin-only again.
```

- [ ] **Step 2: Commit**

```bash
git add docs/boards/accounting.md
git commit -m "docs(accounting): accounting may delete jobs only on never-paid deals"
```

---

## Self-review

- **Spec coverage:** accounting gets full hard-delete for mistake fixing → Task 1 RPC + Task 3 button. Only when the deal never reached Fully Paid even once → `first_paid_in_full_at` write-once stamp + backfill (Task 1) covers both the manual and the automatic paid_in_full paths, historical and future; RPC + UI enforce it; admin unchanged.
- **Placeholder scan:** none — full SQL, code, copy and commands inline.
- **Type consistency:** `first_paid_in_full_at` (Task 1 column = Task 1 types = Task 3 select/JobRow/helper arg); error string `deal_was_paid_in_full` (Task 1 RPC = Task 3 mapping); `canDeleteJob(isAdmin, groupCodes, dealFirstPaidInFullAt)` (Task 2 export = Task 3 call); i18n key `delete.not_allowed_paid` defined and consumed once.
