# Team leads + auto-assign new jobs + admin full visibility

> Use superpowers:executing-plans. Each task ends in a commit.

## Problem & desired behaviour

Currently, when a deal moves to `partial_payment` / `paid_in_full`, `release_jobs_for_deal` creates jobs with `owner_user_id = null` (unassigned). Tech kanbans default to a **"Only mine"** filter that keys off `owner_user_id === auth.uid()`, so new jobs are invisible by default and the team has to know to flip the chip.

What you want:

1. **Departments map to tech groups already** (`web_seo`, `local_seo`, `web_dev`, `social_media`, `hosting`, `ads`). Each tech group has its own kanban + My Clients page already gated by `RequireGroup`.
2. **Multiple users per department.**
3. **Each department has a team leader,** allocated by the admin from a "Teams Settings" page.
4. **New jobs auto-assign to the team lead** of that service_type's group. Lead manages distribution from there (reassign via the existing owner picker on the job detail page).
5. **Admin sees everything**, even jobs not allocated to them — the "Only mine" filter should not apply to admin.
6. **Admin configures per-department visibility** via the existing permissions engine (`/admin/groups/:id/permissions`) — already there from Phase 2; we'll surface the team-lead control on the same surface.

## Default decisions (override if wrong)

- **`is_team_lead` lives on `user_groups`** (the existing user↔group join), not on `groups`. Lets a department have **multiple leads** if you ever need that, and lets the same user be lead in multiple groups (e.g. a senior who leads Web SEO and AI SEO).
- When picking *the* lead for auto-assignment we deterministically pick **the earliest-assigned lead** (oldest `user_groups.created_at`). Tie-break by user_id.
- If a group has **no team lead yet**, auto-assignment leaves `owner_user_id = null` (no-op) so nothing 500s; admin gets a console-like surface to spot unassigned jobs.
- **Backfill once**: existing unassigned jobs get auto-assigned to their group's lead at migration time. Reversible (the lead can always reassign).

## File map

**New files:**
- `supabase/migrations/20260511000002_team_leads.sql` — adds `user_groups.is_team_lead`, helper functions, updates `release_jobs_for_deal`, backfills existing unassigned jobs.
- `src/features/users/hooks/useSetTeamLead.ts` — toggle a user's `is_team_lead` flag for a given group.
- `src/features/permissions/TeamLeadsBadge.tsx` — small list of current leads shown on the group permissions page.

**Modified files:**
- `src/features/users/UserDetailPage.tsx` — in the user's groups section, render a "Team lead" checkbox per assigned group.
- `src/features/permissions/GroupPermissionsPage.tsx` — show the group's current team leads at the top.
- `src/features/jobs/JobsKanbanPage.tsx` — admin bypasses the "Only mine" filter (no chip visible, always shows everything).
- `src/lib/queryKeys.ts` — `teamLeads(groupCode)`.

---

## Task 1: Schema — `is_team_lead` flag + assignment helpers

**Files:** Create `supabase/migrations/20260511000002_team_leads.sql`.

- [ ] **Step 1: Migration**

```sql
-- 1. Per-user-per-group lead flag.
alter table public.user_groups
  add column if not exists is_team_lead boolean not null default false;

create index if not exists user_groups_team_leads
  on public.user_groups (group_id) where is_team_lead = true;

-- 2. Helper: resolve the team lead's user_id for a service_type group.
--    Picks the earliest-assigned lead so the choice is deterministic.
create or replace function public.team_lead_for_group(p_group_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ug.user_id
    from public.user_groups ug
    join public.groups g on g.id = ug.group_id
   where g.code = p_group_code
     and ug.is_team_lead = true
   order by ug.created_at asc, ug.user_id asc
   limit 1;
$$;

grant execute on function public.team_lead_for_group(text) to authenticated;

-- 3. release_jobs_for_deal: set owner_user_id from team_lead_for_group()
--    so new jobs land on the team lead's plate by default. NULL is fine
--    (group has no lead yet) — the kanban still shows them.
create or replace function public.release_jobs_for_deal(
  target_deal_id uuid,
  partial_payment_mode boolean
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  d record;
  service jsonb;
  service_type_val text;
  stage_board text;
  billing_type_val text;
  one_time_amt numeric;
  monthly_amt numeric;
  setup_fee_val numeric;
  group_id_val uuid;
  owner_id_val uuid;
  job_stage_id uuid;
  inserted int := 0;
  should_block boolean;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return 0; end if;
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then return 0; end if;

  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';

    if service_type_val not in
       ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly', 'recurring_yearly') then
      continue;
    end if;

    if exists (
      select 1 from public.jobs
       where deal_id = d.id
         and service_type = service_type_val
         and archived = false
    ) then
      continue;
    end if;

    one_time_amt  := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt   := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;
    should_block  := partial_payment_mode and service_type_val <> 'web_dev';

    select id into group_id_val from public.groups where code = service_type_val;
    owner_id_val := public.team_lead_for_group(service_type_val);

    stage_board := case service_type_val when 'ai_seo' then 'web_seo' else service_type_val end;

    select id into job_stage_id
      from public.pipeline_stages
     where board = stage_board
       and code = case service_type_val
         when 'web_dev' then 'awaiting_brief'
         when 'hosting' then 'setup'
         else 'onboarding'
       end
       and archived = false
     limit 1;

    insert into public.jobs (
      deal_id, client_id, service_type, billing_type,
      one_time_amount, monthly_amount, setup_fee,
      stage_id, assigned_group_id, owner_user_id,
      status, started_at, code,
      is_blocked, blocked_reason, blocked_at
    ) values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, owner_id_val,
      'active', now(), d.code,
      should_block,
      case when should_block then 'partial_payment_pending' else null end,
      case when should_block then now() else null end
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end $$;

grant execute on function public.release_jobs_for_deal(uuid, boolean) to authenticated;

-- 4. Backfill: assign owner_user_id on existing unassigned jobs.
update public.jobs j
   set owner_user_id = public.team_lead_for_group(j.service_type)
 where j.archived = false
   and j.owner_user_id is null
   and public.team_lead_for_group(j.service_type) is not null;
```

