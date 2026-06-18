# Admin "Delete Lead" (permanent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins (only) a permanent "Delete" for leads — per-row and bulk on `/sales/leads`, behind a confirm dialog, refusing Won/converted leads — distinct from the existing soft-delete *Archive*.

**Architecture:** Deletion goes through one `SECURITY DEFINER` RPC `delete_leads(uuid[])` (not raw PostgREST `.delete()`) so it is atomic, enforces the admin + Won/converted guard server-side, cleans up polymorphic lead comments (which have no FK), and returns a skip report. The UI gates everything on `isAdmin`, reuses the existing `ConfirmDialog`, and reuses the list's existing bulk-selection toolbar.

**Tech Stack:** React, @tanstack/react-query, Supabase (PostgREST + plpgsql RPC), react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-18-admin-delete-lead-design.md`

---

## File Structure

- **Create** `supabase/migrations/20260618000005_delete_leads_rpc.sql` — the RPC + grant + ROLLBACK.
- **Modify** `src/lib/rpc.ts` — `deleteLeads(ids)` typed wrapper (loose `rpcCall` pattern).
- **Create** `src/features/leads/leadDeletable.ts` — pure `isLeadDeletable(lead)`.
- **Create** `src/features/leads/leadDeletable.test.ts` — unit tests.
- **Create** `src/features/leads/hooks/useDeleteLeads.ts` — react-query mutation.
- **Modify** `src/features/leads/LeadRowEditor.tsx` (+ `LeadRowEditor.test.tsx`) — admin-only per-row 🗑 in the checkbox cell.
- **Modify** `src/features/leads/LeadsListPage.tsx` — confirm-dialog state, per-row target, bulk "Delete selected".
- **Modify** `src/i18n/locales/en/leads.json` + `src/i18n/locales/el/leads.json` — `delete.*` keys.

Migration applies to prod project `xujlrclyzxrvxszepquy`.

---

### Task 1: DB — `delete_leads` RPC

**Files:**
- Create: `supabase/migrations/20260618000005_delete_leads_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Admin-only PERMANENT delete of leads. After verifying the caller is an admin,
-- it refuses leads in the `won` stage or already converted (deleting those would
-- orphan real customer/billing records), then hard-deletes the rest. Polymorphic
-- lead comments have no FK to leads, so they are removed explicitly here;
-- email_automations cascade and offers.lead_id nulls via existing FKs. The
-- leads after-delete trigger already records each delete in activity_log.
-- Used by src/lib/rpc.ts deleteLeads() / src/features/leads/hooks/useDeleteLeads.ts.

create or replace function public.delete_leads(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deletable uuid[];
  v_skipped uuid[];
  v_count int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_admin'));
  end if;

  -- Partition the requested ids into deletable vs protected (won or converted).
  -- LEFT JOIN + `is distinct from` => a lead with a null stage is deletable.
  select
    coalesce(array_agg(l.id) filter (
      where (ps.code is distinct from 'won') and l.converted_at is null), '{}'),
    coalesce(array_agg(l.id) filter (
      where ps.code = 'won' or l.converted_at is not null), '{}')
  into v_deletable, v_skipped
  from public.leads l
  left join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids);

  -- Polymorphic comments (parent_type='lead') have no FK => delete explicitly.
  delete from public.comments
  where parent_type = 'lead' and parent_id = any(v_deletable);

  -- email_automations cascade; offers.lead_id set null (both via existing FKs).
  delete from public.leads where id = any(v_deletable);
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted_count', v_count,
    'skipped', to_jsonb(coalesce(v_skipped, '{}'::uuid[]))
  );
end;
$$;

grant execute on function public.delete_leads(uuid[]) to authenticated;

-- ROLLBACK:
-- drop function if exists public.delete_leads(uuid[]);
```

- [ ] **Step 2: Apply to prod via the Management API SQL endpoint**

Apply the file's SQL with the `SUPABASE_ACCESS_TOKEN` (`sbp_…`) via POST to
`https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`.
Then record it so a future `supabase db push` skips it:
`insert into supabase_migrations.schema_migrations (version, name, statements) values ('20260618000005','delete_leads_rpc','{}') on conflict do nothing;`

- [ ] **Step 3: Verify the function exists**

Run (service token):
`select proname, prosecdef from pg_proc where proname = 'delete_leads';`
Expected: one row, `prosecdef = true` (SECURITY DEFINER).
(The admin gate means the *behaviour* can't be tested via the service token — `current_user_is_admin()` is false with no `auth.uid()`. Behaviour is verified in-app in Task 6 Step 6.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000005_delete_leads_rpc.sql
git commit -m "feat(leads): delete_leads RPC — admin-only permanent delete w/ won/converted guard"
```

