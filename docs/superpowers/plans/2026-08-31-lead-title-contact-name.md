# Lead Titles = Contact Name (Form) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lead titles become **«Ονοματεπώνυμο (Φόρμα)»** — the primary contact's name first, the form name in parentheses — e.g. `Μαργαρίτα Γραβέζα (Local SEO)`, `Γιώργος Παπάς (Website)`, `Νίκος Χ. (Franchise)` — for new leads from every form (Meta/website/franchise), plus a one-off backfill of existing auto-titled leads and pending intake rows.

**Architecture:** A pure helper `leadTitle(fullName, formName, isFranchise)` in `api/_lead-title.ts` replaces the inline title expression in `api/meta-lead.ts` (the single entry point for all form leads — Meta, website forms via Zapier/columnar, franchise). Franchise leads use the literal label `Franchise` (their raw form names are noisy); everything else keeps the raw form name in the parentheses. Missing name → form name alone (current behavior); missing both → `Meta lead`. A SQL migration rewrites existing `leads` and pending `lead_intake` rows with the same format, guarded so manually-authored titles that already contain the person's name are left alone.

**Tech Stack:** TypeScript (Vercel api function) + Vitest; one SQL backfill migration via the Management API script.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`, branch `main` (atomic commits straight to `main`). Shared checkout with other sessions: `git add` ONLY the files each task names; `git diff --cached` before each commit.
- **`npm run build` gate** before every commit touching `src/` or `api/`.
- Title format, exactly: `` `${name} (${form})` `` — one space before the opening parenthesis; total capped at 200 chars with `.slice(0, 200)` applied LAST (after composing). Franchise label is the literal string `Franchise`.
- Fallback chain (no behavior regressions): name+form → `Name (Form)`; name only → `Name`; form only → `Form`; neither → `Meta lead`.
- The columnar (Zapier/Excel) path and the named-field path both flow through the same two variables (`fullName`, `formName`) in `api/meta-lead.ts:320-329` — the helper is called once at ~line 395-398, replacing the current expression; `source`, `contact_first_name/last_name`, notes, dedup are untouched.
- Backfill migration: latest shipped timestamp is `20260831240000` — ours is **`20260831250000_lead_title_contact_name.sql`**; bump if a newer one exists at execution time. Guards (both tables, `leads` also `not archived`):
  - only `source in ('meta','franchise')`;
  - a non-empty contact name exists: `nullif(trim(coalesce(contact_first_name,'') || ' ' || coalesce(contact_last_name,'')), '') is not null`;
  - the current title does NOT already contain the first name (case-insensitive) — protects manually fixed titles: `position(lower(trim(coalesce(contact_first_name,''))) in lower(coalesce(title,''))) = 0 or trim(coalesce(contact_first_name,'')) = ''` → simplified in Task 2's actual SQL;
  - new value: `left(name || ' (' || coalesce(nullif(trim(title), ''), case when source='franchise' then 'Franchise' else 'Meta lead' end) || ')', 200)`, with franchise rows whose `title` EQUALS the contact name getting `name || ' (Franchise)'` instead of nesting the name twice.
- Applied to prod via the usual Management API script BEFORE push is NOT required here (the api change is independent), but do apply before announcing done. Migration carries `-- ROLLBACK:` (note: backfill is lossy — old titles survive only inside the parentheses; rollback note says exactly that).
- Stated assumptions: «primary contact name» = `contact_first_name + ' ' + contact_last_name` (what the forms give); the examples «Website, Local SEO, Web SEO, AI SEO» are the owner's actual form names, which we take RAW from the form payload (no normalization table); manual lead creation (CreateLeadDialog) keeps its free-text title.

## File Structure

| File | Responsibility |
| --- | --- |
| `api/_lead-title.ts` (create) + `api/_lead-title.test.ts` | `leadTitle()` pure helper |
| `api/meta-lead.ts` (modify, ~lines 395-398) | use the helper |
| `supabase/migrations/20260831250000_lead_title_contact_name.sql` (create) | backfill `leads` + `lead_intake` |
| `docs/integrations/meta-leads.md` (modify) | document the title format |

---

### Task 1: `leadTitle()` helper + wire into `api/meta-lead.ts`

**Files:**
- Create: `api/_lead-title.ts`; Test: `api/_lead-title.test.ts`
- Modify: `api/meta-lead.ts:395-398`

**Interfaces:**
- Produces: `export function leadTitle(fullName: string | null, formName: string | null, isFranchise: boolean): string`.

- [ ] **Step 1: Failing tests**

```ts
// api/_lead-title.test.ts
import { describe, it, expect } from 'vitest';
import { leadTitle } from './_lead-title';