- [ ] **Step 2: Apply + types**

```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --include-all
SUPABASE_ACCESS_TOKEN=<token> npm run types:gen
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260511000002_team_leads.sql src/types/supabase.ts
git commit -m "feat(teams): is_team_lead + auto-assign new jobs to team lead"
```

---

## Task 2: Admin UI — set team lead per user

**Files:**
- Create: `src/features/users/hooks/useSetTeamLead.ts`
- Modify: `src/features/users/UserDetailPage.tsx`
- Modify: `src/lib/queryKeys.ts` (add `teamLeads(groupCode)`)

- [ ] **Step 1: Hook**

```ts
// useSetTeamLead.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = { userId: string; groupId: string; isLead: boolean };

export function useSetTeamLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'users',
      'set_team_lead',
      async ({ userId, groupId, isLead }: Input) => {
        const { error } = await supabase
          .from('user_groups')
          .update({ is_team_lead: isLead })
          .eq('user_id', userId)
          .eq('group_id', groupId);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: (_d, { userId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.userGroups(userId) });
      void qc.invalidateQueries({ queryKey: ['team-leads'] });
    },
  });
}
```

- [ ] **Step 2: UI on `UserDetailPage`** — in the group-membership table/list, render a "Team lead" checkbox per row alongside the existing Remove button. Disabled for groups the user isn't in.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git commit -m "feat(admin): toggle team lead per user×group in user detail"
```

---

## Task 3: Group permissions page — show current team leads

**Files:**
- Create: `src/features/permissions/TeamLeadsBadge.tsx`
- Modify: `src/features/permissions/GroupPermissionsPage.tsx`

- [ ] **Step 1: TeamLeadsBadge** — fetches `select user_id, profiles(full_name, email) from user_groups where group_id = ? and is_team_lead = true`. Renders a small inline list ("Team leads: Alice, Bob") at the top of the group permissions matrix.

- [ ] **Step 2: Wire into `GroupPermissionsPage`** under the page title.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git commit -m "feat(admin): show team leads on group permissions page"
```

---

## Task 4: Kanban — admin bypasses "Only mine"

**Files:**
- Modify: `src/features/jobs/JobsKanbanPage.tsx`

- [ ] **Step 1: Apply** — wrap the existing onlyMine derivation:

```ts
const isAdmin = useAuthStore((s) => s.isAdmin);
const onlyMine = !isAdmin && searchParams.get('mine') !== '0';
```

And hide the chip entirely for admins:

```tsx
{!isAdmin && (
  <button ...>{onlyMine ? 'Only mine' : "All my group's"} · ...</button>
)}
```

- [ ] **Step 2: Build + smoke + commit**

```bash
npm run build
git commit -m "feat(tech): admin sees every job; only-mine filter is non-admin only"
```

---

## Task 5: Apply + smoke + push

- [ ] **Step 1: Migration applied** (in Task 1).

- [ ] **Step 2: Manual smoke**
1. Open `/admin/users/<your-user-id>` → tick **Team lead** on one of your tech groups (e.g. Web SEO).
2. Trigger a new deal → drag to **Partial Payment** → spawned `web_seo` job has `owner_user_id` set to you; appears under "Only mine" on `/tech/web-seo` for you.
3. Confirm admin sees ALL jobs on `/tech/web-seo` with no filter chip shown.
4. Confirm a non-admin who's a Web SEO member but not the lead sees only their own owned jobs by default; chip is visible and works.
5. Backfilled jobs: existing unassigned jobs are now owned by their group's lead (or still null if no lead).

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Out of scope (future)

- Allowing multiple team leads per group + a chooser to pick which one each new job goes to. Right now we just pick the deterministic first.
- Round-robin or load-aware assignment.
- Notification to the team lead when a job is auto-assigned (the existing `notifications` table already supports it; add later if useful).
