# Inbox Visibility Matrix & Mailbox Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the owner's per-role email visibility matrix (sales → sales@ + own; accounting → own + accounting@ + support@; technical → own + support@; everything else admin-only) and split the /inbox list into mailbox categories (Όλα / Sales / Accounting / Support / Άλλο—admin-only).

**Architecture:** One RLS rewrite of `email_messages_select` replaces the blanket-accounting branch and the unfiled-only branch with a single capture-source matrix branch keyed on the capturing mailbox (`captured_from_user_id` → `shared_mailboxes`), while keeping the card-based branches (own rows, lead owner, job board, department-filed). The `useEmailInbox` hook classifies each row into a category by mapping `captured_from_user_id` through the (now readable) `shared_mailboxes` registry; `InboxPage` gains a category chip row on top of the existing state filters.

**Tech Stack:** Supabase Postgres RLS, React 19 + TanStack Query v5, vitest.

## Global Constraints

- Visibility matrix (owner, 2026-09-03, verbatim intent): «οι sales βλέπουν τα email που είναι στο sales και ο καθένας τα δικά του· όλα τα μέλη του accounting τα δικά τους + accounting@itdev.gr + support@itdev.gr· οι technical support@itdev.gr + τα δικά τους· το άλλο το βλέπουν μόνο οι admin».
- Categories on /inbox: Όλα / Sales / Accounting / Support / Άλλο — «Άλλο» renders ONLY for admins. Existing state filters (Αδιάβαστα / Δικά μου / Χωρίς καρτέλα) remain as a second chip row combinable with the category.
- Card-based visibility is NOT reduced: keep `staff_user_id = auth.uid()`, the lead-owner branch, the job-board branch, and the `current_user_can(department,'view')` branch for filed rows exactly as they are in the live policy (my 20260903210000 emission). Remove ONLY the blanket `group_member_ids('accounting')` line and the now-superseded unfiled-only branch.
- Migration timestamp **20260903218000** (session 3e owns ≥220000; 216xxx-219xxx is our free window). Before applying, message BOTH peer sessions (`uds:/tmp/cc-socks/11756.sock`, `uds:/tmp/cc-socks/29532.sock`) — the policy is co-owned.
- DB applies via the Management-API token flow; print `select policyname, md5(coalesce(qual,'')) from pg_policies where tablename='email_messages' and cmd='SELECT'` pre/post.
- Greek UI copy; both locales updated; no staff email addresses displayed.
- `groups.parent_label` values are exactly 'Sales' / 'Accounting' / 'Technical' (verified in prod today). Helper `public.current_user_in_group(text)` already exists and is granted to authenticated.
- Gates per task: vitest green + eslint clean on touched files; `npx tsc -b --noEmit` clean.

## File Structure

- `supabase/migrations/20260903218000_inbox_visibility_matrix.sql` — technical-membership helper + policy rewrite.
- `src/features/email/hooks/useEmailInbox.ts` (+test) — `category` classification via shared_mailboxes map.
- `src/features/email/InboxPage.tsx` (+test) — category chips + admin-gated «Άλλο».
- `src/i18n/locales/{el,en}/sales.json` — `inbox.cats.*`.

---

### Task 1: Migration — technical helper + visibility-matrix policy

**Files:**
- Create: `supabase/migrations/20260903218000_inbox_visibility_matrix.sql`