---

### Task 2: `rpc.ts` wrapper

**Files:**
- Modify: `src/lib/rpc.ts` (add after the `rpcCall` definition, ~line 67)

- [ ] **Step 1: Add the typed wrapper**

`delete_leads` is not in the generated Supabase types, so call it through the
existing loose `rpcCall` helper (same pattern as the custom-jobs RPCs). Add:

```ts
export type DeleteLeadsResult =
  | { ok: true; deletedCount: number; skipped: string[] }
  | { ok: false; errors: string[] };

export async function deleteLeads(ids: string[]): Promise<DeleteLeadsResult> {
  if (ids.length === 0) return { ok: true, deletedCount: 0, skipped: [] };
  const { data, error } = await rpcCall('delete_leads', { p_ids: ids });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as {
    ok: boolean;
    deleted_count?: number;
    skipped?: string[];
    errors?: string[];
  };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['delete_failed'] };
  return { ok: true, deletedCount: r.deleted_count ?? 0, skipped: r.skipped ?? [] };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(leads): deleteLeads rpc wrapper"
```

---

### Task 3: Pure helper `isLeadDeletable`

**Files:**
- Create: `src/features/leads/leadDeletable.ts`
- Test: `src/features/leads/leadDeletable.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isLeadDeletable } from './leadDeletable';

describe('isLeadDeletable', () => {
  it('allows an ordinary, non-converted lead', () => {
    expect(isLeadDeletable({ converted_at: null, stage: { code: 'new_lead' } })).toBe(true);
  });

  it('allows a lead with no stage', () => {
    expect(isLeadDeletable({ converted_at: null, stage: null })).toBe(true);
  });

  it('refuses a converted lead', () => {
    expect(isLeadDeletable({ converted_at: '2026-01-01T00:00:00Z', stage: { code: 'new_lead' } })).toBe(false);
  });

  it('refuses a won lead', () => {
    expect(isLeadDeletable({ converted_at: null, stage: { code: 'won' } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/leads/leadDeletable.test.ts`
Expected: FAIL — "Cannot find module './leadDeletable'".

- [ ] **Step 3: Write minimal implementation**

```ts
// A lead is permanently deletable only if it is NOT won and NOT converted —
// deleting those would orphan real customer/billing records.
export function isLeadDeletable(lead: {
  converted_at: string | null;
  stage?: { code?: string | null } | null;
}): boolean {
  if (lead.converted_at) return false;
  if (lead.stage?.code === 'won') return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/leads/leadDeletable.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/leadDeletable.ts src/features/leads/leadDeletable.test.ts
git commit -m "feat(leads): isLeadDeletable helper (not won, not converted)"
```

---

### Task 4: `useDeleteLeads` hook

**Files:**
- Create: `src/features/leads/hooks/useDeleteLeads.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteLeads } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('leads', 'delete', async (ids: string[]) => {
      const r = await deleteLeads(ids);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r; // { ok: true, deletedCount, skipped }
    }),
    onSuccess: () => {
      // ['leads'] prefix => refreshes both the list and the kanban (['leads','kanban',…]).
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/leads/hooks/useDeleteLeads.ts
git commit -m "feat(leads): useDeleteLeads mutation"
```

---

### Task 5: Per-row 🗑 in `LeadRowEditor`

**Files:**
- Modify: `src/features/leads/LeadRowEditor.tsx`
- Test: `src/features/leads/LeadRowEditor.test.tsx`

- [ ] **Step 1: Add the new tests** (extend the existing file)

In `LeadRowEditor.test.tsx`, change the `renderRow` helper to accept and pass the
two new props, then add the delete tests. Replace the `renderRow` function with:

```tsx
function renderRow(
  lead: LeadRow = baseLead,
  extra: { isAdmin?: boolean; onDelete?: (l: LeadRow) => void } = {},
) {
  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <table>
          <tbody>
            <LeadRowEditor
              lead={lead}
              owners={owners}
              stages={stages}
              currentUserId={null}
              lang="en"
              selected={false}
              onToggleSelect={() => {}}
              isAdmin={extra.isAdmin ?? false}
              onDelete={extra.onDelete ?? (() => {})}
            />
          </tbody>
        </table>
      </I18nextProvider>
    </MemoryRouter>,
  );
}
```

Then add a new `describe` block at the end of the file:

