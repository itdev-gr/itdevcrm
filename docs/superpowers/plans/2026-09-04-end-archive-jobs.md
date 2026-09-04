# End → Archive Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Πατώντας **End** σε μια υπηρεσία, το accounting βλέπει ένα παράθυρο επιβεβαίωσης (με προειδοποίηση για ανεξόφλητα)· μόλις το επιβεβαιώσει, η υπηρεσία λήγει **και αρχειοθετείται**, ο υπεύθυνος του job ειδοποιείται ότι τελείωσε, και το job ζει από εκεί και πέρα σε μια στήλη «Αρχειοθετημένα» στο τέλος κάθε technical board που τη βλέπουν **μόνο οι admin**.

**Architecture:** Μία SECURITY DEFINER RPC (`end_and_archive_job`) κάνει σε μία δοσοληψία ό,τι έκανε το `end_job` (stop billing → status completed → κάρτα στο Closed lane → cascade στα AI SEO παιδιά) **συν** `archived=true` με πλήρες audit stamp, σχόλιο στο timeline και notification στον υπεύθυνο. Το `archived` είναι σήμερα νεκρή στήλη που **κάθε** query του app φιλτράρει (`archived = false`), οπότε η αρχειοθέτηση βγάζει αυτόματα το job από boards, billing recompute, deal pricing sync και counts — χωρίς να αγγίξουμε καμία υπάρχουσα query. Η στήλη «Αρχειοθετημένα» είναι **συνθετική** (όχι `pipeline_stages` row) και τρέφεται από ξεχωριστό admin-only query, ακριβώς με το μοτίβο της υπάρχουσας συνθετικής στήλης «Μπλοκαρισμένο».

**Tech Stack:** Vite 8 + React 19 + TypeScript, TanStack Query v5, zustand (`useAuthStore`), i18next (el/en), Supabase Postgres (RLS + SECURITY DEFINER RPCs), vitest + @testing-library/react, @dnd-kit/core.

## Global Constraints

- Migration filename: `supabase/migrations/20260904200000_end_and_archive_job.sql`. Το εύρος 202609042xxxxx είναι δεσμευμένο για αυτό το πλάνο· **δύο παράλληλα sessions δουλεύουν στο ίδιο checkout** — δεν χρησιμοποιούμε άλλο timestamp χωρίς συνεννόηση.
- Όλα τα ορατά strings μπαίνουν **και στα δύο** locale αρχεία (`src/i18n/locales/el/*.json` και `src/i18n/locales/en/*.json`). Καμία hardcoded αγγλική λέξη στο UI.
- Το UI **δεν εμφανίζει ποτέ email προσωπικού** — ονόματα/avatars μόνο.
- Όλες οι νέες SECURITY DEFINER συναρτήσεις: `language sql|plpgsql stable|volatile security definer set search_path = public`, μετά `revoke execute ... from public, anon;` και `grant execute ... to authenticated;` (μοτίβο του `20260903218000`).
- Ο έλεγχος δικαιώματος για End/Archive είναι ακριβώς ο σημερινός του `end_job`: `current_user_is_admin() or current_user_can('accounting_onboarding','edit')`. Το Restore είναι **μόνο** `current_user_is_admin()`.
- Απόφαση ιδιοκτήτη (2026-09-04): **δεν υπάρχει έγκριση από δεύτερο άτομο** — μόνο παράθυρο «Είσαι σίγουρος;» σε αυτόν που πατάει End.
- Απόφαση ιδιοκτήτη (2026-09-04): ανεξόφλητες χρεώσεις **δεν μπλοκάρουν** — εμφανίζονται στο παράθυρο και καταγράφονται στο timeline.
- Απόφαση ιδιοκτήτη (2026-09-04): η γραμμή του αρχειοθετημένου job **μένει** στο JOBS & BILLING του deal, γκριζαρισμένη, με σήμανση «Αρχειοθετημένο», χωρίς κουμπιά δράσης.
- Τα 6 kanban technical boards είναι: `web_seo`, `local_seo`, `web_dev`, `social_media`, `ads`, `franchise`. Τα `hosting`, `domains`, `maintenance` είναι **λίστες**, όχι kanban.
- Ο υπεύθυνος («assignee») ενός job είναι η στήλη **`jobs.owner_user_id`**. Δεν υπάρχει `assigned_to`/`assignee`. Το `assigned_group_id` είναι τμήμα, όχι άτομο.
- Μην αγγίξετε τα `end_job` και `job_pause_billing` — παραμένουν ως έχουν (το Pause είναι ξεχωριστή, αναστρέψιμη λειτουργία).

---

## File Structure

| Αρχείο | Ευθύνη |
|---|---|
| `supabase/migrations/20260904200000_end_and_archive_job.sql` (create) | `job_unpaid_total`, `end_and_archive_job`, `unarchive_job` |
| `src/features/deals/endArchiveCopy.ts` (create) | Καθαρή συνάρτηση που συνθέτει το κείμενο του παραθύρου επιβεβαίωσης |
| `src/features/deals/hooks/useEndArchiveJob.ts` (create) | `useEndArchiveJob`, `useJobUnpaidTotal` |
| `src/features/deals/JobsBillingPanel.tsx` (modify) | End → νέα RPC· γκριζαρισμένη γραμμή για archived |
| `src/features/jobs/hooks/useJobsForDeal.ts` (modify) | Φέρνει και τα archived (για το deal panel) |
| `src/features/jobs/hooks/useArchivedJobs.ts` (create) | Admin-only query των archived jobs ανά board |
| `src/features/jobs/hooks/useUnarchiveJob.ts` (create) | Restore RPC |
| `src/features/jobs/JobsKanbanPage.tsx` (modify) | Συνθετική στήλη «Αρχειοθετημένα» στο τέλος, admin-only |
| `src/features/jobs/JobDetailPage.tsx` (modify) | Αφαίρεση του παλιού stub Archive· προσθήκη admin-only Restore |
| `src/features/notifications/notification-presenters.tsx` (modify) | Εικονίδιο + κείμενο για `job_archived` |
| `src/features/notifications/NotificationsColumn.tsx` (modify) | Ίδιο εικονίδιο στο διπλότυπο switch |
| `src/features/notifications/toastableTypes.ts` (modify) | Το `job_archived` κάνει toast |
| `src/features/hosting/HostingListPage.tsx`, `src/features/domains/DomainsListPage.tsx`, `src/features/support/SupportListPage.tsx` (modify) | Admin-only φίλτρο «Αρχειοθετημένα» |
| `src/lib/queryKeys.ts` (modify) | `archivedJobsByService` |
| `src/i18n/locales/{el,en}/{deals,jobs,notifications}.json` (modify) | Νέα strings |

---

### Task 1: Migration — RPCs για λήξη+αρχειοθέτηση, ανεξόφλητο υπόλοιπο και επαναφορά

**Files:**
- Create: `supabase/migrations/20260904200000_end_and_archive_job.sql`

**Interfaces:**
- Produces:
  - `public.job_unpaid_total(p_job_id uuid) returns numeric` — άθροισμα `amount_gross` των `pending`/`overdue` πληρωμών της αλυσίδας `(deal_id, service_type)` του job. Επιστρέφει `0` όταν δεν υπάρχουν.
  - `public.end_and_archive_job(p_job_id uuid) returns jsonb` — `{"ok": true, "job_id": uuid, "unpaid_total": numeric, "notified": int}` ή `{"ok": false, "errors": ["permission_denied"|"job_not_found"]}`.
  - `public.unarchive_job(p_job_id uuid) returns jsonb` — `{"ok": true, "job_id": uuid}` ή `{"ok": false, "errors": ["permission_denied"|"job_not_found"]}`.
