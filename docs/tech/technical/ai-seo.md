# AI SEO — Three-Row Split

**Purpose** — Documents how an AI SEO service is modelled as three `jobs` rows: one `ai_seo` **billing parent** (holds the price, off-board) plus a `web_seo` and a `local_seo` **work child** (€0, on their own boards), linked by `jobs.parent_job_id` so the agency bills once but the Web and Local teams each work a real card.

## Data model

All three rows live in **`public.jobs`** and share the same `deal_id`, `client_id`, and deal `code` base.

| Row | `service_type` | `stage_id` | `parent_job_id` | `amount_net` | `billing_only` | `billing_active` | `owner_user_id` | board |
|-----|----------------|-----------|-----------------|--------------|----------------|------------------|-----------------|-------|
| ① Billing parent | `ai_seo` | **NULL** (off-board) | NULL | the real price | `true` | `true` | NULL | none |
| ② Web child | `web_seo` | web_seo first stage | parent id | `0` | `false` | `false` | pefstathiadis (trigger) | web_seo |
| ③ Local child | `local_seo` | local_seo first stage | parent id | `0` | `false` | `false` | dtzouvaras (trigger) | local_seo |

Key columns (`jobs`):
- **`parent_job_id uuid references public.jobs(id) on delete cascade`** (`20260624010000_jobs_parent_job_id.sql`) — children point at the parent; deleting the parent cascades the children (they never outlive their billing record). Indexed `jobs_parent_job_id_idx`.
- `amount_net` — the price lives **only** on the parent; both children are `0` so they never double-bill.
- `billing_only` (parent `true` = no work board), `billing_active` (children `false` = excluded from billing).
- `code` — children get a parentage-aware abbreviation: `<deal>-AISEOWEB` / `<deal>-AISEOLOC` instead of plain `WEBSEO`/`LOCALSEO` (`set_job_code` + `job_service_abbr`, `20260624020000`).

## Flow

```mermaid
flowchart TD
  src{"AI SEO created via…"} -->|auto: deal paid| rel["release_jobs_for_deal\n(service_type='ai_seo' branch)"]
  src -->|manual: accounting| ccj["create_custom_job\n(p_department='ai_seo', not billing_only)"]
  src -->|existing on-board ai_seo job| bf["backfill 20260624070000\n(one-time split)"]
  rel --> parent["① INSERT ai_seo parent\nstage_id=NULL, billing_only, amount_net=price"]
  ccj --> parent
  bf --> parent
  parent --> web["② INSERT web_seo child\nparent_job_id=parent, amount_net=0,\nweb_seo first stage, owner=pefstathiadis"]
  parent --> local["③ INSERT local_seo child\nparent_job_id=parent, amount_net=0,\nlocal_seo first stage, owner=dtzouvaras"]
  web --> codew["set_job_code → <deal>-AISEOWEB"]
  local --> codel["set_job_code → <deal>-AISEOLOC"]
  codew --> onb["jobs_seo_onboarding_email fires per child\n(GSC for web child, GBP for local child)"]
  codel --> onb
  parent --> unit{"Block / renewal / close\ntreat parent+children as ONE unit"}
  unit -->|On Hold| blk["block_deal_jobs blocks all 3\n(parent has null stage → just flagged)"]
  unit -->|Paid In Full| ren["release_deal_jobs:\nchildren → renewal; parent just unblocked"]
  unit -->|end_job(parent)| casc["end_job cascades children\n→ each board's closed lane"]
```

## Functions / triggers / crons

