# Unique Lead Column — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Unique Lead" first column to the sales kanban, retime the welcome email to fire when a lead enters it, and lock moving leads *into* it to `mkifokeris@itdev.gr` only (no admin bypass).

**Architecture:** One atomic SQL migration adds the stage, a `restricted_to_user_id` column on `pipeline_stages`, a BEFORE trigger that rejects entering a restricted stage by anyone but the assigned user, and rewrites `leads_email_automations` to send the welcome on entering `unique_lead` instead of on insert. The frontend reads `restricted_to_user_id`, blocks the move in the UI (drag + detail dropdown) with a message, and shows a 🔒 on the column for non-authorized users. The DB trigger is the real guard.

**Tech Stack:** Supabase Postgres (plpgsql triggers), Vite + React 19 + TS, @dnd-kit, TanStack Query, i18next, Vitest + @testing-library/react.

**Key facts (verified against prod schema):**
- mkifokeris user id: `61b53075-398f-43a0-86f6-8bce177b669b` (resolved by email in the migration).
- Sales stages source: `pipeline_stages` where `board='sales'`, sorted by `position`. Current first is `new_lead` (position 10).
- `leads` triggers: `leads_email_automations` is **AFTER** (so a BEFORE rejection prevents the welcome). Existing BEFORE triggers: `leads_default_stage`, `leads_set_updated_at`, `leads_sync_stage_on_scheduled_for`.
- `leads_email_automations` is `language plpgsql security definer set search_path = public`.
- Frontend move path: `SalesKanbanPage.onDragEnd` and `LeadDetailPage.onChangeStage` → `useMoveLeadStage` → `update leads.stage_id`.
- No toast library exists; the codebase uses `alert()` for move errors. We follow that.

---

### Task 1: Database migration (stage + restriction + email retiming)

**Files:**
- Create: `supabase/migrations/20260615000008_unique_lead_stage.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Unique Lead sales column: new stage (first column), move-in restricted to one
-- user, and the welcome email retimed to fire when a lead ENTERS this stage.

-- 1. Per-stage move-in lock (data-driven; null = unrestricted).
alter table public.pipeline_stages
  add column if not exists restricted_to_user_id uuid references auth.users(id);

-- 2. The new stage as the first sales column, locked to mkifokeris.
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, restricted_to_user_id)
values (
  'sales',
  'unique_lead',
  '{"en":"Unique Lead","el":"Μοναδικός Πελάτης"}'::jsonb,
  5,
  false,
  (select id from auth.users where email = 'mkifokeris@itdev.gr')
)
on conflict do nothing;

-- 3. Enforce: only the assigned user may move a lead INTO a restricted stage.
--    Fires only when ENTERING a stage. Moving OUT / editing in place is unaffected.
--    No admin bypass — the assigned user is themselves an admin.
create or replace function public.leads_enforce_stage_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  restricted uuid;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if new.stage_id is null then
    return new;
  end if;

  select restricted_to_user_id into restricted
    from public.pipeline_stages
   where id = new.stage_id;

  if restricted is not null and auth.uid() is distinct from restricted then
    raise exception 'Only the assigned user may move leads into this stage'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists leads_enforce_stage_restriction on public.leads;
create trigger leads_enforce_stage_restriction
  before insert or update on public.leads
  for each row execute function public.leads_enforce_stage_restriction();

-- 4. Retime the welcome email: send when a lead ENTERS unique_lead (not on insert).
create or replace function public.leads_email_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  old_code text;
  seq record;
begin
  if tg_op = 'INSERT' then
    -- Welcome only when a lead is created directly in Unique Lead (rare; only the
    -- assigned user can). Normal new/Meta leads land in New Lead → no email yet.
    if new.stage_id is not null then
      select code into new_code from public.pipeline_stages where id = new.stage_id;
      if new_code = 'unique_lead' and public.email_automation_enabled('lead_welcome') then
        perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: scheduled_for set/changed while the automation is on.
  if new.scheduled_for is distinct from old.scheduled_for
     and new.scheduled_for is not null
     and public.email_automation_enabled('scheduled_confirm') then
    perform public.enqueue_lead_email(
      new.id, 'scheduled_confirm',
      'scheduled_confirm:' || new.id || ':' || to_char(new.scheduled_for, 'YYYYMMDDHH24MI'));
  end if;

  if new.stage_id is distinct from old.stage_id then
    select code into new_code from public.pipeline_stages where id = new.stage_id;
    select code into old_code from public.pipeline_stages where id = old.stage_id;

    -- Stop every active run whose sequence no longer matches the stage.
    update public.lead_sequence_runs r
       set stopped_at = now(), stopped_reason = 'stage_change'
      from public.email_sequences s
     where r.sequence_id = s.id
       and r.lead_id = new.id
       and r.stopped_at is null
       and not (new_code = any (s.active_stage_codes));

    -- Start runs for sequences bound to the new stage.
    for seq in
      select s.id from public.email_sequences s
       where new_code = any (s.active_stage_codes)
         and not exists (
           select 1 from public.lead_sequence_runs r
            where r.lead_id = new.id and r.sequence_id = s.id and r.stopped_at is null)
    loop
      insert into public.lead_sequence_runs (lead_id, sequence_id) values (new.id, seq.id);
    end loop;

    -- Welcome fires on entering Unique Lead.
    if new_code = 'unique_lead' and public.email_automation_enabled('lead_welcome') then
      perform public.enqueue_lead_email(new.id, 'lead_welcome', 'lead_welcome:' || new.id);
    end if;

    if new_code = 'won' then
      if public.email_automation_enabled('won_welcome') then
        perform public.enqueue_lead_email(new.id, 'won_welcome', 'auto_won_welcome:' || new.id);
      end if;
      if public.email_automation_enabled('won_next_steps') then
        perform public.enqueue_lead_email(new.id, 'won_next_steps', 'won_next_steps:' || new.id);
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ROLLBACK:
--   drop trigger if exists leads_enforce_stage_restriction on public.leads;
--   drop function if exists public.leads_enforce_stage_restriction();
--   delete from public.pipeline_stages where board='sales' and code='unique_lead';
--   alter table public.pipeline_stages drop column if exists restricted_to_user_id;
--   -- then restore the prior public.leads_email_automations body (welcome-on-INSERT)
--   --   from migration history / git before this change.
```

