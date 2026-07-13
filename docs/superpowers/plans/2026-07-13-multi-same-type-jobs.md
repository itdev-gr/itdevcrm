# Multiple same-service jobs per deal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** A deal may carry one job per (service_type, billing_type) pair; repair deal 005906.

**Spec:** `docs/superpowers/specs/2026-07-13-multi-same-type-jobs-design.md` (the 7 touch points + scope boundary).

## Global Constraints

- Same conventions as `docs/superpowers/plans/2026-07-10-shared-mailboxes.md` Global Constraints (Management API recipe + payload builder, sbp token ROTATION OWED, drift-check every fn against the base file named per task — STOP on logic drift, scoped vitest only, `npm run build` gate, push only after prod apply + probes).
- **Fn bases (drift-check against these):** `release_billing_jobs_for_deal` + `release_jobs_for_deal` → `20260702160000_cash_charge_vat.sql`; `seed_deal_jobs_and_payments` → `20260617000013`; `ensure_recurring_payments` → `20260702000000_billing_mitigations.sql`; `recompute_job_period_dates` → `20260703000000`.
- Copy each base body verbatim; apply ONLY the one-line(-ish) edits below; diff extracted bodies vs base to prove it (established technique).
- These are the money paths: every migration probe runs inside a rolled-back exception-capture block; NO live writes outside the final 005906 repair task.

### Task 1: Migration `20260713150000_jobs_per_type_billing.sql` — spawn + linking fns

Full re-declares (create or replace, same signatures) of four fns with exactly these edits:
- [ ] `release_billing_jobs_for_deal`: dedupe (base :39) → `if exists (select 1 from public.jobs where deal_id = d.id and service_type = st and billing_type = coalesce(service->>'billing_type','one_time') and not archived) then continue; end if;` (ai_seo branch keeps its existing type-only guard).
- [ ] `release_jobs_for_deal`: existing-job lookup (base :144-146) adds `and billing_type = <the service's billing_type variable already in scope>`.
- [ ] `seed_deal_jobs_and_payments`: line-link job lookup (base :56-58) adds `and j.billing_type = <payment row's billing_type>`.
- [ ] `recompute_job_period_dates`: match arm (base :50) → `((dp.service_type = j.service_type and dp.billing_type = j.billing_type) or exists (... line-link unchanged ...))`.
- [ ] Header: purpose + per-fn base pointers + ROLLBACK (re-apply bases). Commit file only; controller drift-checks/applies.

### Task 2: Migration `20260713151000_recurring_link_by_billing_type.sql` — `ensure_recurring_payments`

- [ ] Full re-declare from the 20260702000000 base with two edits: candidate job-existence check (base :43-48) and successor line-link lookup (base :82-87) both add `and j.billing_type = dp.billing_type` / `= r.billing_type`. Successor guard (:52-59) BYTE-UNCHANGED — assert this in the diff.
- [ ] Commit file only.

### Task 3: Frontend — `AccountingKanbanCard.tsx` service-chip key

- [ ] `key={s.service_type}` → `key={`${s.service_type}-${idx}`}` (map gains the index param). Run `npx vitest run src/features/accounting/` + `npm run build`. Commit.

### Task 4 (controller, main session): drift-check → apply → probes

- [ ] Drift-check all five live fns vs bases (pg_get_functiondef). Apply Task 1 then Task 2 (HTTP 201 each).
- [ ] Rolled-back probe A (dual-type spawn): synthetic deal w/ services_planned = local_seo one_time + local_seo recurring → `release_billing_jobs_for_deal` → expect 2 jobs, codes `<code>-LOCALSEO` + `<code>-LOCALSEO-2`, correct billing_type/amount each; raise-exception capture.
- [ ] Rolled-back probe B (regression): single-service deal spawn → exactly 1 job; re-run → 0 new (idempotent).
- [ ] Rolled-back probe C (chain): paid recurring payment on dual-type deal → `recompute_job_period_dates` gives recurring job the period, one-time job untouched; `ensure_recurring_payments` successor's line binds to the recurring job.

### Task 5 (controller): repair 005906 + push + live check

- [ ] `select release_billing_jobs_for_deal('56e18150-3a7d-4f57-bbc3-0e6145064712');` → verify job `005906-LOCALSEO-2` (recurring_monthly, 233.87, billing_active). Link the existing recurring payment's line to it (insert deal_payment_lines) if absent; `recompute_deal_job_period_dates`.
- [ ] Header comment in Task 1's migration gains the 005906 repair + revert SQL (archive job + delete line).
- [ ] Verify UI live: deal 005906 Payment tab shows both payments, Jobs shows both jobs w/ correct amounts; Local SEO board unaffected until Fully-Paid (normal flow).
- [ ] `git fetch` divergence check → push → ledger + memory update.

## Changes / Revert

Per-migration ROLLBACK headers (re-apply named bases); frontend git revert; 005906 repair revert SQL in Task 1 header.