**Interfaces:**
- Produces: `public.current_user_in_technical() returns boolean` (SECURITY DEFINER, granted to authenticated); rewritten `email_messages_select`.
- Consumes: live policy body = the 20260903210000 emission (in this repo's migrations dir) — every kept branch must be byte-identical to it.

- [ ] **Step 1: Write the migration file** (full content):

```sql
-- =============================================================================
-- 20260903218000_inbox_visibility_matrix.sql
-- Owner's per-role email visibility matrix (2026-09-03):
--   sales      -> sales@ captures + their own
--   accounting -> own + accounting@ + support@ captures
--   technical  -> own + support@ captures
--   admins     -> everything (incl. info@ / «Άλλο»)
-- Replaces: the blanket `group_member_ids('accounting')` line (accounting no
-- longer sees ALL mail) and the unfiled-only branch from 20260903210000
-- (superseded by the matrix, which covers unfiled AND filed rows by capture
-- source). Card-based branches (own / lead owner / job board / department)
-- are kept byte-identical. Policy co-owned with two parallel sessions —
-- coordinate before applying.
-- =============================================================================

create or replace function public.current_user_in_technical()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    where ug.user_id = auth.uid() and g.parent_label = 'Technical'
  );
$$;
revoke execute on function public.current_user_in_technical() from public, anon;
grant execute on function public.current_user_in_technical() to authenticated;

drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and public.current_user_can(j.service_type, 'view')
    )
  )
  -- 2026-09-03 visibility matrix: capture-source access. Applies to every row
  -- (filed or unfiled) based on which mailbox pulled it in.
  or public.current_user_is_admin()
  or captured_from_user_id = auth.uid()
  or exists (
    select 1 from public.shared_mailboxes sm
     where sm.user_id = email_messages.captured_from_user_id
       and (
         (sm.email = 'sales@itdev.gr'      and public.current_user_in_group('sales'))
         or (sm.email = 'accounting@itdev.gr' and public.current_user_in_group('accounting'))
         or (sm.email = 'support@itdev.gr'
             and (public.current_user_in_group('accounting') or public.current_user_in_technical()))
       )
  )
);

-- ROLLBACK: drop function if exists public.current_user_in_technical();
-- re-run the CREATE POLICY from 20260903210000_email_inbox.sql (restores the
-- blanket accounting line + the unfiled-only branch).
```

- [ ] **Step 2:** `python3 -c "print(open('supabase/migrations/20260903218000_inbox_visibility_matrix.sql').read().count('or '))"` sanity-read; eyeball each kept branch against `supabase/migrations/20260903210000_email_inbox.sql` — byte-identical except the removed lines.
- [ ] **Step 3: Commit** `git add supabase/migrations/20260903218000_inbox_visibility_matrix.sql && git commit -m "feat(inbox): per-role visibility matrix by capturing mailbox"`

(Controller-owned after this task: peer coordination messages, token apply with pre/post policy md5, and the three impersonation probes in Task 5.)

### Task 2: Hook — mailbox category classification

**Files:**
- Modify: `src/features/email/hooks/useEmailInbox.ts`
- Test: `src/features/email/hooks/useEmailInbox.test.ts` (extend)

**Interfaces:**
- Produces: `export type InboxCategory = 'sales' | 'accounting' | 'support' | 'other' | 'personal';` and `InboxItem` gains `category: InboxCategory`.
- Consumes: `shared_mailboxes` is readable by authenticated (policy shared_mailboxes_read_all, live since 20260903215000).

- [ ] **Step 1: Extend the failing test** — add to the existing mock a third `from('shared_mailboxes')` resolution returning `[{user_id:'mb-sales',email:'sales@itdev.gr'},{user_id:'mb-acc',email:'accounting@itdev.gr'},{user_id:'mb-sup',email:'support@itdev.gr'},{user_id:'mb-info',email:'info@itdev.gr'}]`, and message rows with `captured_from_user_id` of `'mb-sales'`, `'mb-info'`, and `'u1'` (the viewer). Assert categories `'sales'`, `'other'`, `'personal'` respectively.
- [ ] **Step 2:** run — FAIL (category undefined).
- [ ] **Step 3: Implement** — in the queryFn's `Promise.all`, add:

```ts
supabase.from('shared_mailboxes' as never).select('user_id, email'),
```

then build the map and classify:

```ts
export type InboxCategory = 'sales' | 'accounting' | 'support' | 'other' | 'personal';

const CATEGORY_BY_MAILBOX: Record<string, InboxCategory> = {
  'sales@itdev.gr': 'sales',
  'accounting@itdev.gr': 'accounting',
  'support@itdev.gr': 'support',
};

function categorize(capturedFrom: string | null, mailboxByUser: Map<string, string>): InboxCategory {
  if (!capturedFrom) return 'other';
  const mailbox = mailboxByUser.get(capturedFrom);
  if (!mailbox) return 'personal';
  return CATEGORY_BY_MAILBOX[mailbox] ?? 'other';
}
```

with `mailboxByUser = new Map(sharedRows.map((r) => [r.user_id, r.email.toLowerCase()]))` carried through the query result, and `category: categorize(r.captured_from_user_id, mailboxByUser)` added to each `InboxItem`.

- [ ] **Step 4:** `npx vitest run src/features/email/hooks/useEmailInbox.test.ts` PASS; `npx tsc -b --noEmit` clean; eslint clean.
- [ ] **Step 5: Commit** `git commit -m "feat(inbox): classify items by capturing mailbox"`

### Task 3: Page — category chips with admin-gated «Άλλο»

**Files:**
- Modify: `src/features/email/InboxPage.tsx`
- Test: `src/features/email/InboxPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `InboxItem.category` (Task 2); `useAuthStore((s) => s.isAdmin)` from `@/lib/stores/authStore`.

- [ ] **Step 1: Extend the failing test** — mock items across categories (`sales`, `accounting`, `other`); with `isAdmin: false` assert the «Άλλο» chip is absent AND `other`-category items are excluded even from Όλα; with `isAdmin: true` assert the chip renders and filtering works. Mock the auth store the same way as the hook test.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — add category state above the existing filter state:

```tsx
type Cat = 'all' | 'sales' | 'accounting' | 'support' | 'other';
const isAdmin = useAuthStore((s) => s.isAdmin);
const [cat, setCat] = useState<Cat>('all');

const visibleItems = useMemo(
  () => (isAdmin ? items : items.filter((i) => i.category !== 'other')),
  [items, isAdmin],
);
const catItems = useMemo(
  () => (cat === 'all' ? visibleItems : visibleItems.filter((i) => i.category === cat)),
  [visibleItems, cat],
);
```

The existing tab/filter logic (`unread`/`mine`/`unfiled`) now filters `catItems` instead of `items`, and every tab count derives from `catItems` (categories and state filters compose). Render the category chips as a FIRST chip row above the current one, same styling, labels from `t('inbox.cats.*')`, with the «other» chip rendered only `{isAdmin && …}`. `unreadCount` shown on the badge/«mark all read» stays derived from `visibleItems` (a non-admin must never be nagged by admin-only mail). Personal-category items appear under Όλα only (no dedicated chip — «Δικά μου» already covers the addressed-to-me view).

- [ ] **Step 4:** `npx vitest run src/features/email 2>&1 | tail -3` green; tsc + eslint clean.
- [ ] **Step 5: Commit** `git commit -m "feat(inbox): mailbox category chips, admin-only Άλλο"`

### Task 4: i18n

**Files:**
- Modify: `src/i18n/locales/el/sales.json`, `src/i18n/locales/en/sales.json`

- [ ] **Step 1:** Inside the existing `inbox` object add:

```json
"cats": { "all": "Όλα", "sales": "Sales", "accounting": "Accounting", "support": "Support", "other": "Άλλο" }
```

(en: `{ "all": "All", "sales": "Sales", "accounting": "Accounting", "support": "Support", "other": "Other" }`.)

- [ ] **Step 2:** JSON validity check via `python3 -c "import json; json.load(open('src/i18n/locales/el/sales.json')); json.load(open('src/i18n/locales/en/sales.json')); print('ok')"`; full `npx vitest run 2>&1 | tail -3` green.
- [ ] **Step 3: Commit** `git commit -m "feat(inbox): category i18n"`

### Task 5: Apply + verify (controller ops)

- [ ] **Step 1:** Message both peer sessions that `email_messages_select` is being rewritten (base: 20260903210000 emission; removals: blanket accounting + unfiled-only branch; addition: capture-source matrix).
- [ ] **Step 2:** Token script: pre/post policy md5 + apply 20260903218000.
- [ ] **Step 3: Impersonation probes (rolled back), one per role, seeded with four unfiled rows captured by sales@/accounting@/support@/info@ mailbox users:**
  - sales rep (Panos d2482254-…): sees sales@ row only (1/0/0/0);
  - accounting member (pick live via `select user_id from user_groups ug join groups g on g.id=ug.group_id where g.code='accounting' limit 1`): sees accounting@ + support@ (0/1/1/0);
  - technical member (`g.parent_label='Technical'` pick): sees support@ only (0/0/1/0);
  - all three see info@ row 0; admin sees 4/4.
- [ ] **Step 4:** Push main → Vercel deploy → in the browser: as the owner (admin) the «Άλλο» chip exists; category chips filter; counts consistent.
- [ ] **Step 5:** Ledger + memory update; report matrix table to the owner.

## Self-Review Notes

- Spec coverage: sales matrix ✓ (T1 policy + T3 chips), accounting ✓, technical ✓, admin-only «Άλλο» ✓ (RLS: no matrix line for info@ → only admin/capturer; UI: chip + item exclusion for non-admins), categories like «το all» ✓ (T3 first chip row).
- Deliberate choices: capture-source matrix is additive to card-based branches (a technical user still sees a sales-lead email only if the job/lead/department branches grant it — the matrix does not leak sales@ to technical); «personal» has no chip (covered by Όλα + Δικά μου); removing blanket-accounting is the owner's explicit intent (accounting now scoped to own+accounting@+support@ at the capture-source level, keeping department-filed access via current_user_can).
- Type consistency: `InboxCategory`, `InboxItem.category`, `t('inbox.cats.*')` used consistently across T2-T4.