describe('leadTitle', () => {
  it('name + form → "Name (Form)"', () => {
    expect(leadTitle('Μαργαρίτα Γραβέζα', 'Local SEO', false)).toBe('Μαργαρίτα Γραβέζα (Local SEO)');
    expect(leadTitle('Γιώργος Παπάς', 'Website', false)).toBe('Γιώργος Παπάς (Website)');
  });
  it('franchise uses the literal Franchise label regardless of the raw form name', () => {
    expect(leadTitle('Νίκος Χ.', 'FRANCHISE ΦΟΡΜΑ ΣΕΠ 2026 v3', true)).toBe('Νίκος Χ. (Franchise)');
    expect(leadTitle('Νίκος Χ.', null, true)).toBe('Νίκος Χ. (Franchise)');
  });
  it('no name → form alone (current behavior)', () => {
    expect(leadTitle(null, 'Web SEO', false)).toBe('Web SEO');
    expect(leadTitle('   ', 'AI SEO', false)).toBe('AI SEO');
  });
  it('no name, franchise → Franchise', () => {
    expect(leadTitle(null, 'whatever franchise form', true)).toBe('Franchise');
  });
  it('neither → Meta lead', () => {
    expect(leadTitle(null, null, false)).toBe('Meta lead');
    expect(leadTitle('', '', false)).toBe('Meta lead');
  });
  it('caps at 200 chars after composing', () => {
    const long = 'Α'.repeat(190);
    const out = leadTitle(long, 'Local SEO', false);
    expect(out.length).toBe(200);
    expect(out.startsWith('Α')).toBe(true);
  });
});
```

Run `npx vitest run api/_lead-title.test.ts` → FAIL (unresolved import).

- [ ] **Step 2: Implement**

```ts
// api/_lead-title.ts
/** Lead title = «Primary contact name (Form)» — owner request 2026-08-31.
 *  Franchise forms get the literal `Franchise` label (raw names are noisy);
 *  other forms keep their raw form name. Falls back to the pre-2026-08-31
 *  behavior when a piece is missing. Backfill of older leads: migration
 *  20260831250000_lead_title_contact_name.sql (same format). */
export function leadTitle(
  fullName: string | null,
  formName: string | null,
  isFranchise: boolean,
): string {
  const name = fullName?.trim() || null;
  const form = isFranchise ? 'Franchise' : formName?.trim() || null;
  if (name && form) return `${name} (${form})`.slice(0, 200);
  return (name ?? form ?? 'Meta lead').slice(0, 200);
}
```

Run → PASS (6 tests).

- [ ] **Step 3: Wire into `api/meta-lead.ts`**

Add the import next to the file's other local imports: `import { leadTitle } from './_lead-title';`
Replace lines 396-398:

```ts
  // Franchise leads are titled by the person; every other form keeps the form name.
  const title = (isFranchise ? (fullName ?? formName) : formName ?? 'Meta lead')?.slice(0, 200)
    ?? 'Meta lead';
```

with:

```ts
  // Owner 2026-08-31: title = «Contact name (Form)» — see api/_lead-title.ts.
  const title = leadTitle(fullName, formName, isFranchise);
```

- [ ] **Step 4: Build + tests + commit**

`npm run build` exit 0; `npx vitest run api` all pass.

```bash
npx prettier --write api/_lead-title.ts api/_lead-title.test.ts
git add api/_lead-title.ts api/_lead-title.test.ts api/meta-lead.ts
git commit -m "feat(leads): form-lead titles become «Contact name (Form)»"
```

---

### Task 2: Backfill migration

**Files:**
- Create: `supabase/migrations/20260831250000_lead_title_contact_name.sql`
- Create (scratch, NOT committed): `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-lead-titles.sh`

- [ ] **Step 1: Write the migration**

```sql
-- Lead titles become «Contact name (Form)» (owner request 2026-08-31; new
-- leads: api/_lead-title.ts). One-off backfill for existing form leads and
-- pending intake rows. Guards:
--   * meta/franchise sources only (manual leads keep their free-text titles);
--   * a contact name must exist;
--   * the current title must NOT already contain the first name (protects
--     titles someone already fixed by hand);
--   * franchise rows whose title IS the person's name get «Name (Franchise)»
--     (no double-nesting) — generic case wraps the old title in parentheses.
-- Lossy by design: the old title survives inside the parentheses.

