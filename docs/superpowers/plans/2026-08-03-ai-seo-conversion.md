# AI SEO Job Conversion (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the shipped `convert_job_service_type` RPC + `convertibleTargets` so admin/accounting can convert web_seo/local_seo↔ai_seo (create/teardown the parent+2-children trio) with money preserved.

**Architecture:** Add two branches to the existing RPC (upgrade when `p_target='ai_seo'`; teardown when `j.service_type='ai_seo'`), before the v1 same-group path. Extend the frontend eligibility helper + dialog copy. No schema change.

**Tech Stack:** Postgres plpgsql RPC, supabase-js rpc, React+TS, Vitest.

## Global Constraints (from spec)

- Trio shape (mirror live `release_billing_jobs_for_deal`): parent `ai_seo` `billing_only=true billing_active=true stage_id=null is_custom=true` title `'AI SEO'` carries billing fields + owns `deal_payment_lines`; web child `web_seo` and local child `local_seo` each `amount_net=0 billing_active=false is_custom=true parent_job_id=parent` group=matching, titles `'AI SEO — Web'`/`'AI SEO — Local'` (codes via set_job_code → `-AISEOWEB`/`-AISEOLOC`).
- **Money preserved:** only re-point `deal_payment_lines.job_id` (source↔parent) and set `deal_payments.service_type` + `deals.services_planned` to the new value; never change amounts.
- Owner rule: local_seo→`b73d8761-cbae-4ac8-a239-878d1f2151d8`, web_seo→`19aa9170-bd62-4319-8118-668c11e93c98`, else `team_lead_for_group(code)`. Group id: `groups.code = service_type`. Monthly tasks: `service_monthly_task_templates.tasks` (coalesce `'[]'::jsonb`). audit: `activity_log(entity_type,entity_id,action='update',changes,user_id,client_id)` with `changes.kind='service_type_converted'`.
- Defaults (owner-confirmed): children go ON their boards (first stage) on upgrade; survivor retitled to normal client/business title on teardown; upgrade refused if the deal already has any ai_seo job.
- RPC is `SECURITY DEFINER`, admin OR `current_user_can('accounting_onboarding','edit')`. Apply to prod via Mgmt API (browser UA header; auto-mode must be off). Test with ISOLATED disposable data (reuse archived test client `a917d486-05e7-4b0d-9936-800e0b574d7f`); clients can't be hard-deleted (activity_log FK) — archive them. Vitest hits PROD.

## File Structure

- `supabase/migrations/20260803170000_ai_seo_conversion.sql` — **create**: `create or replace` the RPC with the two new branches added to the v1 body.
- `src/features/jobs/serviceConversion.ts` — **modify**: add ai_seo rules to `convertibleTargets`.
- `src/features/jobs/serviceConversion.test.ts` — **modify**: add ai_seo cases.
- `src/i18n/locales/{el,en}/jobs.json` — **modify**: `convert.warning_ai_up`, `convert.warning_ai_down` (or reuse `convert.warning`).

---

### Task 1: RPC — ai_seo upgrade + teardown branches (DB)

**Files:** Create `supabase/migrations/20260803170000_ai_seo_conversion.sql`.

**Interfaces:** Same signature `convert_job_service_type(p_job_id uuid, p_target text) returns public.jobs`. New behavior for ai_seo.

- [ ] **Step 1: `create or replace` the RPC — full body = v1 branches + the two new branches**

Fetch the current v1 body (`pg_get_functiondef('public.convert_job_service_type'::regproc)`), then `create or replace` it inserting, right after the authZ check + `select * into j` + not-found guard, this dispatch:

```sql
  -- ===== v2: AI SEO upgrade (web_seo/local_seo standalone -> ai_seo trio) =====
  if p_target = 'ai_seo' then
    if j.service_type not in ('web_seo','local_seo') then
      raise exception 'convert: only web_seo/local_seo can become AI SEO'; end if;
    if j.parent_job_id is not null then raise exception 'convert: job is already part of a trio'; end if;
    if exists (select 1 from public.jobs c where c.parent_job_id = j.id) then
      raise exception 'convert: job already has children'; end if;
    if exists (select 1 from public.jobs a where a.deal_id = j.deal_id and a.service_type = 'ai_seo') then
      raise exception 'convert: deal already has an AI SEO service'; end if;
    declare v_parent uuid; v_sibling text; v_sib_stage uuid; v_sib_owner uuid; v_sib_group uuid;
    begin
      -- 1) parent takes the billing
      insert into public.jobs(deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
          one_time_amount, monthly_amount, setup_fee, title, is_custom, billing_only, billing_active, status, started_at)
        values (j.deal_id, j.client_id, 'ai_seo', j.billing_type, j.amount_net, j.vat_rate,
          j.one_time_amount, j.monthly_amount, j.setup_fee, 'AI SEO', true, true, true, 'active', now())
        returning id into v_parent;
      -- 2) move billing to parent
      update public.deal_payment_lines set job_id = v_parent where job_id = j.id;
      update public.deal_payments set service_type = 'ai_seo'
        where deal_id = j.deal_id and service_type = j.service_type and coalesce(amount_net,-1)=coalesce(j.amount_net,-1);
      update public.deals d set services_planned = coalesce((select jsonb_agg(
          case when (e->>'service_type')=j.service_type and coalesce((e->>'amount_net')::numeric,-1)=coalesce(j.amount_net,-1)
               then jsonb_set(e,'{service_type}', to_jsonb('ai_seo'::text)) else e end)
          from jsonb_array_elements(d.services_planned) e), d.services_planned)
        where d.id=j.deal_id and jsonb_typeof(d.services_planned)='array';
      -- 3) demote source into its matching child (stays on its board)
      update public.jobs set parent_job_id=v_parent, amount_net=0, billing_active=false, billing_only=true, is_custom=true,
          title = case when j.service_type='web_seo' then 'AI SEO — Web' else 'AI SEO — Local' end,
          code = public.generate_job_code(j.deal_id, case when j.service_type='web_seo' then 'aiseo_web' else 'aiseo_local' end)
        where id = j.id;
      -- 4) create the sibling child on its board
      v_sibling := case when j.service_type='web_seo' then 'local_seo' else 'web_seo' end;
      select id into v_sib_stage from public.pipeline_stages where board=v_sibling order by position limit 1;
      v_sib_owner := case v_sibling when 'local_seo' then 'b73d8761-cbae-4ac8-a239-878d1f2151d8'::uuid
                                    when 'web_seo' then '19aa9170-bd62-4319-8118-668c11e93c98'::uuid end;
      select id into v_sib_group from public.groups where code=v_sibling;
      insert into public.jobs(deal_id, client_id, service_type, billing_type, amount_net, vat_rate, title,
          is_custom, billing_only, billing_active, status, stage_id, assigned_group_id, owner_user_id, parent_job_id, started_at,
          monthly_tasks)
        values (j.deal_id, j.client_id, v_sibling, j.billing_type, 0, j.vat_rate,
          case when v_sibling='web_seo' then 'AI SEO — Web' else 'AI SEO — Local' end,
          true, false, true, 'active', v_sib_stage, v_sib_group, v_sib_owner, v_parent, now(),
          coalesce((select tasks from public.service_monthly_task_templates where service_type=v_sibling),'[]'::jsonb));
      insert into public.activity_log(entity_type,entity_id,action,changes,user_id,client_id)
        values ('job', j.id, 'update', jsonb_build_object('kind','service_type_converted','from',j.service_type,'to','ai_seo'), auth.uid(), j.client_id);
      select * into j from public.jobs where id = v_parent;  -- return the new parent
      return j;
    end;
  end if;

  -- ===== v2: AI SEO teardown (ai_seo parent -> web_seo/local_seo survivor) =====
  if j.service_type = 'ai_seo' then
    if not coalesce(j.billing_only,false) then raise exception 'convert: not an AI SEO parent'; end if;
    if p_target not in ('web_seo','local_seo') then raise exception 'convert: AI SEO can only become web_seo or local_seo'; end if;
    declare v_survivor uuid; v_other uuid;
    begin
      select id into v_survivor from public.jobs where parent_job_id = j.id and service_type = p_target limit 1;
      if v_survivor is null then raise exception 'convert: no % child to keep', p_target; end if;
      -- promote survivor to standalone with the billing
      update public.jobs s set parent_job_id=null, billing_only=false, billing_active=true, is_custom=j.is_custom,
          amount_net=j.amount_net, one_time_amount=j.one_time_amount, monthly_amount=j.monthly_amount,
          setup_fee=j.setup_fee, billing_type=j.billing_type, vat_rate=j.vat_rate,
          title = coalesce((select nullif(trim(business_profile_name),'') from public.deals where id=j.deal_id),
                           (select name from public.clients where id=j.client_id)),
          code = public.generate_job_code(j.deal_id, p_target)
        where s.id = v_survivor;
      update public.deal_payment_lines set job_id = v_survivor where job_id = j.id;
      update public.deal_payments set service_type = p_target where deal_id=j.deal_id and service_type='ai_seo';
      update public.deals d set services_planned = coalesce((select jsonb_agg(
          case when (e->>'service_type')='ai_seo' then jsonb_set(e,'{service_type}', to_jsonb(p_target)) else e end)
          from jsonb_array_elements(d.services_planned) e), d.services_planned)
        where d.id=j.deal_id and jsonb_typeof(d.services_planned)='array';
      -- delete the other child(ren) + the parent
      delete from public.jobs where parent_job_id = j.id and id <> v_survivor;
      insert into public.activity_log(entity_type,entity_id,action,changes,user_id,client_id)
        values ('job', v_survivor, 'update', jsonb_build_object('kind','service_type_converted','from','ai_seo','to',p_target), auth.uid(), j.client_id);
      delete from public.jobs where id = j.id;  -- parent
      select * into j from public.jobs where id = v_survivor;
      return j;
    end;
  end if;
```
(Then the existing v1 guards/logic continue unchanged for non-ai_seo cases.)