- Consumes: υπάρχοντα `current_user_is_admin()`, `current_user_can(text,text)`.

**Σημείωση για τον implementer:** δεν έχεις πρόσβαση σε βάση. Γράψε το αρχείο, κάνε commit. Το apply στην παραγωγή και τα probes τα κάνει ο controller (Task 8).

- [ ] **Step 1: Γράψε το migration**

Δημιούργησε `supabase/migrations/20260904200000_end_and_archive_job.sql` με **ακριβώς** αυτό το περιεχόμενο:

```sql
-- =============================================================================
-- 20260904200000_end_and_archive_job.sql
-- Owner (2026-09-04): το End στο JOBS & BILLING πλέον ΛΗΓΕΙ ΚΑΙ ΑΡΧΕΙΟΘΕΤΕΙ την
-- υπηρεσία («τελείωσε τελείως και δεν θα συνεχίσουμε»), μετά από παράθυρο
-- επιβεβαίωσης στον χρήστη που το πατάει (ΟΧΙ έγκριση δεύτερου ατόμου), και
-- ειδοποιεί τον υπεύθυνο του job ότι τελείωσε.
--
-- Το jobs.archived ήταν μέχρι σήμερα νεκρή στήλη που ΚΑΘΕ query φιλτράρει
-- (archived = false): boards, recurring billing generator, deal pricing sync.
-- Άρα archived = true βγάζει το job από παντού χωρίς αλλαγή σε καμία query.
--
-- Το end_job και το job_pause_billing ΔΕΝ αλλάζουν (το Pause είναι ξεχωριστή,
-- αναστρέψιμη λειτουργία και το end_job μένει για ό,τι το καλεί ήδη).
-- =============================================================================

-- --- 1. Ανεξόφλητο υπόλοιπο της υπηρεσίας -----------------------------------
-- Ίδια κοκκοποίηση (deal_id, service_type) με το job_pause_billing όταν ακυρώνει
-- γραμμές. amount_gross = αυτό που χρωστάει ο πελάτης (με ΦΠΑ).
create or replace function public.job_unpaid_total(p_job_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(dp.amount_gross), 0)
    from public.jobs j
    join public.deal_payments dp
      on dp.deal_id = j.deal_id
     and dp.service_type = j.service_type
   where j.id = p_job_id
     and dp.status in ('pending', 'overdue');
$$;
revoke execute on function public.job_unpaid_total(uuid) from public, anon;
grant execute on function public.job_unpaid_total(uuid) to authenticated;

-- --- 2. Λήξη + αρχειοθέτηση --------------------------------------------------
create or replace function public.end_and_archive_job(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.jobs;
  v_board text;
  v_closed uuid;
  v_unpaid numeric;
  v_actor uuid := auth.uid();
  v_client_name text;
  v_notified int := 0;
  m record;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_job from public.jobs where id = p_job_id and not archived;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  v_unpaid := public.job_unpaid_total(p_job_id);

  select coalesce(ps.board, v_job.service_type) into v_board
    from public.pipeline_stages ps where ps.id = v_job.stage_id;
  v_board := coalesce(v_board, v_job.service_type);

  select id into v_closed
    from public.pipeline_stages
   where board = v_board and code = 'closed' and archived = false
   limit 1;

  select c.name into v_client_name from public.clients c where c.id = v_job.client_id;

  -- Ό,τι κάνει το end_job, ΣΥΝ archive stamp.
  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    stage_id = coalesce(v_closed, stage_id),
    archived = true,
    archived_at = now(),
    archived_by = v_actor,
    archived_reason = 'ended_by_accounting',
    updated_at = now()
   where id = p_job_id;

  -- Cascade στα AI SEO work-card παιδιά (καθένα στο δικό του closed lane).
  update public.jobs c set
    billing_active = false,
    status = case when c.status in ('cancelled','completed') then c.status else 'completed' end,
    completed_at = coalesce(c.completed_at, now()),
    stage_id = coalesce(
      (select id from public.pipeline_stages ps
        where ps.board = c.service_type and ps.code = 'closed' and ps.archived = false limit 1),
      c.stage_id),
    archived = true,
    archived_at = now(),
    archived_by = v_actor,
    archived_reason = 'ended_by_accounting_cascade',
    updated_at = now()
   where c.parent_job_id = p_job_id and not c.archived;

  -- Audit στο timeline του job: ποιος, πότε, και τι χρωστιέται.
  insert into public.comments (parent_type, parent_id, author_id, body, task_key)
  values (
    'job', p_job_id, v_actor,
    case when v_unpaid > 0 then
      'Η υπηρεσία έληξε και αρχειοθετήθηκε. ΠΡΟΣΟΧΗ: ανεξόφλητο υπόλοιπο '
        || to_char(v_unpaid, 'FM999999990.00') || ' EUR τη στιγμή της αρχειοθέτησης.'
    else
      'Η υπηρεσία έληξε και αρχειοθετήθηκε.'
    end,
    'job_archived:' || p_job_id::text
  )
  on conflict do nothing;

  -- Ειδοποίηση στον υπεύθυνο· αν δεν υπάρχει, στα μέλη του τμήματος του job.
  -- Ο ίδιος ο δράστης δεν ειδοποιεί τον εαυτό του.
  for m in
    select r.user_id from (
      select p.user_id
        from public.profiles p
       where p.user_id = v_job.owner_user_id
         and p.is_active and not p.archived
      union
      select p.user_id
        from public.user_groups ug
        join public.profiles p on p.user_id = ug.user_id
       where v_job.owner_user_id is null
         and ug.group_id = v_job.assigned_group_id
         and p.is_active and not p.archived
    ) r
    where r.user_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      m.user_id,
      'job_archived',
      jsonb_build_object(
        'job_id', v_job.id,
        'service_type', v_job.service_type,
        'job_code', coalesce(v_job.code, ''),
        'job_title', coalesce(v_job.title, ''),
        'client_name', coalesce(v_client_name, ''),
        'unpaid_total', v_unpaid,
        'parent_type', 'job',
        'parent_id', v_job.id
      )
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'job_id', p_job_id, 'unpaid_total', v_unpaid, 'notified', v_notified);
end $$;
revoke execute on function public.end_and_archive_job(uuid) from public, anon;
grant execute on function public.end_and_archive_job(uuid) to authenticated;

-- --- 3. Επαναφορά (μόνο admin) -----------------------------------------------
-- Το job γυρίζει από τα Αρχειοθετημένα στο Closed lane όπου το άφησε το End.
-- Η χρέωση ΔΕΝ ξαναρχίζει (billing_active μένει false) — αυτό είναι δουλειά
-- του Resume billing, όχι της επαναφοράς.
create or replace function public.unarchive_job(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_found int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  update public.jobs set
    archived = false,
    archived_at = null,
    archived_by = null,
    archived_reason = null,
    updated_at = now()
   where id = p_job_id and archived;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  update public.jobs c set
    archived = false, archived_at = null, archived_by = null,
    archived_reason = null, updated_at = now()
   where c.parent_job_id = p_job_id
     and c.archived
     and c.archived_reason = 'ended_by_accounting_cascade';

  insert into public.comments (parent_type, parent_id, author_id, body)
  values ('job', p_job_id, v_actor, 'Η υπηρεσία επαναφέρθηκε από τα αρχειοθετημένα.');

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $$;
revoke execute on function public.unarchive_job(uuid) from public, anon;
grant execute on function public.unarchive_job(uuid) to authenticated;

-- ROLLBACK: drop function public.end_and_archive_job(uuid), public.unarchive_job(uuid),
-- public.job_unpaid_total(uuid);  -- το end_job παραμένει ανέπαφο, οπότε το UI
-- μπορεί να γυρίσει στην προηγούμενη συμπεριφορά αλλάζοντας μόνο το frontend.
```

