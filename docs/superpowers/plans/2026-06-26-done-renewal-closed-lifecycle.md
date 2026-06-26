# Done / Renewal / Closed Job Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Done" a non-terminal monthly-rest lane, move ALL of a deal's renewable jobs to Renewal on every payment, auto-move all jobs to Closed when the deal is closed, and never change a job's position via blocking.

**Architecture:** Pure Postgres functions/triggers + two stage rows, applied via Supabase MCP. Blocking stays a virtual overlay (stage_id untouched). Renewal/Close are the only stage moves, done in `release_deal_jobs` and a new close trigger. One small frontend tweak to the close dialog.

**Tech Stack:** Postgres (pl/pgSQL, triggers), Supabase MCP; React/TS for the close dialog.

**Spec:** `docs/superpowers/specs/2026-06-26-done-renewal-closed-lifecycle-design.md`
**Prod:** `CRM` ref `xujlrclyzxrvxszepquy`. DDL via `apply_migration`; behavioral tests via rolled-back `DO` blocks. Confirm before each prod apply.

**Reference (verified 2026-06-26):** `done` exists & is terminal on web_seo (pos 160) + local_seo (pos 80); ads/social have no `done`. All 6 boards have `closed` (terminal) and `renewal` exists on web_seo/local_seo/ads/social. Renewable services = web_seo, local_seo, ads, social_media (board name == service_type). Never block/renew web_dev, hosting, or the ai_seo billing parent.

---

## File Map
- `supabase/migrations/20260626000018_done_nonterminal_and_lanes.sql` — Done→non-terminal + add Done to ads/social.
- `supabase/migrations/20260626000019_block_excludes_done.sql` — `block_deal_jobs` + reconciler skip/clear Done.
- `supabase/migrations/20260626000020_release_all_to_renewal.sql` — `release_deal_jobs` moves all renewable jobs to Renewal.
- `supabase/migrations/20260626000021_close_jobs_trigger.sql` — `deals_close_jobs_on_close` trigger + simplified `close_deal`.
- `supabase/migrations/20260626000022_lifecycle_cleanup.sql` — one-time: unblock Done jobs + move closed-deals' jobs to Closed (backups).
- `src/features/accounting/CloseDealDialog.tsx` — drop per-job lane picking (small).

---

## Task 1: Done non-terminal + Done lane on ads/social

**Files:** Create `supabase/migrations/20260626000018_done_nonterminal_and_lanes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- "Done" = monthly rest, NOT terminal. Make existing Done non-terminal (web/local SEO) and
-- add a Done lane to ads + social_media (after Active, pos 35).
update public.pipeline_stages set is_terminal = false
 where board in ('web_seo','local_seo') and code = 'done';

insert into public.pipeline_stages (id, board, code, display_names, position, is_terminal, color, archived)
select gen_random_uuid(), b, 'done', '{"en":"Done","el":"Ολοκληρώθηκε"}'::jsonb, 35, false,
       (select color from public.pipeline_stages where board='web_seo' and code='done' limit 1), false
  from (values ('ads'),('social_media')) as t(b)
 where not exists (select 1 from public.pipeline_stages ps where ps.board=t.b and ps.code='done');
```

- [ ] **Step 2: Apply** (confirm). MCP `apply_migration` name `done_nonterminal_and_lanes`.

- [ ] **Step 3: Verify**

```sql
select board, code, is_terminal from pipeline_stages
 where code='done' and board in ('web_seo','local_seo','ads','social_media') and not archived order by board;
```
Expected: 4 rows, all `is_terminal=false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000018_done_nonterminal_and_lanes.sql
git commit -m "feat(boards): Done non-terminal + Done lane on ads/social"
```

---

## Task 2: Blocking skips Done (and never moves a job)

**Files:** Create `supabase/migrations/20260626000019_block_excludes_done.sql`

- [ ] **Step 1: Write the migration** (recreate both functions)

