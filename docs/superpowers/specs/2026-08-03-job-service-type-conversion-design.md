# Job Service-Type Conversion — Design / Spec

- **Date:** 2026-08-03
- **Status:** Design draft — Q1 decided by owner (simple/non-ai_seo first); Q2 & Q3 use recommended defaults, **flagged for owner confirmation**.
- **Owner ask:** Let **admins and accounting** convert a job from one service_type to another — e.g. a web_seo job → local_seo, a local_seo → ai_seo, a mis-created hosting → domains.

## Greek TL;DR

Κουμπί «Μετατροπή υπηρεσίας» σε job (για admin + accounting) που αλλάζει το `service_type` με ασφάλεια μέσω ενός atomic RPC: μεταφέρει το job στο σωστό board (remap stage), ξαναφτιάχνει code/owner/monthly-tasks της νέας υπηρεσίας, καθαρίζει τα άσχετα info-πεδία (κρατά τα κοινά), και ενημερώνει το service_type σε payment lines + deal services ώστε **τα λεφτά να μείνουν ίδια αλλά συνεπή**. **v1: χωρίς AI SEO** (το «τρίο» parent+2 children μπαίνει σε δεύτερη φάση).

---

## 1. Context (why this is not a one-line UPDATE)

`service_type` is a coupling key across the system (verified map, 2026-08-03):
- **RLS/permissions** key on it: `jobs` RLS uses `current_user_can(jobs.service_type, 'view'/'edit')` (`20260502000008_deals_jobs.sql:128-148`); the permission "board" code **is** the service_type.
- **Board/stage:** `pipeline_stages.board == service_type`; `JobsKanbanPage` filters stages by board (`JobsKanbanPage.tsx:114-116`). A stale `stage_id` makes the job vanish from the new board.
- **Billing linkage:** `deal_payments`/`deal_payment_lines` resolve their `job_id` by matching `(deal_id, service_type, amount_net)` (`20260619130000`, `20260617000009:8`). Changing service_type on the job alone breaks this linkage and diverges from `deals.services_planned`.
- **Per-service machinery** (all INSERT-only today, so a bare UPDATE misses them): `set_job_code`, owner-forcing triggers (`jobs_local_seo_owner`, `jobs_web_seo_owner`, `team_lead_for_group`), `service_monthly_task_templates`, onboarding emails, business-profile mirror.
- **AI SEO** is a 3-row trio: parent (`billing_only`, off-board, owns payment lines) + web_seo child + local_seo child (`amount_net=0`, `billing_active=false`). Converting into/out of ai_seo means creating/tearing down 3 rows — **deferred to v2**.

**Today there is NO code path that changes `jobs.service_type`** (it renders read-only). We add the first one, as a guarded RPC.

## 2. Scope

### In scope (v1)
- Convert a **single, standalone** job between service types **within the same billing-cadence group**, neither side being a special-shape service.
- **Group A (standard monthly kanban):** `web_seo`, `local_seo`, `social_media`, `ads` — any ↔ any.
- **Group B (yearly list-view):** `hosting`, `domains` — any ↔ any.
- Money is preserved; service_type is realigned across job + payment lines + `services_planned`.
- Admin **or** accounting can perform it.

### Out of scope (v1) — deferred / blocked with a clear message
- Anything touching **`ai_seo`** (parent or child) — the trio create/teardown is a separate v2 spec.
- **`web_dev`** (installment billing), **`franchise`** (one-time), **`maintenance`** (support list), legacy **`other`** — special shapes.
- **Cross-cadence** conversions (Group A ↔ Group B, e.g. web_seo → hosting) — monthly vs yearly-only billing mismatch.
- A job that is a **parent** (has children) or a **child** (`parent_job_id` set) — trio members.
- Bulk conversion. (One job at a time in v1.)

## 3. Allowed-conversion rule

```
convertible(src, dst) :=
  src ≠ dst
  AND src, dst both in Group A  (web_seo, local_seo, social_media, ads)
   OR src, dst both in Group B  (hosting, domains)
  AND job has no parent_job_id AND no child jobs
  AND job.service_type ∉ {ai_seo, web_dev, franchise, maintenance, other}
```
The frontend offers only valid `dst` values for the given job; the RPC re-validates (never trust the client).

## 4. The conversion RPC (backend — the heart of the feature)

`convert_job_service_type(p_job_id uuid, p_target text)` — `SECURITY DEFINER`, `set search_path = public`, granted to `authenticated`. Runs **atomically** (single statement / function = one transaction).

**4.1 Guard (raise exception on violation):**
1. `current_user_is_admin() OR current_user_can('accounting_onboarding','edit')` else `raise exception 'not authorized'`.
2. Load the job; `raise` if not found.
3. Validate `convertible(job.service_type, p_target)` (Group match, not ai_seo/web_dev/franchise/maintenance/other, no parent_job_id, no children). Distinct, targeted error messages per failure (so the UI can explain).

**4.2 Apply (in order):**
1. **Billing realignment (money unchanged):**
   - `update deal_payments set service_type = p_target where deal_id = job.deal_id and service_type = job.service_type and amount_net = job.amount_net;` (also update matching `deal_payment_lines`).
   - Update the matching entry inside `deals.services_planned` JSONB (match by old service_type + amount) to `p_target`, so re-runnable release RPCs stay consistent.
   - Do **not** change any amount, `billing_type`, `monthly_amount`, `one_time_amount`, dates. (Group A↔A and B↔B are cadence-compatible by construction.)