- [ ] **Step 2: Έλεγχος στατικής ορθότητας**

Τρέξε από τη ρίζα του repo:

```bash
grep -c "security definer set search_path = public" supabase/migrations/20260904200000_end_and_archive_job.sql
grep -c "grant execute" supabase/migrations/20260904200000_end_and_archive_job.sql
```

Αναμενόμενο: `3` και `3`.

Επιβεβαίωσε επίσης ότι τα ονόματα στηλών υπάρχουν όντως — σύγκρινε με το `20260624060000_end_job_cascade_children.sql` (ίδιο update block) και με το `20260903220000_no_work_before_first_payment.sql:99-111` (ίδιο σχήμα notification payload). Οι στήλες του `comments` είναι: `parent_type, parent_id, author_id, body, task_key` (ΠΡΟΣΟΧΗ: `author_id`, **όχι** `author_user_id`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260904200000_end_and_archive_job.sql
git commit -m "feat(jobs): end_and_archive_job RPC with audit, unpaid total and assignee notification"
```

---

### Task 2: End → παράθυρο επιβεβαίωσης με προειδοποίηση ανεξόφλητων

**Files:**
- Create: `src/features/deals/endArchiveCopy.ts`
- Create: `src/features/deals/endArchiveCopy.test.ts`
- Create: `src/features/deals/hooks/useEndArchiveJob.ts`
- Modify: `src/features/deals/JobsBillingPanel.tsx`
- Modify: `src/i18n/locales/el/deals.json`, `src/i18n/locales/en/deals.json`

**Interfaces:**
- Consumes (Task 1): RPC `end_and_archive_job(p_job_id uuid)`, RPC `job_unpaid_total(p_job_id uuid)`.
- Produces:
  - `endConfirmBody(t, unpaidGross: number | null): string` από `endArchiveCopy.ts`
  - `useEndArchiveJob(dealId: string)` → `{ mutateAsync(jobId: string), isPending }`
  - `useJobUnpaidTotal(jobId: string, enabled: boolean)` → `{ unpaid: number | null }` (`null` = δεν φορτώθηκε ακόμη)

- [ ] **Step 1: Γράψε το failing test για το κείμενο του παραθύρου**

Δημιούργησε `src/features/deals/endArchiveCopy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { endConfirmBody } from './endArchiveCopy';

const t = ((k: string, o?: Record<string, unknown>) =>
  o && 'amount' in o ? `${k}|${String(o.amount)}` : k) as unknown as Parameters<typeof endConfirmBody>[0];

describe('endConfirmBody', () => {
  it('χωρίς ανεξόφλητα δείχνει μόνο το βασικό κείμενο', () => {
    expect(endConfirmBody(t, 0)).toBe('jobs_billing.end_confirm_body');
  });

  it('όσο δεν ξέρουμε ακόμη το υπόλοιπο, δεν προειδοποιεί', () => {
    expect(endConfirmBody(t, null)).toBe('jobs_billing.end_confirm_body');
  });

  it('με ανεξόφλητα προσθέτει την προειδοποίηση με το ποσό', () => {
    expect(endConfirmBody(t, 240.5)).toBe(
      'jobs_billing.end_confirm_body jobs_billing.end_confirm_unpaid|240,50 €',
    );
  });

  it('αρνητικό ή NaN υπόλοιπο δεν προειδοποιεί', () => {
    expect(endConfirmBody(t, -10)).toBe('jobs_billing.end_confirm_body');
    expect(endConfirmBody(t, Number.NaN)).toBe('jobs_billing.end_confirm_body');
  });
});
```

- [ ] **Step 2: Τρέξε το test και δες ότι αποτυγχάνει**

Run: `npx vitest run src/features/deals/endArchiveCopy.test.ts`
Expected: FAIL — `Failed to resolve import "./endArchiveCopy"`.

- [ ] **Step 3: Γράψε την υλοποίηση**

Δημιούργησε `src/features/deals/endArchiveCopy.ts`:

```ts
import type { TFunction } from 'i18next';

/** Ποσό σε ευρώ, ελληνική μορφή: 240,50 € */
function eur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

/**
 * Κείμενο του παραθύρου επιβεβαίωσης του End. Η προειδοποίηση για ανεξόφλητα
 * ΔΕΝ μπλοκάρει (απόφαση ιδιοκτήτη 2026-09-04) — απλώς λέει τι χρωστιέται.
 * `null` σημαίνει «δεν ξέρουμε ακόμη», όχι «μηδέν»: δεν προειδοποιούμε τότε.
 */
export function endConfirmBody(t: TFunction, unpaidGross: number | null): string {
  const base = t('jobs_billing.end_confirm_body');
  if (unpaidGross === null || !Number.isFinite(unpaidGross) || unpaidGross <= 0) return base;
  return `${base} ${t('jobs_billing.end_confirm_unpaid', { amount: eur(unpaidGross) })}`;
}
```

- [ ] **Step 4: Τρέξε το test και δες ότι περνάει**

Run: `npx vitest run src/features/deals/endArchiveCopy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Γράψε τα hooks**

Δημιούργησε `src/features/deals/hooks/useEndArchiveJob.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type RpcResult = { ok: boolean; errors?: string[]; unpaid_total?: number; notified?: number };

/** Ανεξόφλητο (pending+overdue, με ΦΠΑ) της υπηρεσίας — για την προειδοποίηση. */
export function useJobUnpaidTotal(jobId: string, enabled: boolean): { unpaid: number | null } {
  const query = useQuery({
    queryKey: ['job-unpaid-total', jobId],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('job_unpaid_total' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
  });
  return { unpaid: query.data ?? null };
}

/** End = λήξη ΚΑΙ αρχειοθέτηση, σε μία δοσοληψία στον server. */
export function useEndArchiveJob(dealId: string) {
  const qc = useQueryClient();
  return useMutation<RpcResult, Error, string>({
    mutationFn: async (jobId) => {
      const { data, error } = await supabase.rpc('end_and_archive_job' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      const result = data as unknown as RpcResult;
      if (!result?.ok) throw new Error(result?.errors?.[0] ?? 'end_archive_failed');
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobsForDeal(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.notifications() });
    },
  });
}
```

**Σημείωση:** τα `as never` casts είναι το καθιερωμένο bridge του repo για RPCs που δεν έχουν μπει ακόμη στα generated types (`src/types/supabase.ts`) — φεύγουν στο επόμενο `npm run types:gen`. Αν τα `queryKeys.jobsForDeal` / `queryKeys.deal` έχουν άλλα ονόματα, χρησιμοποίησε τα υπάρχοντα από το `src/lib/queryKeys.ts` — μην φτιάξεις καινούργια.

- [ ] **Step 6: Πρόσθεσε τα i18n strings**

Στο `src/i18n/locales/el/deals.json`, μέσα στο ίδιο αντικείμενο όπου βρίσκονται τα `end_confirm_title` / `end_confirm_body` (γραμμές 240-242), **αντικατέστησε** το `end_confirm_body` και **πρόσθεσε** τα υπόλοιπα:

```json
    "end_confirm_title": "Λήξη και αρχειοθέτηση;",
    "end_confirm_body": "Η χρέωση σταματά, η υπηρεσία σημειώνεται ως ολοκληρωμένη και η κάρτα πάει στα Αρχειοθετημένα. Ο υπεύθυνος θα ειδοποιηθεί.",
    "end_confirm_unpaid": "ΠΡΟΣΟΧΗ: υπάρχει ανεξόφλητο υπόλοιπο {{amount}} — θα παραμείνει χρεωμένο στον πελάτη.",
    "archived_badge": "Αρχειοθετημένο",
```

Στο `src/i18n/locales/en/deals.json`, στην αντίστοιχη θέση:

```json
    "end_confirm_title": "End and archive?",
    "end_confirm_body": "Billing stops, the service is marked completed and the card moves to Archived. The assignee will be notified.",
    "end_confirm_unpaid": "WARNING: there is an unpaid balance of {{amount}} — it stays owed by the client.",
    "archived_badge": "Archived",
```

- [ ] **Step 7: Σύνδεσε το κουμπί End με τη νέα RPC**

Στο `src/features/deals/JobsBillingPanel.tsx`:

1. Στα imports πρόσθεσε:

```ts
import { useEndArchiveJob, useJobUnpaidTotal } from './hooks/useEndArchiveJob';
import { endConfirmBody } from './endArchiveCopy';
```

2. Δίπλα στο υπάρχον `const end = useEndJob(dealId);` (γραμμή ~108) πρόσθεσε:

```ts
  const endArchive = useEndArchiveJob(dealId);
  // Το υπόλοιπο το ζητάμε μόνο όταν ανοίξει το παράθυρο — όχι σε κάθε γραμμή.
  const { unpaid } = useJobUnpaidTotal(job.id, confirmEnd);
```

(Το `confirmEnd` state υπάρχει ήδη στη γραμμή ~129· το `useJobUnpaidTotal` πρέπει να δηλωθεί **μετά** από αυτό.)

3. Στο `<ConfirmDialog>` του End (γραμμές ~477-492) άλλαξε `description` και `onConfirm`:

```tsx
            description={endConfirmBody(t, unpaid)}
            confirmLabel={t('jobs_billing.end')}
            pending={endArchive.isPending}
            onConfirm={async () => {
              try {
                await endArchive.mutateAsync(job.id);
                setConfirmEnd(false);
              } catch (err) {
                reportError(t, err);
              }
            }}
```

4. Άλλαξε το `disabled={end.isPending}` του κουμπιού End σε `disabled={endArchive.isPending}`.

5. Αν μετά από αυτό το `useEndJob` δεν χρησιμοποιείται πουθενά αλλού στο αρχείο, αφαίρεσε το `const end = useEndJob(dealId);` και το import του — **μόνο** αν το `npx tsc` το επιβεβαιώσει ως αχρησιμοποίητο (το `useEndJob` παραμένει στο `useCustomJobMutations.ts` για ό,τι άλλο το καλεί).

- [ ] **Step 8: Τρέξε tests, typecheck και lint**

```bash
npx vitest run src/features/deals
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/features/deals/endArchiveCopy.ts src/features/deals/endArchiveCopy.test.ts src/features/deals/hooks/useEndArchiveJob.ts src/features/deals/JobsBillingPanel.tsx
```

Expected: όλα πράσινα/καθαρά. Αν το υπάρχον `JobsBillingPanel.test.tsx` σπάσει επειδή περιμένει το παλιό `end_job` mock, ενημέρωσέ το ώστε να κοροϊδεύει το `end_and_archive_job` — **μην** αφαιρέσεις assertions.

- [ ] **Step 9: Commit**

```bash
git add src/features/deals src/i18n/locales/el/deals.json src/i18n/locales/en/deals.json
git commit -m "feat(jobs): End now ends and archives, with unpaid-balance warning in the confirm dialog"
```

---

### Task 3: Το αρχειοθετημένο job μένει ορατό στο deal, γκριζαρισμένο

**Files:**
- Modify: `src/features/jobs/hooks/useJobsForDeal.ts:18`
- Modify: `src/features/deals/JobsBillingPanel.tsx`
- Modify: `src/features/deals/JobsBillingPanel.test.tsx`

**Interfaces:**
- Consumes (Task 2): το i18n key `jobs_billing.archived_badge`.
- Produces: τίποτα που να καταναλώνουν επόμενα tasks.

- [ ] **Step 1: Γράψε το failing test**

Στο `src/features/deals/JobsBillingPanel.test.tsx` πρόσθεσε (μέσα στο υπάρχον `describe`, ακολουθώντας τα υπάρχοντα mocks του αρχείου για jobs):

```tsx
  it('η αρχειοθετημένη υπηρεσία φαίνεται με σήμανση και χωρίς κουμπιά δράσης', () => {
    renderPanelWithJobs([
      { ...baseJob, id: 'j-archived', title: 'Local Seo', archived: true, billing_active: false },
    ]);
    expect(screen.getByText('jobs_billing.archived_badge')).toBeInTheDocument();
    expect(screen.queryByText('jobs_billing.end')).not.toBeInTheDocument();
    expect(screen.queryByText('jobs_billing.pause.pause')).not.toBeInTheDocument();
    expect(screen.queryByText('jobs_billing.convert')).not.toBeInTheDocument();
  });
```

Αν το test αρχείο δεν έχει helper `renderPanelWithJobs`/`baseJob`, χρησιμοποίησε το ακριβές μοτίβο render + fixtures που ήδη υπάρχει στο αρχείο και προσάρμοσε το όνομα — μην εφεύρεις νέο helper αν υπάρχει ήδη ισοδύναμος.

- [ ] **Step 2: Τρέξε το test και δες ότι αποτυγχάνει**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx`
Expected: FAIL — το badge δεν υπάρχει (και τα κουμπιά εμφανίζονται).

- [ ] **Step 3: Φέρε τα archived jobs στο deal**

Στο `src/features/jobs/hooks/useJobsForDeal.ts` **αφαίρεσε** τη γραμμή 18:

```ts
        .eq('archived', false)
```

και πρόσθεσε ακριβώς από πάνω το σχόλιο:

```ts
        // Τα αρχειοθετημένα ΜΕΝΟΥΝ εδώ (απόφαση ιδιοκτήτη 2026-09-04): το
        // accounting πρέπει να βλέπει το οικονομικό ιστορικό της υπηρεσίας στο
        // deal. Το JobsBillingPanel τα δείχνει read-only με σήμανση.
```

- [ ] **Step 4: Γκριζάρισε τη γραμμή και κρύψε τις δράσεις**

Στο `src/features/deals/JobsBillingPanel.tsx`:

1. Δίπλα στο υπάρχον `const ended = job.status === 'ended' || job.billing_active === false;` (γραμμή ~145) πρόσθεσε:

```ts
  // Αρχειοθετημένο = τελείωσε οριστικά: μόνο ανάγνωση, καμία δράση, καμία
  // αλλαγή τιμής ή κύκλου χρέωσης.
  const isArchived = job.archived === true;
```

2. Άλλαξε το `readOnly` ώστε να καλύπτει και το archived. Βρες πού ορίζεται το `readOnly` στο component και άλλαξέ το σε:

```ts
  const rowReadOnly = readOnly || isArchived;
```

και **αντικατέστησε κάθε χρήση του `readOnly` μέσα σε αυτό το row component με `rowReadOnly`** (είναι οι έλεγχοι `readOnly ? ... : ...` για την τιμή, και τα `!readOnly &&` για Convert / Pause / End / dialogs). Μην αγγίξεις το prop `readOnly` που έρχεται από πάνω.

3. Στο κελί του τίτλου (εκεί που ήδη μπαίνει το `custom` badge, γραμμές ~239-245) πρόσθεσε μετά το custom badge:

```tsx
        {isArchived && (
          <span className="ml-1 rounded bg-muted px-1 text-[9px] font-medium uppercase text-muted-foreground">
            {t('jobs_billing.archived_badge')}
          </span>
        )}
```

4. Στο `<tr className="border-t">` (γραμμή ~237) άλλαξε σε:

```tsx
    <tr className={cn('border-t', isArchived && 'opacity-60')}>
```

(Το `cn` είναι ήδη importαρισμένο στο αρχείο· αν όχι, `import { cn } from '@/lib/utils';`.)

- [ ] **Step 5: Τρέξε το test και δες ότι περνάει**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Έλεγξε ότι δεν χάλασε το άθροισμα**

Το PRICING SUMMARY του deal δεν πρέπει να μετράει αρχειοθετημένες υπηρεσίες. Ψάξε στο `JobsBillingPanel.tsx` για το σημείο που αθροίζει (`reduce`, `subtotal`, `Σύνολο`) και βεβαιώσου ότι φιλτράρει `!j.archived`. Αν δεν φιλτράρει, πρόσθεσε το φίλτρο και ένα test:

```tsx
  it('το σύνολο τιμών αγνοεί τις αρχειοθετημένες υπηρεσίες', () => {
    renderPanelWithJobs([
      { ...baseJob, id: 'j1', amount_net: 100, archived: false },
      { ...baseJob, id: 'j2', amount_net: 999, archived: true },
    ]);
    expect(screen.queryByText(/1[.,]099/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx vitest run src/features/deals src/features/jobs
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/features/deals/JobsBillingPanel.tsx src/features/jobs/hooks/useJobsForDeal.ts
git add src/features/deals src/features/jobs/hooks/useJobsForDeal.ts
git commit -m "feat(deals): archived services stay in JOBS & BILLING, read-only with a badge"
```

---

### Task 4: Στήλη «Αρχειοθετημένα» στα 6 kanban boards (μόνο admin) + επαναφορά

**Files:**
- Create: `src/features/jobs/hooks/useArchivedJobs.ts`
- Create: `src/features/jobs/hooks/useUnarchiveJob.ts`
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/features/jobs/JobsKanbanPage.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx`
- Create: `src/features/jobs/archivedColumn.test.ts`
- Create: `src/features/jobs/archivedColumn.ts`
- Modify: `src/i18n/locales/el/jobs.json`, `src/i18n/locales/en/jobs.json`

**Interfaces:**
- Consumes (Task 1): RPC `unarchive_job(p_job_id uuid)`.
- Produces:
  - `showArchivedColumn(isAdmin: boolean, jobs: { archived: boolean }[]): boolean` από `archivedColumn.ts`
  - `useArchivedJobs(serviceType: ServiceType, enabled: boolean)` → `{ jobs: JobRow[] }`
  - `useUnarchiveJob(jobId: string)` → `{ mutateAsync(), isPending }`
  - `queryKeys.archivedJobsByService(serviceType: string)`

- [ ] **Step 1: Γράψε το failing test για τον κανόνα ορατότητας**

Δημιούργησε `src/features/jobs/archivedColumn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { showArchivedColumn } from './archivedColumn';

describe('showArchivedColumn', () => {
  it('οι μη-admin δεν βλέπουν ποτέ τη στήλη, ακόμη κι αν υπάρχουν αρχειοθετημένα', () => {
    expect(showArchivedColumn(false, [{ archived: true }])).toBe(false);
  });

  it('ο admin τη βλέπει όταν υπάρχει έστω ένα αρχειοθετημένο', () => {
    expect(showArchivedColumn(true, [{ archived: true }])).toBe(true);
  });

  it('ο admin δεν τη βλέπει σε άδειο board — καμία κενή στήλη χωρίς λόγο', () => {
    expect(showArchivedColumn(true, [])).toBe(false);
    expect(showArchivedColumn(true, [{ archived: false }])).toBe(false);
  });
});
```

- [ ] **Step 2: Τρέξε και δες ότι αποτυγχάνει**

Run: `npx vitest run src/features/jobs/archivedColumn.test.ts`
Expected: FAIL — `Failed to resolve import "./archivedColumn"`.

- [ ] **Step 3: Υλοποίησε τον κανόνα**

Δημιούργησε `src/features/jobs/archivedColumn.ts`:

```ts
/**
 * Η στήλη «Αρχειοθετημένα» είναι ΜΟΝΟ για admin (απόφαση ιδιοκτήτη 2026-09-04)
 * και εμφανίζεται μόνο όταν έχει περιεχόμενο — αλλιώς κάθε board θα κουβαλούσε
 * μια μόνιμα άδεια στήλη στο τέλος.
 */
export function showArchivedColumn(isAdmin: boolean, jobs: { archived: boolean }[]): boolean {
  return isAdmin && jobs.some((j) => j.archived);
}
```

- [ ] **Step 4: Τρέξε και δες ότι περνάει**

Run: `npx vitest run src/features/jobs/archivedColumn.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Πρόσθεσε το query key**

Στο `src/lib/queryKeys.ts`, δίπλα στο υπάρχον `jobsByService`, πρόσθεσε:

```ts
  archivedJobsByService: (serviceType: string) => ['jobs', 'service', serviceType, 'archived'] as const,
```

- [ ] **Step 6: Γράψε το hook των αρχειοθετημένων**

Δημιούργησε `src/features/jobs/hooks/useArchivedJobs.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { JobRow, ServiceType } from './useJobs';

// Ίδιο select με το useJobs, αλλά ΜΟΝΟ τα αρχειοθετημένα. Ξεχωριστό query key
// ώστε η κανονική λίστα του board να μη μεγαλώνει και να μην ξαναφορτώνεται
// όταν αλλάζει κάτι στα αρχειοθετημένα.
const ARCHIVED_COLS =
  '*, parent_job_id, client:clients(id, code, name, contact_first_name, contact_last_name, email, phone, phone_normalized, website, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)';

export function useArchivedJobs(serviceType: ServiceType, enabled: boolean): { jobs: JobRow[] } {
  const query = useQuery({
    queryKey: queryKeys.archivedJobsByService(serviceType),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(ARCHIVED_COLS)
        .eq('service_type', serviceType)
        .eq('archived', true)
        .order('archived_at', { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
  });
  return { jobs: query.data ?? [] };
}
```

- [ ] **Step 7: Γράψε το hook επαναφοράς**

Δημιούργησε `src/features/jobs/hooks/useUnarchiveJob.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type RpcResult = { ok: boolean; errors?: string[] };

/** Επαναφορά αρχειοθετημένου job — μόνο admin (ο server το επιβάλλει επίσης). */
export function useUnarchiveJob(jobId: string, serviceType: string) {
  const qc = useQueryClient();
  return useMutation<RpcResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('unarchive_job' as never, {
        p_job_id: jobId,
      } as never);
      if (error) throw new Error(error.message);
      const result = data as unknown as RpcResult;
      if (!result?.ok) throw new Error(result?.errors?.[0] ?? 'unarchive_failed');
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.archivedJobsByService(serviceType) });
      void qc.invalidateQueries({ queryKey: queryKeys.jobsByService(serviceType) });
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
    },
  });
}
```

(Αν το `queryKeys.job(jobId)` έχει άλλο όνομα στο `src/lib/queryKeys.ts`, χρησιμοποίησε το υπάρχον.)

- [ ] **Step 8: Πρόσθεσε τη συνθετική στήλη στο board**

Στο `src/features/jobs/JobsKanbanPage.tsx`:

1. Imports:

```ts
import { useArchivedJobs } from './hooks/useArchivedJobs';
import { showArchivedColumn } from './archivedColumn';
```

2. Μετά το υπάρχον `const isAdmin = useAuthStore((s) => s.isAdmin);` (γραμμή ~82) πρόσθεσε:

```ts
  // Μόνο οι admin φορτώνουν αρχειοθετημένα — για τους υπόλοιπους το query
  // δεν τρέχει καν.
  const { jobs: archivedJobs } = useArchivedJobs(serviceType, isAdmin);
```

3. Αμέσως μετά τη συνθετική στήλη «Μπλοκαρισμένο» (γραμμές ~236-243), πρόσθεσε:

```tsx
          {showArchivedColumn(isAdmin, archivedJobs) && (
            <JobsKanbanColumn
              stageId="__archived__"
              stageCode="archived"
              stageIndex={boardStages.length + 1}
              stageLabel={t('board.archived', { defaultValue: lang === 'el' ? 'Αρχειοθετημένα' : 'Archived' })}
              jobs={archivedJobs}
              interactive={false}
            />
          )}
```

Αν το component δεν έχει ήδη `t` από `useTranslation('jobs')`, χρησιμοποίησε **μόνο** το `lang === 'el' ? 'Αρχειοθετημένα' : 'Archived'` (χωρίς `t`) και παράλειψε το Step 10 — μην προσθέσεις νέο `useTranslation` namespace μόνο γι' αυτό.

**Κρίσιμο:** το `interactive={false}` κάνει τη στήλη μη-drop-target — δεν αρχειοθετείται τίποτα με drag· η αρχειοθέτηση γίνεται **μόνο** από το End.

- [ ] **Step 9: Επαναφορά από τη σελίδα του job (και αφαίρεση του παλιού stub)**

Στο `src/features/jobs/JobDetailPage.tsx`:

1. **Αφαίρεσε** το παλιό κουμπί Archive (γραμμές ~408-417, το `{canEditBilling && !job.archived && (<Button …>Archive</Button>)}`), τη συνάρτηση `onArchive` (γραμμές ~243-259), το `confirmArchive` state (γραμμή ~129) και το `<ConfirmDialog open={confirmArchive} …>` (γραμμές ~831-838).
   *Λόγος:* έκανε κατευθείαν `update` στον πίνακα, χωρίς μετάφραση, χωρίς audit (`archived_by` έμενε κενό), χωρίς ειδοποίηση και χωρίς τρόπο επαναφοράς. Το End είναι πλέον η μοναδική διαδρομή αρχειοθέτησης.

2. Πρόσθεσε στη θέση του, admin-only, το κουμπί επαναφοράς:

```tsx
            {isAdmin && job.archived && (
              <Button
                variant="outline"
                size="sm"
                className={detailHeaderActionButtonClass}
                onClick={() => setConfirmRestore(true)}
                disabled={unarchive.isPending}
              >
                <ArchiveRestore className="size-3" />
                {t('archive.restore')}
              </Button>
            )}
```

με `import { ArchiveRestore } from 'lucide-react';` (και αφαίρεσε το πλέον αχρησιμοποίητο `Archive` από το ίδιο import), `const [confirmRestore, setConfirmRestore] = useState(false);`, `const unarchive = useUnarchiveJob(job.id, job.service_type);` και το dialog:

```tsx
      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={t('archive.restore_confirm_title')}
        description={t('archive.restore_confirm_body')}
        confirmLabel={t('archive.restore')}
        pending={unarchive.isPending}
        onConfirm={async () => {
          await unarchive.mutateAsync();
          setConfirmRestore(false);
        }}
      />
```

Το `isAdmin` παίρνεται με `useAuthStore((s) => s.isAdmin)` αν δεν υπάρχει ήδη στο component.

3. Πρόσθεσε ένα σήμα στο header όταν το job είναι αρχειοθετημένο, ώστε να μην μπερδεύεται κανείς:

```tsx
            {job.archived && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {t('archive.badge')}
              </span>
            )}
```

- [ ] **Step 10: i18n**

Στο `src/i18n/locales/el/jobs.json` πρόσθεσε στο ανώτερο επίπεδο:

```json
  "archive": {
    "badge": "Αρχειοθετημένο",
    "restore": "Επαναφορά",
    "restore_confirm_title": "Επαναφορά από τα αρχειοθετημένα;",
    "restore_confirm_body": "Η κάρτα επιστρέφει στο board, στη στήλη Κλειστά. Η χρέωση ΔΕΝ ξαναρχίζει — αν χρειάζεται, χρησιμοποίησε το Resume billing."
  },
  "board": { "archived": "Αρχειοθετημένα" },
```

Στο `src/i18n/locales/en/jobs.json`:

```json
  "archive": {
    "badge": "Archived",
    "restore": "Restore",
    "restore_confirm_title": "Restore from archive?",
    "restore_confirm_body": "The card returns to the board, in the Closed column. Billing does NOT restart — use Resume billing if needed."
  },
  "board": { "archived": "Archived" },
```

Αν τα αρχεία έχουν ήδη κλειδί `board`, **συγχώνευσε** μέσα του το `archived` αντί να προσθέσεις δεύτερο κλειδί (θα ήταν άκυρο JSON).

- [ ] **Step 11: Tests, typecheck, lint, commit**

```bash
npx vitest run src/features/jobs
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/features/jobs/archivedColumn.ts src/features/jobs/hooks/useArchivedJobs.ts src/features/jobs/hooks/useUnarchiveJob.ts src/features/jobs/JobsKanbanPage.tsx src/features/jobs/JobDetailPage.tsx
git add src/features/jobs src/lib/queryKeys.ts src/i18n/locales/el/jobs.json src/i18n/locales/en/jobs.json
git commit -m "feat(jobs): admin-only Archived column on every kanban board, with restore"
```

---

### Task 5: Ειδοποίηση «η υπηρεσία τελείωσε» στον υπεύθυνο

**Files:**
- Modify: `src/features/notifications/notification-presenters.tsx`
- Modify: `src/features/notifications/NotificationsColumn.tsx`
- Modify: `src/features/notifications/toastableTypes.ts`
- Modify: `src/i18n/locales/el/notifications.json`, `src/i18n/locales/en/notifications.json`
- Create/Modify: `src/features/notifications/notification-presenters.test.tsx`

**Interfaces:**
- Consumes (Task 1): notification `type = 'job_archived'` με payload `{ job_id, service_type, job_code, job_title, client_name, unpaid_total, parent_type: 'job', parent_id }`.

- [ ] **Step 1: Γράψε το failing test**

Στο `src/features/notifications/notification-presenters.test.tsx` (αν δεν υπάρχει, δημιούργησέ το με τα ίδια mocks που χρησιμοποιούν τα άλλα tests του φακέλου για `react-i18next`):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CompactNotificationContent, readPath } from './notification-presenters';

describe('job_archived notification', () => {
  it('δείχνει τον πελάτη και την υπηρεσία', () => {
    render(
      <CompactNotificationContent
        type="job_archived"
        payload={{ client_name: 'ACME', job_title: 'Local Seo', parent_type: 'job', parent_id: 'j1' }}
        isRead={false}
        createdAt="2026-09-04T10:00:00Z"
      />,
    );
    expect(screen.getByText(/ACME/)).toBeInTheDocument();
  });

  it('οδηγεί στην κάρτα του job', () => {
    expect(readPath({ parent_type: 'job', parent_id: 'j1' })).toBe('/jobs/j1');
  });
});
```

Προσάρμοσε τα props στα **ακριβή** ονόματα που δέχεται το `CompactNotificationContent` στο υπάρχον αρχείο (`{type, payload, parentLabel, isRead, createdAt}`).

- [ ] **Step 2: Τρέξε και δες ότι αποτυγχάνει**

Run: `npx vitest run src/features/notifications`
Expected: FAIL — το `job_archived` πέφτει στο generic fallback και δεν τυπώνει το όνομα πελάτη.

- [ ] **Step 3: Πρόσθεσε εικονίδιο και κείμενο**

Στο `src/features/notifications/notification-presenters.tsx`:

1. Στο import των lucide icons πρόσθεσε `Archive`.
2. Στο switch της `NotifIcon` πρόσθεσε πριν το default:

```tsx
    case 'job_archived':
      return <Archive className="size-3.5 text-muted-foreground" />;
```

3. Στη `CompactNotificationContent`, δίπλα στα υπόλοιπα `if (type === '...')` blocks, πρόσθεσε:

```tsx
  if (type === 'job_archived') {
    const client = String(payload.client_name ?? '');
    const title = String(payload.job_title ?? '');
    return (
      <span className={isRead ? 'text-muted-foreground' : 'text-foreground'}>
        {t('job_archived.title')}
        {(client || title) && ' · '}
        {[title, client].filter(Boolean).join(' — ')}
      </span>
    );
  }
```

Ακολούθησε **ακριβώς** το layout/wrapper markup που χρησιμοποιούν τα γειτονικά blocks του αρχείου (π.χ. το `job_created`) — τίτλος/χρόνος/κλάσεις πρέπει να είναι ίδια, όχι δικά σου.

4. Στο `src/features/notifications/NotificationsColumn.tsx`, στο **διπλότυπο** `NotifIcon` switch (γραμμές ~19-34), πρόσθεσε την ίδια `case 'job_archived'` με το ίδιο εικονίδιο. (Ναι, το icon map είναι διπλό σε αυτό το repo· αν λείψει, το πλαϊνό panel δείχνει άλλο εικονίδιο από την καμπάνα.)

- [ ] **Step 4: Κάνε το toastable**

Στο `src/features/notifications/toastableTypes.ts` πρόσθεσε `'job_archived'` στο `TOASTABLE_TYPES` set — ο υπεύθυνος πρέπει να το δει τη στιγμή που συμβαίνει, όχι μόνο στην καμπάνα.

- [ ] **Step 5: i18n**

`src/i18n/locales/el/notifications.json`:

```json
  "job_archived": { "title": "Η υπηρεσία ολοκληρώθηκε και αρχειοθετήθηκε" },
```

`src/i18n/locales/en/notifications.json`:

```json
  "job_archived": { "title": "Service completed and archived" },
```

(Χρησιμοποίησε το namespace/nesting που ήδη χρησιμοποιεί το `notification-presenters.tsx` για τα άλλα types — αν τα υπόλοιπα κλειδιά είναι επίπεδα, κάνε το ίδιο.)

- [ ] **Step 6: Τρέξε και δες ότι περνάει**

Run: `npx vitest run src/features/notifications`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/features/notifications
git add src/features/notifications src/i18n/locales/el/notifications.json src/i18n/locales/en/notifications.json
git commit -m "feat(notifications): job_archived tells the assignee their service is over"
```

---

### Task 6: Φίλτρο «Αρχειοθετημένα» στις 3 λίστες (Hosting, Domains, Maintenance)

**Files:**
- Modify: `src/features/hosting/HostingListPage.tsx`
- Modify: `src/features/domains/DomainsListPage.tsx`
- Modify: `src/features/support/SupportListPage.tsx`
- Modify: `src/i18n/locales/el/jobs.json`, `src/i18n/locales/en/jobs.json`

**Interfaces:**
- Consumes (Task 4): `queryKeys.archivedJobsByService`, `useArchivedJobs`, το i18n `board.archived`.

**Γιατί ξεχωριστό task:** αυτά τα τρία technical boards δεν είναι kanban — δεν έχουν στήλες, οπότε το «στήλη στο τέλος» γίνεται admin-only διακόπτης που εναλλάσσει τη λίστα.

- [ ] **Step 1: Διάβασε πώς φορτώνει η κάθε λίστα**

Run:

```bash
grep -n "useJobs\|archived\|useQuery" src/features/hosting/HostingListPage.tsx src/features/domains/DomainsListPage.tsx src/features/support/SupportListPage.tsx | head -30
```

Κράτησε ποιο hook τροφοδοτεί την κάθε σελίδα. Αν και οι τρεις χρησιμοποιούν το `useJobs(serviceType)`, το βήμα 2 είναι ίδιο και για τις τρεις.

- [ ] **Step 2: Πρόσθεσε τον διακόπτη**

Σε κάθε μία από τις τρεις σελίδες:

```tsx
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [showArchived, setShowArchived] = useState(false);
  const { jobs: archivedJobs } = useArchivedJobs(SERVICE_TYPE, isAdmin && showArchived);
  const rows = showArchived ? archivedJobs : activeRows;
```

όπου `SERVICE_TYPE` είναι `'hosting'`, `'domains'`, `'maintenance'` αντίστοιχα και `activeRows` το υπάρχον array που ήδη ρεντάρει η σελίδα. Το κουμπί, δίπλα στα υπάρχοντα φίλτρα της σελίδας:

```tsx
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              showArchived
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {t('board.archived')} ({archivedJobs.length})
          </button>
        )}