```sql
-- Block the deal's open jobs except web_dev, hosting, terminal-stage, AND done-stage jobs.
-- stage_id is never touched (block is a virtual overlay).
create or replace function public.block_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jobs j
     set is_blocked = true, blocked_reason = 'account_on_hold', blocked_at = now()
   where j.deal_id = p_deal_id and not j.archived and not j.is_blocked
     and j.service_type not in ('web_dev','hosting')
     and (j.stage_id is null
          or not exists (select 1 from public.pipeline_stages s
                          where s.id = j.stage_id and (s.is_terminal or s.code = 'done')));
end $$;

-- Reconciler: same as 20260626000015 but the trailing cleanup also clears blocks on done-stage jobs.
create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_target text; v_target_id uuid; moved int := 0;
begin
  for r in
    select d.id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
      from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived and ps.code not in ('done','closed')
       and d.payment_method is not null
       and exists (select 1 from public.deal_payments dp where dp.deal_id = d.id and dp.start_date is not null)
  loop
    v_target := public.target_accounting_stage(r.next_due, current_date);
    if r.cur_code in ('awaiting_payment','on_hold','paid_in_full') and v_target is distinct from r.cur_code then
      if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full' and not p_allow_release) then
        select id into v_target_id from public.pipeline_stages where board='accounting_onboarding' and code = v_target;
        update public.deals set accounting_stage_id = v_target_id where id = r.id;
        moved := moved + 1; continue;
      end if;
    end if;
    if r.cur_code in ('on_hold','partial_payment') then
      perform public.block_deal_jobs(r.id);
    else
      update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
        where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
    end if;
  end loop;
  -- clear blocks on completed (terminal) OR done work
  update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
    from public.pipeline_stages s
   where s.id = j.stage_id and (s.is_terminal or s.code='done')
     and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;
  return moved;
end $$;
```

- [ ] **Step 2: Apply** (confirm). Name `block_excludes_done`.

- [ ] **Step 3: Behavioral test (rolled-back) — Done job never blocked, position preserved**

```sql
do $$
declare v_deal uuid; v_onhold uuid; v_donejob uuid; v_done_stage uuid; v_prev uuid; v_blocked bool;
begin
  select id into v_onhold from pipeline_stages where board='accounting_onboarding' and code='on_hold';
  select id into v_done_stage from pipeline_stages where board='local_seo' and code='done';
  -- pick a local_seo job, park it in Done, remember its stage
  select j.id, j.deal_id into v_donejob, v_deal from jobs j join deals d on d.id=j.deal_id
   where j.service_type='local_seo' and not j.archived and d.payment_method is not null limit 1;
  update jobs set stage_id=v_done_stage where id=v_donejob;
  update deals set accounting_stage_id=v_onhold where id=v_deal;     -- would block, but Done is skipped
  select is_blocked, stage_id into v_blocked, v_prev from jobs where id=v_donejob;
  raise exception 'ROLLBACK_OK done_job_blocked=% still_in_done=% (expect f and t)',
    v_blocked, (v_prev=v_done_stage);
end $$;
```
Expected: `done_job_blocked=f still_in_done=t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000019_block_excludes_done.sql
git commit -m "feat(billing): blocking skips Done jobs (and never moves a job)"
```

---

## Task 3: Paid → all renewable jobs to Renewal

**Files:** Create `supabase/migrations/20260626000020_release_all_to_renewal.sql`

- [ ] **Step 1: Write the migration**

```sql
-- On payment (deal -> paid_in_full) move EVERY non-terminal renewable job to its board's
-- Renewal lane, clearing any block. Non-renewable jobs (web_dev/hosting/ai_seo parent) are
-- only unblocked, never moved.
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.jobs j
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         stage_id = coalesce((select rs.id from public.pipeline_stages rs
                               where rs.board = j.service_type and rs.code = 'renewal' and not rs.archived limit 1),
                             j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id = p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo','ads','social_media')
     and cur.id = j.stage_id and not cur.is_terminal;

  update public.jobs set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
   where deal_id = p_deal_id and is_blocked and blocked_reason = 'account_on_hold' and not archived
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;
```

- [ ] **Step 2: Apply** (confirm). Name `release_all_to_renewal`.

- [ ] **Step 3: Behavioral test (rolled-back) — pay moves active + done jobs to Renewal**