- **`create_custom_job(p_deal_id, p_title, …, p_department, …, p_billing_only, …)`** (`20260624040000_create_custom_job_ai_seo_trio.sql`) — when `p_department='ai_seo'` and `not p_billing_only`, inserts the parent (`billing_only=true, stage_id=null, owner=null`) then the two children (`amount_net=0, billing_active=false, billing_only=false`, web→web_seo first stage, local→local_seo first stage, `parent_job_id=parent`), then `generate_payments_for_deal`. SECURITY DEFINER, gated on admin OR `accounting_onboarding:edit`.
- **`release_jobs_for_deal(target_deal_id, partial_payment_mode)`** (`20260624050000_release_jobs_ai_seo_trio.sql`) — the auto path; the `service_type='ai_seo'` branch emits the same trio. Dedup is on the **billing record** (one `ai_seo` job per deal). Children inherit `is_blocked` from `partial_payment_mode`.
- **`set_job_code()` / `job_service_abbr(st)`** (`20260624020000_ai_seo_child_job_codes.sql`) — a child whose `parent_job_id` points at an `ai_seo` job maps `web_seo→aiseo_web` (`AISEOWEB`) and `local_seo→aiseo_local` (`AISEOLOC`) for its code.
- **`jobs_local_seo_owner` / `jobs_web_seo_owner`** (BEFORE INSERT) — force the child owners (dtzouvaras / pefstathiadis) by `service_type`, so the children are owned even though `create_custom_job` passes no owner.
- **`block_deal_jobs` / `release_deal_jobs`** (`20260626000010`, `20260626000014`) — operate on **all** of a deal's open jobs, so parent + both children block/unblock together. Parent has a NULL `stage_id` so it is only flag-blocked (no column move); children route to their boards' `renewal` lane on Paid In Full.
- **`end_job(p_job_id)`** (`20260624060000_end_job_cascade_children.sql`) — ending the parent (or any job) cascades to every `parent_job_id = p_job_id` child, moving each to **its own** board's `closed` lane.
- **Backfill `20260624070000_backfill_ai_seo_three_row.sql`** — one-time: converted every existing on-board `ai_seo` job into the 3-row shape (web child inherits the parent's stage, local child gets a mapped local stage, parent becomes `billing_only`/off-board/unowned). Snapshot `jobs_ai_seo_split_backup_20260624`; skips already-split parents (those with children).
- **Fix `20260625000000_fix_004977_ai_seo_split.sql`** — repaired a single deal (`004977`) whose 06-19 manual re-entry left a split incomplete.

## Gotchas

- **Children must never show the deal amount.** Identify a child via `parent_job_id IS NOT NULL`. The kanban card hides the price badge when `job.parent_job_id != null` (`JobsKanbanCard.tsx`, line ~118) and shows a violet "AI SEO" tag instead. All children are `amount_net=0` so even if rendered they read €0. (Memory: `feedback_ai_seo_child_no_amount`.)
- **The parent is off-board.** `stage_id IS NULL` and `service_type='ai_seo'` has **no `pipeline_stages` rows** — there is no AI SEO board. The parent only surfaces in billing/deal-overview, not on any kanban. `end_job` therefore resolves "which board" from the job's current stage, not its `service_type`.
- **Dedup is on the billing record**, not on the children. `release_jobs_for_deal` checks for an existing `ai_seo` job before emitting the trio, so re-runs don't duplicate.
- **`on delete cascade`** on `parent_job_id` means deleting the billing parent silently deletes both work cards — intentional (children never outlive billing), but be careful with manual parent deletes.
- **Onboarding emails fire per child, not per parent** — the web child triggers GSC, the local child triggers GBP, each deduped by `<setting_key>:<deal_id>` (see `onboarding-emails.md`).
- **RLS visibility** — service teams can't view the `ai_seo` parent (jobs RLS keys on `service_type`); they only see their `web_seo`/`local_seo` child. Service attachments for an AI SEO job therefore live on the **child** jobs (see `info-attachments.md`).

## File references

- `supabase/migrations/20260624010000_jobs_parent_job_id.sql` — `parent_job_id` column + FK cascade + index.
- `supabase/migrations/20260624020000_ai_seo_child_job_codes.sql` — `set_job_code` parent branch + `job_service_abbr` (AISEOWEB/AISEOLOC).
- `supabase/migrations/20260624040000_create_custom_job_ai_seo_trio.sql` — manual (accounting) trio creation.
- `supabase/migrations/20260624050000_release_jobs_ai_seo_trio.sql` — auto (payment) trio creation.
- `supabase/migrations/20260624060000_end_job_cascade_children.sql` — end-job cascade to children.
- `supabase/migrations/20260624070000_backfill_ai_seo_three_row.sql` — one-time split backfill + backup table.
- `supabase/migrations/20260625000000_fix_004977_ai_seo_split.sql` — deal 004977 split repair.
- `supabase/migrations/20260623160000_jobs_web_seo_owner.sql`, `20260619000001_local_seo_owner_dtzouvaras.sql` — child owner triggers.
- `src/features/jobs/JobsKanbanCard.tsx` — AI SEO tag + price-hide on children (`parent_job_id`).
- `src/features/attachments/serviceAreas.ts` — `areasForJob` returns `[]` for the `ai_seo` parent (files live on children).