```

Αν η σελίδα δεν έχει `useTranslation('jobs')`, χρησιμοποίησε το namespace που ήδη έχει και βάλε το κλειδί εκεί — μην προσθέσεις δεύτερο `useTranslation`.

- [ ] **Step 3: Έλεγχος στον browser λογικά (χωρίς browser)**

Run:

```bash
npx tsc --noEmit -p tsconfig.app.json
npx vitest run src/features/hosting src/features/domains src/features/support
npx eslint src/features/hosting src/features/domains src/features/support
```

Expected: όλα καθαρά. Αν υπάρχουν υπάρχοντα tests αυτών των σελίδων, πρέπει να συνεχίσουν να περνούν χωρίς αλλαγή (το default `showArchived=false` διατηρεί την τρέχουσα συμπεριφορά).

- [ ] **Step 4: Commit**

```bash
git add src/features/hosting src/features/domains src/features/support src/i18n/locales/el/jobs.json src/i18n/locales/en/jobs.json
git commit -m "feat(jobs): admin-only Archived filter on the hosting, domains and maintenance lists"
```

---

### Task 7: RLS — τα αρχειοθετημένα ορατά μόνο σε admin και accounting

**Files:**
- Create: `supabase/migrations/20260904210000_archived_jobs_admin_visibility.sql`

**Interfaces:**
- Consumes: την τρέχουσα select policy του `jobs`.

**⚠️ ΣΥΝΤΟΝΙΣΜΟΣ ΠΡΙΝ ΤΗΝ ΕΚΤΕΛΕΣΗ:** ένα παράλληλο session βελτιστοποιεί αυτή τη στιγμή ακριβώς αυτή την policy (`20260904110000_rls_initplan_hot_tables.sql`, `20260904130000_rls_board_array_no_per_row_calls.sql`). Ο controller **πρέπει** να στείλει μήνυμα και να πάρει απάντηση πριν ξεκινήσει αυτό το task, και να χτίσει πάνω στο **τελευταίο** σώμα της policy, όχι σε αυτό που βλέπει στο git.

- [ ] **Step 1: Πάρε το τρέχον σώμα της policy**

Ο controller εκτελεί (με το token του ιδιοκτήτη):

```sql
select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'jobs_select';
```

(Αν το όνομα δεν είναι `jobs_select`, βρες το με `select polname from pg_policy where polrelid = 'public.jobs'::regclass;`.)

- [ ] **Step 2: Γράψε το migration**

Το migration ξαναγράφει την policy **αυτούσια**, τυλίγοντάς την σε μια πρόσθετη συνθήκη:

```sql
-- =============================================================================
-- 20260904210000_archived_jobs_admin_visibility.sql
-- Τα αρχειοθετημένα jobs δεν είναι απλώς κρυμμένα στο UI (απόφαση ιδιοκτήτη
-- 2026-09-04: «θα είναι hidden από όλους εκτός τους admin») — τα κόβουμε και
-- στη βάση. Το accounting τα κρατάει γιατί τα βλέπει στο JOBS & BILLING του
-- deal (ίδια απόφαση).
-- ΠΡΟΣΟΧΗ: το <ΤΡΕΧΟΝ ΣΩΜΑ> αντιγράφεται ΑΥΤΟΥΣΙΟ από το Step 1.
-- =============================================================================
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select using (
  (
    -- <ΤΡΕΧΟΝ ΣΩΜΑ ΤΗΣ POLICY — αυτούσιο>
  )
  and (
    not archived
    or public.current_user_is_admin()
    or public.current_user_in_group('accounting')
  )
);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260904210000_archived_jobs_admin_visibility.sql
git commit -m "feat(jobs): archived jobs are visible only to admins and accounting"
```

---

### Task 8: Εφαρμογή στην παραγωγή και επαλήθευση (controller)

**Files:** καμία αλλαγή κώδικα.

Αυτό το task το εκτελεί **ο controller** (χρειάζεται το Management API token του ιδιοκτήτη — ο implementer δεν έχει πρόσβαση σε βάση).

- [ ] **Step 1: Ενημέρωσε τα παράλληλα sessions**

Μήνυμα και στα δύο peer sockets: «εφαρμόζω τα 20260904200000 (νέες RPCs, καμία υπάρχουσα δεν αλλάζει) και 20260904210000 (ξαναγράφει την jobs select policy)». Περίμενε απάντηση για το δεύτερο.

- [ ] **Step 2: Εφάρμοσε τα migrations**

Με το καθιερωμένο flow (`POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, header `User-Agent: supabase-cli/2.0.0`), και **σβήσε το token αμέσως μετά**.