- [ ] **Step 2: Verify the SQL parses (dry, no apply)**

Run: `python3 -c "import pathlib,sys; s=pathlib.Path('supabase/migrations/20260615000008_unique_lead_stage.sql').read_text(); print('OK', len(s), 'bytes')"`
Expected: prints `OK <n> bytes` (file written).

- [ ] **Step 3: Commit the migration (NOT applied yet)**

```bash
git add supabase/migrations/20260615000008_unique_lead_stage.sql
git commit -m "feat(sales): migration — Unique Lead stage, move-in lock, welcome email on entry"
```

- [ ] **Step 4: Apply to prod — GATED on user go-ahead**

Do NOT apply until the user explicitly approves. When approved, apply via the Supabase Management API SQL endpoint (same method used for prior migrations) and record it in `supabase_migrations.schema_migrations`.

- [ ] **Step 5: Post-apply verification SQL (run after Step 4)**

Run these checks (expected results in comments):
```sql
-- a) stage exists, first column, locked:
select code, position, restricted_to_user_id is not null as locked
  from public.pipeline_stages where board='sales' and code='unique_lead';
-- expect: unique_lead | 5 | true

-- b) non-mkifokeris move-in is rejected (run as a non-mkifokeris session, or simulate):
--    update a test lead's stage_id to the unique_lead id → expect ERROR 42501.

-- c) entering unique_lead enqueues exactly one welcome:
--    select count(*) from public.email_outbox where dedupe_key = 'lead_welcome:'||'<test_lead_id>';
--    expect: 1

-- d) a fresh lead inserted into New Lead has NO welcome row.
```
Verification happens in the verify phase against the running app; clean up any test leads created.

---

### Task 2: Expose `restricted_to_user_id` in the stage type

**Files:**
- Modify: `src/features/stages/hooks/usePipelineStages.ts:5-16`

- [ ] **Step 1: Add the field to `StageRow`**

In `src/features/stages/hooks/usePipelineStages.ts`, change the `StageRow` type to add the new field (the query already uses `select('*')`, so no query change is needed):