- [ ] **Step 2: Apply to prod** (Mgmt API, browser UA, auto-mode off). Verify `select count(*) from pg_proc where proname='convert_job_service_type'` = 1.

- [ ] **Step 3: Isolated test — upgrade** (reuse client `a917d486`): seed a standalone local_seo job amount 100 on a fresh disposable deal; call RPC target `ai_seo` as admin; assert: a new `ai_seo` parent (amount 100, billing_only, billing_active); the source is now `local_seo` child (amount 0, parent set, title 'AI SEO — Local'); a `web_seo` child exists (amount 0); `deal_payments`/`services_planned` show ai_seo. Repeat from web_seo. Clean up (delete jobs+deal; archive not needed — reused client).

- [ ] **Step 4: Isolated test — teardown**: seed a full trio (insert parent + 2 children, put one payment line on parent); call RPC on the parent target `local_seo` as admin; assert: local child standalone (amount 100, billing_active, parent null), web child + parent deleted, payment line on survivor, `deal_payments`/`services_planned` = local_seo. Repeat target web_seo.

- [ ] **Step 5: Guards** (live): ai_seo child → refused; upgrade when deal already has ai_seo → 'already has an AI SEO service'; sales user → not authorized; teardown to a missing child type → refused.

- [ ] **Step 6: Commit** `git add supabase/migrations/20260803170000_ai_seo_conversion.sql && git commit -m "feat(jobs): AI SEO conversion — trio create/teardown in convert_job_service_type"`.

---

### Task 2: Frontend — eligibility + dialog copy