```sql
do $$
declare v_deal uuid; v_paid uuid; v_done uuid; v_in_renewal int; v_total int;
begin
  select id into v_paid from pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  select id into v_done from pipeline_stages where board='local_seo' and code='done';
  select j.deal_id into v_deal from jobs j where j.service_type='local_seo' and not j.archived
    and exists(select 1 from deals d where d.id=j.deal_id and d.payment_method is not null and not d.archived) limit 1;
  update jobs set stage_id=v_done where deal_id=v_deal and service_type='local_seo';   -- park in Done
  update deals set accounting_stage_id=v_paid where id=v_deal;                          -- fires release
  select count(*) filter (where ps.code='renewal'), count(*)
    into v_in_renewal, v_total
    from jobs j join pipeline_stages ps on ps.id=j.stage_id
   where j.deal_id=v_deal and j.service_type in ('web_seo','local_seo','ads','social_media') and not j.archived;
  raise exception 'ROLLBACK_OK renewable_in_renewal=%/% (expect all)', v_in_renewal, v_total;
end $$;
```
Expected: `renewable_in_renewal=N/N` (all renewable jobs in Renewal).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000020_release_all_to_renewal.sql
git commit -m "feat(billing): every payment moves all renewable jobs to Renewal"
```

---

## Task 4: Deal Closed → all jobs to board's Closed

**Files:** Create `supabase/migrations/20260626000021_close_jobs_trigger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- When a deal moves to accounting 'closed', send every non-archived, non-terminal job to its
-- board's 'closed' lane, completed + unblocked. Never creates a job.
create or replace function public.deals_close_jobs_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.accounting_stage_id is not distinct from old.accounting_stage_id then return new; end if;
  select code into v_code from public.pipeline_stages where id = new.accounting_stage_id and board='accounting_onboarding';
  if v_code <> 'closed' then return new; end if;

  update public.jobs j
     set status = 'completed', completed_at = coalesce(j.completed_at, now()),
         is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         stage_id = coalesce((select cs.id from public.pipeline_stages cs
                               where cs.board = cur.board and cs.code = 'closed' and not cs.archived limit 1),
                             j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id = new.id and not j.archived and cur.id = j.stage_id and not cur.is_terminal;
  return new;
end $$;

drop trigger if exists deals_close_jobs_on_close on public.deals;
create trigger deals_close_jobs_on_close
  after update of accounting_stage_id on public.deals
  for each row execute function public.deals_close_jobs_on_close();

-- Simplify close_deal: just set the deal to Closed; the trigger handles all jobs. p_jobs ignored.
create or replace function public.close_deal(p_deal_id uuid, p_jobs jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare closed_acc uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding','complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  select id into closed_acc from public.pipeline_stages where board='accounting_onboarding' and code='closed' limit 1;
  update public.deals set accounting_stage_id = coalesce(closed_acc, accounting_stage_id) where id = p_deal_id;
  return jsonb_build_object('ok', true, 'deal_id', p_deal_id);
end $$;
```

- [ ] **Step 2: Apply** (confirm). Name `close_jobs_trigger`.

- [ ] **Step 3: Behavioral test (rolled-back) — close moves all jobs to Closed, creates none**

```sql
do $$
declare v_deal uuid; v_closed uuid; v_before int; v_after_in_closed int; v_after_total int;
begin
  select id into v_closed from pipeline_stages where board='accounting_onboarding' and code='closed';
  select d.id into v_deal from deals d where not d.archived and d.payment_method is not null
    and exists(select 1 from jobs j where j.deal_id=d.id and not j.archived
                and j.service_type in ('web_seo','local_seo','social_media','ads','web_dev','hosting')) limit 1;
  select count(*) into v_before from jobs where deal_id=v_deal and not archived;
  update deals set accounting_stage_id=v_closed where id=v_deal;
  select count(*) filter (where ps.code='closed'), count(*) into v_after_in_closed, v_after_total
    from jobs j left join pipeline_stages ps on ps.id=j.stage_id
   where j.deal_id=v_deal and not j.archived and j.stage_id is not null;
  raise exception 'ROLLBACK_OK jobs_before=% in_closed=%/% (expect no new jobs, all stage-bearing in closed)',
    v_before, v_after_in_closed, v_after_total;
end $$;
```
Expected: job count unchanged; all stage-bearing jobs in `closed` (ai_seo parent has null stage, excluded).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000021_close_jobs_trigger.sql
git commit -m "feat(billing): closing a deal auto-moves all jobs to Closed; simplify close_deal"
```

---

## Task 5: One-time cleanup + verify closed deals

**Files:** Create `supabase/migrations/20260626000022_lifecycle_cleanup.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Backups
create table if not exists public.lifecycle_cleanup_jobs_backup_20260626 as
  select id as job_id, deal_id, stage_id, is_blocked, blocked_reason, status, completed_at, now() as backed_up_at
    from public.jobs where not archived;

-- (a) Unblock any job currently blocked while sitting in a Done stage.
update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
  from public.pipeline_stages s
 where s.id=j.stage_id and s.code='done' and j.is_blocked and not j.archived;

-- (b) Closed deals: move every job not already in 'closed' to the board's 'closed' lane
--     (existing jobs only — never create). Completed + unblocked.
update public.jobs j
   set status='completed', completed_at=coalesce(j.completed_at, now()),
       is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
       stage_id = coalesce((select cs.id from public.pipeline_stages cs
                             where cs.board=cur.board and cs.code='closed' and not cs.archived limit 1), j.stage_id)
  from public.deals d
  join public.pipeline_stages dps on dps.id=d.accounting_stage_id,
       public.pipeline_stages cur
 where j.deal_id=d.id and not d.archived and dps.code='closed'
   and not j.archived and cur.id=j.stage_id and cur.code <> 'closed';

-- ROLLBACK: update jobs j set stage_id=b.stage_id, is_blocked=b.is_blocked, blocked_reason=b.blocked_reason,
--   status=b.status, completed_at=b.completed_at from lifecycle_cleanup_jobs_backup_20260626 b where j.id=b.job_id;
```

- [ ] **Step 2: Apply** (confirm — mutates job stages). Name `lifecycle_cleanup`.

- [ ] **Step 3: Verify every closed deal's jobs are in Closed**

```sql
select
  (select count(*) from jobs j join deals d on d.id=j.deal_id join pipeline_stages dps on dps.id=d.accounting_stage_id
     join pipeline_stages ps on ps.id=j.stage_id
     where dps.code='closed' and not d.archived and not j.archived and ps.code <> 'closed') as closed_deal_jobs_not_in_closed,
  (select count(*) from jobs j join pipeline_stages s on s.id=j.stage_id where j.is_blocked and s.code='done' and not j.archived) as blocked_done_jobs;
```
Expected: both `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000022_lifecycle_cleanup.sql
git commit -m "chore(billing): unblock Done jobs + move closed-deals' jobs to Closed (backups)"
```

---

## Task 6: Simplify the close dialog (frontend)

**Files:** Modify `src/features/accounting/CloseDealDialog.tsx`

- [ ] **Step 1:** Read `src/features/accounting/CloseDealDialog.tsx` to see the current per-job stage pickers.

- [ ] **Step 2:** Remove the per-job target-lane selection UI. Keep a single confirmation that calls the existing close mutation with just the deal id (`close_deal(dealId)`); the backend trigger now sends every job to Closed. Replace the per-job explanatory text with one line: "All jobs will be moved to Closed." Keep the existing dark-theme classes and the cancel/confirm buttons.

- [ ] **Step 3:** Build.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting/CloseDealDialog.tsx
git commit -m "feat(accounting): close dialog confirms; backend moves all jobs to Closed"
```

---

## Task 7: Final audit + push

- [ ] **Step 1: Full job-category re-audit**

```sql
select
  (select count(*) from jobs j join deals d on d.id=j.deal_id join pipeline_stages ps on ps.id=d.accounting_stage_id
     where j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived and ps.code not in ('on_hold','partial_payment')) as stale_blocks,
  (select count(*) from jobs j join pipeline_stages s on s.id=j.stage_id where j.is_blocked and (s.code='done' or s.is_terminal) and not j.archived) as blocked_done_or_terminal,
  (select count(*) from jobs j join deals d on d.id=j.deal_id join pipeline_stages dps on dps.id=d.accounting_stage_id
     join pipeline_stages ps on ps.id=j.stage_id where dps.code='closed' and not d.archived and not j.archived and ps.code<>'closed') as closed_deal_jobs_not_in_closed;
```
Expected: all `0`.

- [ ] **Step 2: Push**

Run: `git push origin main` (confirm). Backend already applied via MCP; this syncs git + deploys the dialog change.

---

## Self-review notes
- Spec coverage: Done non-terminal + ads/social lanes (T1); block skips Done + position preserved (T2); every payment → all renewable jobs to Renewal (T3); close → all jobs to Closed, never create (T4); one-time unblock-Done + closed-deal verify (T5); dialog simplification (T6); final audit (T7). No payment dates written; no jobs created.
- Identifier consistency: `block_deal_jobs`, `release_deal_jobs`, `reconcile_block_lifecycle`, `deals_close_jobs_on_close`, `close_deal` used consistently; renewable set = web_seo/local_seo/ads/social_media throughout.