2. **service_type:** `update jobs set service_type = p_target ...`.
3. **Board/stage remap:** set `stage_id` to the target board's entry stage — `select id from pipeline_stages where board = p_target order by position limit 1`. (For list-view boards hosting/domains this picks their first list stage; renders in `HostingListPage`/`DomainsListPage`.)
4. **Code regen:** recompute `code` with the same rule as `set_job_code` (extract its body into a callable helper `compute_job_code(job)` so INSERT trigger and this RPC share it — avoids drift).
5. **Owner/group reset (Q3=reset):** re-run the target's owner rule — `local_seo`→dtzouvaras, `web_seo`→pefstathiadis, else `team_lead_for_group(p_target)`; set `assigned_group_id` to the target service's group.
6. **Monthly tasks reset:** replace `monthly_tasks` from `service_monthly_task_templates` where `service_type = p_target` (null if none).
7. **Details migration (Q3):** keep keys shared by both services (notes/report urls per `serviceInfoFields.ts`); drop source-only keys; seed target-only defaults derivable from deal/client (e.g. `website` from client, `business_profile` from deal) via the same seed helpers.
8. **Business-profile mirror:** if `local_seo` is involved on either side, reconcile mirror participation (the mirror covers `local_seo`+`ai_seo`; leaving/entering `local_seo` adds/removes the job from the deal↔job sync).
9. **Audit:** insert an activity-log row `job.service_type_converted` (actor, from, to) and optionally a 📋 auto-comment on the job thread.

**4.3 Return:** the updated job row (so the client refetches cleanly).

> Extract shared logic (`compute_job_code`, owner rule, task seed, details seed) into helper functions so the INSERT triggers and the conversion RPC call the SAME code — the map showed these are INSERT-only today and would silently drift otherwise.

## 5. Frontend UX

- **Entry point:** a **«Μετατροπή υπηρεσίας»** action on `JobDetailPage` (near the read-only service badge at `JobDetailPage.tsx:469-472`), visible only to admin/accounting. Optionally also a row action in the deal's `JobsTab`.
- **Dialog:** shows current service; a **target dropdown filtered to valid destinations** for this job (empty/disabled with an explanation if the job isn't convertible — e.g. "AI SEO conversions are not supported yet", "this job has installment billing"). A summary of what will change: *board moves, owner & monthly tasks reset, these info fields will be cleared, money stays the same*. Confirm → calls `supabase.rpc('convert_job_service_type', {...})`.
- **After success:** invalidate jobs/board/deal queries; toast; the job now appears on the new board.
- **i18n:** Greek + English strings.

## 6. Permissions

- RPC is `SECURITY DEFINER` and self-checks admin OR accounting — it does not rely on the caller's RLS (which would otherwise require edit rights on BOTH old and new boards).
- The button is gated in the UI by the same predicate (admin or `current_user_can('accounting_onboarding','edit')`).

## 7. Testing (TDD; Vitest hits PROD — use seeded/disposable rows, core matchers only)

- **RPC guard:** non-admin/non-accounting → exception; ai_seo/web_dev/franchise/parent/child/cross-group → distinct exceptions; happy path web_seo→local_seo, hosting→domains, ads→social_media.
- **Billing preservation:** after convert, sum of the job's payments and `amount_net` unchanged; `deal_payments`/`deal_payment_lines`/`services_planned` all show the new service_type; period dates unaffected.
- **Board/stage:** `stage_id` now belongs to the target board (`pipeline_stages.board = target`).
- **Code/owner/tasks:** code matches the target's `compute_job_code`; owner = target rule; `monthly_tasks` = target template.
- **Details:** source-only keys gone, shared keys kept, target defaults seeded.
- **RLS side:** a converted local_seo job is visible to local_seo-permissioned users and no longer to (only) web_seo ones.
- **Frontend:** dialog offers only valid targets; hides for non-privileged users; calls RPC with correct args (mock).

## 8. Rollback (per track-changes preference)

The migration adds helper functions + `convert_job_service_type` + activity type. Rollback:
```sql
drop function if exists public.convert_job_service_type(uuid, text);
-- restore set_job_code to inline body if compute_job_code helper is removed
-- (keep compute_job_code — harmless; only drop the RPC to disable the feature)
```
There is no schema/column change (only new functions + a frontend component + i18n), so disabling = drop the RPC + hide the button. Per-job conversions are data changes recorded in the activity log; a mistaken conversion is reversed by converting back (same RPC).

## 9. Open decisions (owner: please confirm — used recommended defaults)

1. **Q2 Billing** = *keep money, realign category* (assumed). Alternative: recompute cadence for the new service, or don't touch billing at all.
2. **Q3 Data** = *reset owner/tasks/code to the new service; clear non-matching info fields* (assumed). Alternative: minimal change (keep owner & tasks).
3. **Allowed neighbors:** v1 allows web_seo/local_seo/social_media/ads ↔ each other, and hosting↔domains. Confirm you don't also need cross-group (e.g. web_seo→hosting) in v1.
4. **Button placement:** Job detail page (assumed) — also add to the deal's JobsTab row menu?
5. **AI SEO v2:** confirm ai_seo conversions are a separate later phase.