- [ ] **Step 3: Probe — δικαιώματα και συμπεριφορά, με rollback**

```sql
do $$
declare v_res jsonb; v_job uuid;
begin
  select id into v_job from public.jobs where not archived and service_type = 'local_seo' limit 1;
  perform set_config('role', 'authenticated', true);
  -- τεχνικός χρήστης: πρέπει να απορριφθεί
  perform set_config('request.jwt.claims', '{"sub":"<TECH_UUID>","role":"authenticated"}', true);
  v_res := public.end_and_archive_job(v_job);
  raise exception 'RESULT :: tech=% (θέλουμε permission_denied) — rolled back', v_res;
end $$;
```

Επανάλαβε με uuid μέλους accounting: αναμένεται `ok=true`, `notified>=0`, και ότι το job έγινε `archived=true`, `archived_by` = ο δράστης, με σχόλιο στο timeline. **Πάντα** με `raise exception` στο τέλος ώστε να γίνεται rollback.

- [ ] **Step 4: Probe — ορατότητα αρχειοθετημένων (μετά το Task 7)**

Με impersonation ενός τεχνικού: `select count(*) from public.jobs where archived;` → αναμένεται `0`. Με admin: `6` ή περισσότερα.

- [ ] **Step 5: Έλεγχος ότι δεν έσπασε τίποτα οικονομικό**