```tsx
describe('LeadRowEditor delete button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the delete button for an admin on a deletable lead and calls onDelete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderRow(baseLead, { isAdmin: true, onDelete });

    const btn = screen.getByRole('button', { name: i18n.t('leads:delete.row_title') });
    await user.click(btn);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('hides the delete button for non-admins', () => {
    renderRow(baseLead, { isAdmin: false });
    expect(screen.queryByRole('button', { name: i18n.t('leads:delete.row_title') })).toBeNull();
  });

  it('hides the delete button on a won lead even for an admin', () => {
    renderRow({ ...baseLead, stage: { id: 's1', code: 'won', board: 'sales', display_names: {} } }, { isAdmin: true });
    expect(screen.queryByRole('button', { name: i18n.t('leads:delete.row_title') })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/leads/LeadRowEditor.test.tsx`
Expected: FAIL — `isAdmin`/`onDelete` props don't exist; no delete button rendered.

- [ ] **Step 3: Implement the props + button**

In `LeadRowEditor.tsx`, add the import near the other local imports:

```tsx
import { isLeadDeletable } from './leadDeletable';
```

Extend the `Props` type:

```tsx
type Props = {
  lead: LeadRow;
  owners: AssignableOwner[];
  stages: StageRow[];
  currentUserId: string | null;
  lang: 'en' | 'el';
  selected: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  isAdmin: boolean;
  onDelete: (lead: LeadRow) => void;
};
```

Update the destructure:

```tsx
export function LeadRowEditor({ lead, owners, stages, currentUserId, lang, selected, onToggleSelect, isAdmin, onDelete }: Props) {
```

Replace the first cell (the checkbox `<td>`) with one that also holds the 🗑:

```tsx
      <td className={td}>
        <div className="flex flex-col items-center gap-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect(lead.id, e.target.checked)}
            aria-label="select"
          />
          {isAdmin && isLeadDeletable(lead) && (
            <button
              type="button"
              onClick={() => onDelete(lead)}
              title={t('delete.row_title')}
              aria-label={t('delete.row_title')}
              className="text-xs text-red-600 hover:text-red-800"
            >
              🗑
            </button>
          )}
        </div>
      </td>
```

- [ ] **Step 4: Add the `delete.row_title` i18n key** (other keys added in Task 6)

In `src/i18n/locales/en/leads.json`, add a `delete` block (sibling of `bulk`):

```json
"delete": {
  "row_title": "Delete lead permanently"
}
```

In `src/i18n/locales/el/leads.json`:

```json
"delete": {
  "row_title": "Οριστική διαγραφή lead"
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/leads/LeadRowEditor.test.tsx`
Expected: PASS (original 3 + new 3 = 6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/leads/LeadRowEditor.tsx src/features/leads/LeadRowEditor.test.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): admin-only per-row delete button in LeadRowEditor"
```

---

### Task 6: Wire up `LeadsListPage` — confirm dialog + bulk delete

**Files:**
- Modify: `src/features/leads/LeadsListPage.tsx`
- Modify: `src/i18n/locales/en/leads.json` + `src/i18n/locales/el/leads.json`

- [ ] **Step 1: Add the rest of the `delete.*` i18n keys**

Extend the `delete` block added in Task 5. In `src/i18n/locales/en/leads.json`:

```json
"delete": {
  "row_title": "Delete lead permanently",
  "bulk": "Delete selected",
  "title": "Delete permanently?",
  "confirm_one": "Permanently delete this lead? This cannot be undone.",
  "confirm_other": "Permanently delete {{count}} leads? This cannot be undone.",
  "button": "Delete",
  "skipped_one": "{{count}} won/converted lead was skipped.",
  "skipped_other": "{{count}} won/converted leads were skipped.",
  "none": "None of the selected leads can be deleted (won or converted)."
}
```

In `src/i18n/locales/el/leads.json`:

```json
"delete": {
  "row_title": "Οριστική διαγραφή lead",
  "bulk": "Διαγραφή επιλεγμένων",
  "title": "Οριστική διαγραφή;",
  "confirm_one": "Οριστική διαγραφή αυτού του lead; Δεν αναιρείται.",
  "confirm_other": "Οριστική διαγραφή {{count}} leads; Δεν αναιρείται.",
  "button": "Διαγραφή",
  "skipped_one": "{{count}} κερδισμένο/μετατραπέν lead παραλείφθηκε.",
  "skipped_other": "{{count}} κερδισμένα/μετατραπέντα leads παραλείφθηκαν.",
  "none": "Κανένα από τα επιλεγμένα leads δεν μπορεί να διαγραφεί (κερδισμένο ή μετατραπέν)."
}
```

- [ ] **Step 2: Add imports + state**

In `LeadsListPage.tsx`, add imports:

```tsx
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDeleteLeads } from './hooks/useDeleteLeads';
import { isLeadDeletable } from './leadDeletable';
```

Inside the component, after the existing `const bulk = useBulkUpdateLeads();` line (and near the other state), add:

```tsx
  const del = useDeleteLeads();
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
```

- [ ] **Step 3: Add the bulk-delete request + confirm handlers**

Add these two functions next to the existing `bulkApply`:

```tsx
  function requestBulkDelete() {
    const ids = rows.filter((l) => selected.has(l.id) && isLeadDeletable(l)).map((l) => l.id);
    if (ids.length === 0) {
      alert(t('delete.none'));
      return;
    }
    setConfirmIds(ids);
  }

  async function onConfirmDelete() {
    if (!confirmIds) return;
    try {
      const r = await del.mutateAsync(confirmIds);
      if (r.skipped.length > 0) alert(t('delete.skipped', { count: r.skipped.length }));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setConfirmIds(null);
      setSelected(new Set());
    }
  }