update public.leads l
   set title = left(
     nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), '')
       || ' (' ||
     case
       when l.source = 'franchise'
            and trim(coalesce(l.title,'')) = trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,''))
         then 'Franchise'
       else coalesce(nullif(trim(l.title), ''), case when l.source = 'franchise' then 'Franchise' else 'Meta lead' end)
     end || ')', 200)
 where l.source in ('meta','franchise')
   and not l.archived
   and nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), '') is not null
   and (
     l.source = 'franchise'  -- franchise titles ARE the name; rewrite them to add the label
     or nullif(trim(coalesce(l.contact_first_name,'')), '') is null
     or position(lower(trim(l.contact_first_name)) in lower(coalesce(l.title,''))) = 0
   );

update public.lead_intake r
   set title = left(
     nullif(trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,'')), '')
       || ' (' ||
     case
       when r.source = 'franchise'
            and trim(coalesce(r.title,'')) = trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,''))
         then 'Franchise'
       else coalesce(nullif(trim(r.title), ''), case when r.source = 'franchise' then 'Franchise' else 'Meta lead' end)
     end || ')', 200)
 where r.source in ('meta','franchise')
   and r.released_lead_id is null
   and nullif(trim(coalesce(r.contact_first_name,'') || ' ' || coalesce(r.contact_last_name,'')), '') is not null
   and (
     r.source = 'franchise'
     or nullif(trim(coalesce(r.contact_first_name,'')), '') is null
     or position(lower(trim(r.contact_first_name)) in lower(coalesce(r.title,''))) = 0
   );

-- ROLLBACK: lossy — the pre-backfill title survives only inside the trailing
-- parentheses; there is no automated undo. Restore from a pre-apply snapshot
-- if ever needed.
```

NOTE for the implementer: verify the `lead_intake` "pending" column name before committing — the plan assumes `released_lead_id` (check `supabase/migrations/20260619160000_lead_intake.sql` for the actual column, e.g. `released_lead_id` / `status` / `released_at`) and use whatever the schema really has for "not yet released"; say in your report which it was.

- [ ] **Step 2: Static check** — `$$`-free plain SQL; run `node -e` JSON-stringify smoke on nothing needed; just confirm the file has exactly 2 `update` statements and the ROLLBACK note.

- [ ] **Step 3: Apply script** to the scratchpad (usual curl pattern, project `xujlrclyzxrvxszepquy`) with verification: counts of rewritten rows are printed by two pre-queries (same WHERE, `select count(*)`) run BEFORE the apply, and two post-queries showing 5 sample titles: `select title from leads where source in ('meta','franchise') and not archived order by created_at desc limit 5`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831250000_lead_title_contact_name.sql
git commit -m "feat(leads): backfill existing form-lead titles to «Contact name (Form)»"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/integrations/meta-leads.md`

- [ ] **Step 1:** Where the doc describes the created lead's fields/title, replace/extend the title description with:

```markdown
- **Title:** «Contact name (Form name)» — e.g. `Μαργαρίτα Γραβέζα (Local SEO)`.
  Franchise leads always use the literal `Franchise` label. If the form gave no
  contact name, the title is the form name alone; if neither exists, `Meta lead`.
  (Owner request 2026-08-31; helper `api/_lead-title.ts`, backfill migration
  `20260831250000`.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/integrations/meta-leads.md
git commit -m "docs(leads): lead title format «Contact name (Form)»"
```

---

## Self-review

- **Spec coverage:** «τίτλος = primary contact name (form name)» με παραδείγματα Website/Local SEO/Web SEO/AI SEO/Franchise → helper + wiring (Task 1) for all new form leads (meta, website, franchise all enter via `api/meta-lead.ts`); existing leads + pending intake → backfill (Task 2); documented (Task 3). Stated assumptions: raw form names (no normalization), franchise label literal, manual leads untouched.
- **Placeholder scan:** one verify-the-column-name note is an explicit implementer instruction with the fallback options named — acceptable; all else full code.
- **Type consistency:** `leadTitle(fullName, formName, isFranchise)` (def = call site); format `Name (Form)` identical in helper, backfill SQL and docs; 200-cap in both layers.