```sql
select count(*) from public.jobs where archived and billing_active;
```

Αναμένεται `0` (κανένα αρχειοθετημένο δεν χρεώνει).

- [ ] **Step 6: Ενημέρωσε τον ιδιοκτήτη**

Ανάφερε: πόσα jobs είναι αρχειοθετημένα σήμερα (τα 6 ιστορικά θα εμφανιστούν στη νέα στήλη), ότι το παλιό κουμπί Archive αφαιρέθηκε, και ότι η επαναφορά είναι πλέον δυνατή μόνο από admin.

---

## Τι ΔΕΝ κάνει αυτό το πλάνο (και γιατί)

- **Δεν αγγίζει το `end_job`** — μένει στη βάση για ό,τι το καλεί ήδη· απλώς το UI δεν το καλεί πια από το JOBS & BILLING.
- **Δεν ξεκινά/σταματά χρεώσεις πέρα από ό,τι έκανε ήδη το End.** Οι ανεξόφλητες γραμμές παραμένουν χρεωμένες (απόφαση ιδιοκτήτη): αν πρέπει να διαγραφούν, αυτό είναι δουλειά του Pause billing, που τις ακυρώνει ρητά.
- **Δεν διαγράφει τίποτα.** Το `delete_jobs` (σκληρή διαγραφή) παραμένει ξεχωριστό και admin/accounting-gated.
- **Δεν φτιάχνει σελίδα «Αρχείο»** συγκεντρωτικά για όλα τα boards. Αν χρειαστεί, είναι μικρή προσθήκη πάνω στο `useArchivedJobs`.