**Files:** Modify `src/features/jobs/serviceConversion.ts`, `serviceConversion.test.ts`, `src/i18n/locales/{el,en}/jobs.json`.

**Interfaces:** `convertibleTargets(job: { service_type; parent_job_id; billing_only?; hasChildren? })` gains ai_seo rules.

- [ ] **Step 1: Extend the failing test** — add to `serviceConversion.test.ts`:
```ts
it('offers ai_seo for standalone web/local', () => {
  expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: null })).toContain('ai_seo');
  expect(convertibleTargets({ service_type: 'local_seo', parent_job_id: null })).toContain('ai_seo');
});
it('offers web/local teardown for an ai_seo parent', () => {
  expect(convertibleTargets({ service_type: 'ai_seo', parent_job_id: null, billing_only: true, hasChildren: true }).sort())
    .toEqual(['local_seo', 'web_seo']);
});
it('offers nothing for an ai_seo child', () => {
  expect(convertibleTargets({ service_type: 'ai_seo', parent_job_id: 'p' })).toEqual([]);
});
```

- [ ] **Step 2: Run → FAIL.** `npm run test:run -- src/features/jobs/serviceConversion.test.ts`.

- [ ] **Step 3: Implement** — in `serviceConversion.ts`, before the group logic:
```ts
  if (job.parent_job_id) return [];                    // any child: act on the parent
  if (job.service_type === 'ai_seo') {
    return job.billingOnlyParent ? ['web_seo', 'local_seo'] : [];
  }
  const base = /* existing group logic result */;
  if (job.service_type === 'web_seo' || job.service_type === 'local_seo') return [...base, 'ai_seo'];
  return base;
```
Add `billingOnlyParent?: boolean` to the job param type (JobDetailPage passes `job.billing_only && hasChildren`, or just `job.billing_only` since only parents are billing_only+ai_seo). Keep `canConvert` unchanged (derives from `convertibleTargets`). Ensure JobDetailPage passes `billingOnlyParent: job.billing_only` (and the RPC re-validates children).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: i18n** — add `convert.warning_ai_up` ("Θα δημιουργηθεί τριάδα AI SEO· η χρέωση μεταφέρεται στο νέο billing record. Τα λεφτά μένουν ίδια.") and `convert.warning_ai_down` ("Θα διαλυθεί η τριάδα AI SEO· η επιλεγμένη υπηρεσία μένει αυτόνομη με τη χρέωση, οι άλλες διαγράφονται.") in el + en. In `ConvertServiceDialog`, pick the warning by `job.service_type==='ai_seo' ? warning_ai_down : target==='ai_seo' ? warning_ai_up : warning`.

- [ ] **Step 6: `npm run build` green; commit** `git add src/features/jobs/serviceConversion.ts src/features/jobs/serviceConversion.test.ts src/i18n/locales/el/jobs.json src/i18n/locales/en/jobs.json src/features/jobs/ConvertServiceDialog.tsx src/features/jobs/JobDetailPage.tsx && git commit -m "feat(jobs): offer AI SEO conversions in the convert dialog"`.

## Self-Review

- **Spec coverage:** upgrade (§3.1) → Task 1 branch 1 ✓; teardown (§3.2) → Task 1 branch 2 ✓; billing invariant → payment-line re-point + no amount change ✓; UI eligibility + copy → Task 2 ✓; guards (child/dedup/authZ/missing-child) → Task 1 Step 5 ✓; defaults (children on board, survivor normal title, dedup) baked in ✓.
- **Placeholder scan:** the v1 body is fetched-and-preserved (legitimate — `create or replace` needs the whole function; the two new branches are complete). "existing group logic result" in Task 2 Step 3 = the current `convertibleTargets` group computation, kept verbatim.
- **Type consistency:** RPC signature unchanged; `convertibleTargets` param gains `billingOnlyParent`/`billing_only` consistently used in Task 2 test + impl + JobDetailPage.