```

- [ ] **Step 4: Add the bulk button + render the dialog**

In the selection toolbar, directly after the bulk-Archive button (line ~217), add
an admin-only delete button:

```tsx
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={requestBulkDelete}>
              {t('delete.bulk')}
            </Button>
          )}
```

Pass the new props where `LeadRowEditor` is rendered (line ~249):

```tsx
                <LeadRowEditor
                  key={lead.id}
                  lead={lead}
                  owners={owners}
                  stages={salesStages}
                  currentUserId={userId}
                  lang={lang}
                  selected={selected.has(lead.id)}
                  onToggleSelect={toggleSelect}
                  isAdmin={isAdmin}
                  onDelete={(l) => setConfirmIds([l.id])}
                />
```

At the end of the component's returned JSX (just before the final closing `</div>`),
render the dialog:

```tsx
      <ConfirmDialog
        open={confirmIds !== null}
        onOpenChange={(o) => { if (!o) setConfirmIds(null); }}
        title={t('delete.title')}
        description={confirmIds ? t('delete.confirm', { count: confirmIds.length }) : ''}
        confirmLabel={t('delete.button')}
        onConfirm={onConfirmDelete}
        pending={del.isPending}
      />
```

- [ ] **Step 5: Type-check + run the leads suite**

Run: `npx tsc --noEmit && npx vitest run src/features/leads`
Expected: no type errors; all leads tests PASS.

- [ ] **Step 6: Manual smoke (localhost, as admin)**

Run: `npm run dev`. Log in as `mkifokeris@itdev.gr` (admin), open `/sales/leads`.
Expected:
- Each non-won/non-converted row shows a small 🗑 under its checkbox; won leads show none.
- Clicking 🗑 opens the confirm dialog ("Permanently delete this lead?…"); confirming removes the row (and it disappears from the kanban too).
- Select several leads → a "Delete selected" button appears in the toolbar → confirm dialog shows the count → confirming deletes them; if any won/converted were selected, an alert reports they were skipped.
- Log in as a non-admin sales user: **no** 🗑 anywhere and **no** "Delete selected" button.

- [ ] **Step 7: Commit**

```bash
git add src/features/leads/LeadsListPage.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): admin permanent-delete UI — per-row + bulk w/ confirm dialog"
```

---

### Task 7: Full verification + push

- [ ] **Step 1: Full type-check, lint, tests, build**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 2: Push**

```bash
git push origin main
```
(Per project convention: push directly to main, no PR.)

---

## Changes / Revert

**What changes**
- New RPC `public.delete_leads(uuid[])` (migration `20260618000005`).
- Admin-only permanent delete on `/sales/leads`: per-row 🗑 (hidden for won/converted) + "Delete selected" bulk button, both behind a confirm dialog.
- New helper `isLeadDeletable`, hook `useDeleteLeads`, rpc wrapper `deleteLeads`.

**How to revert**
- DB: run the `-- ROLLBACK:` block in `20260618000005_delete_leads_rpc.sql`. The pre-existing `leads_delete` RLS policy is untouched.
- Code: `git revert` the Task 2–6 commits (each task is one atomic commit).
- Note: deleted lead **data** cannot be restored — reverting removes only the feature.

## Decisions baked in (tunable)
- **Guard = won stage OR `converted_at` set** (`isLeadDeletable` + the RPC's partition filter). Change both together.
- **Comment cleanup** is explicit in the RPC because lead comments are polymorphic (no FK). If a real FK with `on delete cascade` is ever added, that `delete from public.comments` line becomes redundant.
- **Scope = leads only.** Extending to clients/deals/jobs later means a parallel entity-specific RPC + the same UI pattern, not a generalization of this one.