## Self-Review

**Κάλυψη απαιτήσεων ιδιοκτήτη**

| Απαίτηση | Task |
|---|---|
| Το End (accounting) πάει το job στα αρχειοθετημένα | 1, 2 |
| Παράθυρο «Είσαι σίγουρος;» πριν προχωρήσει | 2 |
| Στήλη «Αρχειοθετημένα» στο τέλος κάθε technical board | 4 (kanban), 6 (λίστες) |
| Κρυφή από όλους εκτός admin | 4 (UI), 7 (βάση) |
| Ειδοποίηση στον υπεύθυνο ότι το job τελείωσε | 1 (insert), 5 (εμφάνιση) |

**Έλεγχος τύπων/ονομάτων:** `showArchivedColumn`, `useArchivedJobs`, `useUnarchiveJob`, `useEndArchiveJob`, `useJobUnpaidTotal`, `endConfirmBody`, `queryKeys.archivedJobsByService`, RPCs `end_and_archive_job` / `unarchive_job` / `job_unpaid_total` — χρησιμοποιούνται με τα ίδια ονόματα σε όλα τα tasks. Η στήλη υπεύθυνου είναι παντού `owner_user_id`. Ο πίνακας σχολίων χρησιμοποιεί `author_id` (όχι `author_user_id`).