```ts
export type StageRow = {
  id: string;
  board: string;
  code: string;
  display_names: { en: string; el: string };
  position: number;
  color: string | null;
  is_terminal: boolean;
  terminal_outcome: string | null;
  triggers_action: string | null;
  archived: boolean;
  restricted_to_user_id: string | null;
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (tsc emits nothing).

- [ ] **Step 3: Commit**

```bash
git add src/features/stages/hooks/usePipelineStages.ts
git commit -m "feat(stages): expose restricted_to_user_id on StageRow"
```

---

### Task 3: Pure access helper + unit tests (TDD)

**Files:**
- Create: `src/features/sales/stageAccess.ts`
- Test: `src/features/sales/stageAccess.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/sales/stageAccess.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isStageMoveBlocked } from './stageAccess';

describe('isStageMoveBlocked', () => {
  it('blocks when stage is restricted to a different user', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: 'user-A' }, 'user-B')).toBe(true);
  });

  it('allows when stage is restricted to the current user', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: 'user-A' }, 'user-A')).toBe(false);
  });

  it('allows when stage is unrestricted', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: null }, 'user-B')).toBe(false);
  });

  it('blocks a restricted stage when there is no current user', () => {
    expect(isStageMoveBlocked({ restricted_to_user_id: 'user-A' }, null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/sales/stageAccess.test.ts`
Expected: FAIL — cannot find module `./stageAccess`.

- [ ] **Step 3: Implement the helper**

Create `src/features/sales/stageAccess.ts`:

```ts
/** A stage is blocked for the current user when it is restricted to someone else. */
export function isStageMoveBlocked(
  stage: { restricted_to_user_id: string | null },
  currentUserId: string | null,
): boolean {
  return stage.restricted_to_user_id != null && stage.restricted_to_user_id !== currentUserId;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/sales/stageAccess.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/stageAccess.ts src/features/sales/stageAccess.test.ts
git commit -m "feat(sales): isStageMoveBlocked helper + tests"
```

---

### Task 4: i18n message for a blocked move

**Files:**
- Modify: `src/i18n/locales/en/sales.json`
- Modify: `src/i18n/locales/el/sales.json`

- [ ] **Step 1: Add the key under `kanban` in `en/sales.json`**

In `src/i18n/locales/en/sales.json`, add `"locked_move"` to the existing `kanban` object:

```json
  "kanban": {
    "title": "Sales pipeline",
    "empty_column": "Drop deals here",
    "locked_move": "Only Manolis can move leads into this column.",
    "card": {
      "value": "Value",
      "monthly": "/mo"
    }
  },
```

- [ ] **Step 2: Add the Greek key under `kanban` in `el/sales.json`**

In `src/i18n/locales/el/sales.json`, add the same key with the Greek text:

```json
    "locked_move": "Μόνο ο Μανώλης μπορεί να μετακινεί leads σε αυτή τη στήλη.",
```
(Place it inside the existing `kanban` object, matching the en structure.)

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/sales.json')); JSON.parse(require('fs').readFileSync('src/i18n/locales/el/sales.json')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/sales.json src/i18n/locales/el/sales.json
git commit -m "i18n(sales): locked_move message for restricted column"
```

---

### Task 5: Lock indicator on the kanban column

**Files:**
- Modify: `src/features/sales/SalesKanbanColumn.tsx:6-37`
- Test: `src/features/sales/SalesKanbanColumn.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/features/sales/SalesKanbanColumn.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SalesKanbanColumn } from './SalesKanbanColumn';

// i18next falls back to keys in tests; we assert on the lock glyph, not copy.
function renderCol(locked: boolean) {
  return render(
    <DndContext>
      <SalesKanbanColumn stageId="s1" stageLabel="Unique Lead" leads={[]} locked={locked} />
    </DndContext>,
  );
}

describe('SalesKanbanColumn', () => {
  it('shows a lock when locked', () => {
    renderCol(true);
    expect(screen.getByTitle('locked')).toBeInTheDocument();
  });

  it('shows no lock when not locked', () => {
    renderCol(false);
    expect(screen.queryByTitle('locked')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/sales/SalesKanbanColumn.test.tsx`
Expected: FAIL — `locked` is not a prop / no element with title "locked".

- [ ] **Step 3: Add the `locked` prop + indicator**

Replace the contents of `src/features/sales/SalesKanbanColumn.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SalesKanbanCard } from './SalesKanbanCard';
import type { LeadRow } from '@/features/leads/hooks/useLeads';

type Props = {
  stageId: string;
  stageLabel: string;
  leads: LeadRow[];
  locked?: boolean;
};

export function SalesKanbanColumn({ stageId, stageLabel, leads, locked = false }: Props) {
  const { t } = useTranslation('sales');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        {locked && (
          <span title="locked" className="mr-1" aria-label="locked">
            🔒
          </span>
        )}
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({leads.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          leads.map((l) => <SalesKanbanCard key={l.id} lead={l} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/sales/SalesKanbanColumn.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/SalesKanbanColumn.tsx src/features/sales/SalesKanbanColumn.test.tsx
git commit -m "feat(sales): lock indicator on kanban column"
```

---

### Task 6: Guard the drag-drop move + pass `locked` to columns

**Files:**
- Modify: `src/features/sales/SalesKanbanPage.tsx:115-130` (onDragEnd) and `:214-221` (column render)

- [ ] **Step 1: Import the helper**

In `src/features/sales/SalesKanbanPage.tsx`, add after the existing imports (near line 24):

```ts
import { isStageMoveBlocked } from './stageAccess';
```

- [ ] **Step 2: Guard `onDragEnd`**

Replace the `onDragEnd` function (currently lines 115-130) with:

```tsx
  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const targetStage = salesStages.find((s) => s.id === stageId);
    if (targetStage && isStageMoveBlocked(targetStage, userId)) {
      alert(t('kanban.locked_move'));
      return;
    }
    if (wonStage && stageId === wonStage.id) {
      try {
        await convert.mutateAsync(leadId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => tLeads(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      await moveStage.mutateAsync({ leadId, stageId });
    }
  }
```

- [ ] **Step 3: Pass `locked` to each column**

Replace the column render block (currently lines 214-221) with:

```tsx
          {salesStages.map((s) => (
            <SalesKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              leads={leadsByStage.get(s.id) ?? []}
              locked={isStageMoveBlocked(s, userId)}
            />
          ))}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/sales/SalesKanbanPage.tsx
git commit -m "feat(sales): block drag-move into restricted column + show lock"
```

---

### Task 7: Guard the lead-detail stage dropdown

**Files:**
- Modify: `src/features/leads/LeadDetailPage.tsx:121-138` (onChangeStage)

- [ ] **Step 1: Import the helper + add a sales-namespace translator**

In `src/features/leads/LeadDetailPage.tsx`, add to the imports (near line 14, beside the `usePipelineStages` import):

```ts
import { isStageMoveBlocked } from '@/features/sales/stageAccess';
```

Then, beside the existing `const { t } = useTranslation('leads');` (line 30), add a sales translator so the message resolves regardless of namespace load order:

```ts
  const { t: tSales } = useTranslation('sales');
```

- [ ] **Step 2: Guard `onChangeStage`**

Replace the `onChangeStage` function (currently lines 121-138) with:

```tsx
  async function onChangeStage(targetStageId: string) {
    if (!lead || !targetStageId || targetStageId === lead.stage_id) return;
    const targetStage = salesStages.find((s) => s.id === targetStageId);
    if (targetStage && isStageMoveBlocked(targetStage, userId)) {
      alert(tSales('kanban.locked_move'));
      return;
    }
    if (wonStage && targetStageId === wonStage.id) {
      try {
        const result = await convert.mutateAsync(leadId);
        alert(`Converted. Client ${result.clientId} / Deal ${result.dealId}`);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`convert.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
      try {
        await moveStage.mutateAsync({ leadId, stageId: targetStageId });
      } catch (err) {
        alert((err as Error).message);
      }
    }
  }
```

Note: `tSales` is the `sales` namespace translator added in Step 1; it resolves `kanban.locked_move` reliably.

- [ ] **Step 3: Typecheck + lint + full test run**

Run: `npm run typecheck && npm run lint && npx vitest run src/features/sales`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/LeadDetailPage.tsx
git commit -m "feat(leads): block stage-dropdown move into restricted column"
```

---

## Final verification (after all tasks + migration applied)

- Open the sales board: **Unique Lead** is the first column with a 🔒 for non-mkifokeris users.
- As a non-authorized user, drag a lead onto Unique Lead → blocked with the message; the lead does not move.
- As mkifokeris, move a lead into Unique Lead → it moves and exactly one `lead_welcome` email is enqueued/sent.
- Create a new lead → lands in New Lead with **no** welcome email until moved to Unique Lead.
- Move a lead **out** of Unique Lead as any user with `move_stage` → allowed.
