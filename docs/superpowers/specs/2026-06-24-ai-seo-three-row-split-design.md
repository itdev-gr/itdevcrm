# AI SEO = billing record + Web & Local work cards (3-row split) — design

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan

## Goal

Make an **AI SEO** service three linked rows instead of one, so the Web SEO and
Local SEO teams each get their **own owned card on their own board**, while the
**price stays in one place** and is never split or doubled:

1. **① AI SEO billing record** — the job accounting creates. Holds the price and
   generates the payments, exactly as today. **Billing-only** (no work board); shows
   on the deal **Overview** as the single "AI SEO €X" line.
2. **② AI SEO — Web** — a €0 work card on the **Web SEO board**, owner
   **pefstathiadis@itdev.gr**. No price, no payments.
3. **③ AI SEO — Local** — a €0 work card on the **Local SEO board**, owner
   **dtzouvaras@itdev.gr**. No price, no payments.

② and ③ link back to ① via a new `jobs.parent_job_id`. Each team progresses its own
card independently. The 52 existing AI SEO jobs are converted into this shape.

```
            ACCOUNTING creates "AI SEO – €300/mo"
                          │
                          ▼
        ┌───────────────────────────────────────┐
        │ ① AI SEO  (BILLING RECORD)            │  service_type=ai_seo
        │   billing_only=true, no board         │  billing_active=true
        │   amount=€300/mo → payments           │  owner = none (accounting)
        │   shows on: Deal ▸ Overview           │  code <deal>-AISEO
        └───────────────┬───────────────────────┘
          parent_job_id │ parent_job_id
        ┌───────────────┘ └────────────────────┐
        ▼                                       ▼
┌──────────────────────────┐        ┌──────────────────────────┐
│ ② AI SEO — Web          │        │ ③ AI SEO — Local         │
│   service_type=web_seo  │        │   service_type=local_seo │
│   €0, billing_active=F  │        │   €0, billing_active=F   │
│   owner → pefstathiadis │        │   owner → dtzouvaras     │
│   Web SEO board         │        │   Local SEO board        │
└──────────────────────────┘        └──────────────────────────┘
```

## Background (current state)

- **AI SEO is one job today.** `service_type='ai_seo'` jobs live on **web_seo**
  pipeline stages and are *mirrored* onto the Local SEO board by a frontend code-map
  hack (`src/features/jobs/kanbanGrouping.ts` — `AI_SEO_TO_LOCAL_SEO` /
  `aiSeoTargetCode`, plus `ai_seo` special-cases in `JobsKanbanPage.tsx:89` and
  `JobsKanbanCard.tsx:63`). One job ⇒ one `owner_user_id` ⇒ can't be owned by both
  leads. **This is the core problem.**
- **52 `ai_seo` jobs exist**, all on the web board, now owned by pefstathiadis (commit
  `6945263`, migration `20260624000000` — see "Supersedes" below).
- **Creation paths:**
  - `create_custom_job(... p_department='ai_seo' ...)`
    (`20260617000011_job_billing_rpcs.sql`) — accounting's manual path. Inserts one
    `ai_seo` job on the first web_seo stage and calls `generate_payments_for_deal`.
  - `release_jobs_for_deal` (`20260509000005_fold_ai_seo_into_web_seo.sql`, latest
    redefinitions in `20260511*`/`20260617000013`) — auto path from
    `deals.services_planned`; maps `ai_seo → web_seo` board for the stage.
- **Billing is per-job and gated on `billing_active`.**
  `generate_payments_for_deal` (`20260622240000_payment_service_from_lines.sql`) only
  iterates jobs `where ... billing_active`. ⇒ A child with `billing_active=false`
  (and `amount_net=0`) **generates no payments**. This is what guarantees no
  double-billing.
- **Job codes** — `set_job_code()` trigger (`20260618130000_job_unique_codes.sql`)
  overrides any passed code with `<deal_code>-<ABBR>[-N]` and auto-appends `-2/-3…`
  on collision (`generate_job_code`). `job_service_abbr`: `ai_seo→AISEO`,
  `web_seo→WEBSEO`, `local_seo→LOCALSEO`.
- **Owner triggers** — `jobs_web_seo_owner()` (forces `web_seo` *and currently*
  `ai_seo` → pefstathiadis) and `jobs_local_seo_owner()` (forces `local_seo` →
  dtzouvaras). BEFORE INSERT, force on insert only.
- **Deal Overview / billing list** — `JobsBillingPanel.tsx` via `useJobsBilling(dealId)`
  maps over all the deal's jobs; `billing_only` jobs render as a "billing only"
  department line.
- **Lifecycle:**
  - On-Hold: `deals_hold_jobs_on_stage_change()`
    (`20260618000014`) blocks/releases `web_seo/local_seo/ai_seo` jobs on the deal —
    already hits all 3 rows.
  - Close deal: `close_deal` marks every non-archived job on the deal done + moves it
    to the board close lane — already hits all 3 rows.
  - `end_job(p_job_id)` (`20260617000011`) — ends a **single** job
    (`billing_active=false`, status `completed`).
  - `delete_jobs` (`20260618000030_delete_jobs_rpc.sql`) — admin delete with
    ref-count guard.

## Decisions (confirmed with product owner)

1. **3-row model** (billing record + two €0 work cards), not the 2-row companion.
2. **Price stays 100% on ① (the AI SEO billing record).** Never split, never doubled.
   ② and ③ are €0.
3. **Convert all 52 existing AI SEO jobs** into the 3-row shape (not new-only). The
   existing job *becomes* ① (billing record); its current web stage is inherited by ②
   so no web progress is lost; ③ starts at the mapped Local stage.
4. **① is unowned** (a money record; owner column left null / accounting). Only ② and
   ③ carry working owners.
5. **Work children are hidden from the deal Overview billing list** (they're €0 work,
   not billing). They appear only on their kanban boards. ① is the only AI SEO line on
   Overview.
6. **Each work card progresses independently** on its own board/stages.

## Changes

### A. Schema — `jobs.parent_job_id`

- New migration: `alter table public.jobs add column parent_job_id uuid references
  public.jobs(id) on delete cascade;` + index `on jobs(parent_job_id)`.
- `on delete cascade` ⇒ deleting ① removes ② and ③ automatically (DB-level), so the
  two work cards can never outlive their billing record.

### B. Job codes for the children (recognisable + collision-free)

- Extend `job_service_abbr`/`set_job_code()` so a job **with a `parent_job_id` whose
  parent is `ai_seo`** gets a parentage-aware abbreviation: `web_seo → AISEOWEB`,
  `local_seo → AISEOLOC` (e.g. `000123-AISEOWEB`, `000123-AISEOLOC`). The parent keeps
  `<deal>-AISEO`. (Even without this, `generate_job_code`'s `-N` suffix already avoids
  collisions; the parentage abbreviation is for human readability.)

### C. Creation — `create_custom_job` makes 3 rows for AI SEO

- In `create_custom_job`, when `p_department='ai_seo'` (and not `p_billing_only`):
  1. Insert **① billing record**: `service_type='ai_seo'`, `billing_only=true`,
     `billing_active=true`, `stage_id=null`, `amount_net=p_amount_net`,
     `vat_rate`, `setup_fee`, `title` (default "AI SEO"), `owner_user_id=null`.
  2. Insert **② web child**: `service_type='web_seo'`, `parent_job_id=①`,
     `amount_net=0`, `billing_active=false`, `billing_only=false`,
     `stage_id`=first `web_seo` stage, `assigned_group_id`=web_seo group,
     `title='AI SEO — Web'`. (`jobs_web_seo_owner` sets pefstathiadis.)
  3. Insert **③ local child**: `service_type='local_seo'`, `parent_job_id=①`,
     `amount_net=0`, `billing_active=false`, `stage_id`=first `local_seo` stage,
     `assigned_group_id`=local_seo group, `title='AI SEO — Local'`.
     (`jobs_local_seo_owner` sets dtzouvaras.)
  4. `perform generate_payments_for_deal(d.id)` — bills ① only (children inactive).
- Return `{ok:true, job_id: ①, web_job_id: ②, local_job_id: ③}`.

### D. Creation — `release_jobs_for_deal` (auto path) mirrors C

- When the loop hits a `service_type='ai_seo'` planned service, create the same 3 rows
  (billing record carries the planned amount/billing_type; two €0 inactive children).
- Update the per-service dedup guard: skip if the deal already has a non-archived
  `ai_seo` billing record (not the children).

### E. Owner trigger — drop the `ai_seo` branch

- `jobs_web_seo_owner()` reverts to **`web_seo` only** (ai_seo billing records are
  unowned; the **web child** carries pefstathiadis via the same trigger). This
  supersedes the `ai_seo` branch added in `20260624000000`.

### F. Boards — retire the AI-SEO mirror; each board shows a real card

- After the backfill (Change H) no `ai_seo` job has a `stage_id`, so it can't render on
  a board. Simplify the frontend:
  - `kanbanGrouping.ts` — remove `AI_SEO_TO_LOCAL_SEO`, `LOCAL_SEO_TO_AI_SEO`,
    `aiSeoTargetCode`, and the `ai_seo && board==='local_seo'` mapping. Keep the
    Blocked-column logic.
  - `JobsKanbanPage.tsx` — remove the `ai_seo` drag special-case (`:89`).
  - `JobsKanbanCard.tsx` — the `ai_seo` badge (`:63`) now only ever shows on the
    billing record, which isn't on a board; drop/adjust as needed.
  - Web board shows the `web_seo` child; Local board shows the `local_seo` child.

### G. Deal Overview — hide the €0 work children

- `useJobsBilling` / `JobsBillingPanel`: exclude jobs where `parent_job_id is not null`
  from the billing list. ① (the parent) is the only AI SEO line shown. (Optionally show
  a small "Web ▸ / Local ▸" link from ① to its children — nice-to-have, not required.)
- Each work child's **detail page** shows a read-only "Part of AI SEO €X ▸ [parent]"
  banner.

### H. Backfill the 52 existing AI SEO jobs (one-time, in-migration)

For each existing non-archived `ai_seo` job J (snapshot first into
`jobs_ai_seo_split_backup_20260624`):

1. **Create ② web child**: `web_seo`, `parent_job_id=J`, `amount_net=0`,
   `billing_active=false`, `stage_id = J.stage_id` (inherit current web stage so the
   web team keeps its place), owner pefstathiadis, `title='AI SEO — Web'`.
2. **Create ③ local child**: `local_seo`, `parent_job_id=J`, `amount_net=0`,
   `billing_active=false`, `stage_id =` Local stage mapped from J's web stage via the
   current `AI_SEO_TO_LOCAL_SEO` map (fallback: local `onboarding`), owner dtzouvaras,
   `title='AI SEO — Local'`.
3. **Convert J into ① billing record**: `billing_only=true`, `stage_id=null`,
   `owner_user_id=null`. Keep `amount_net`, `billing_active`, `billing_type`,
   `vat_rate`, payments, code (`-AISEO`) untouched ⇒ **no payment churn**.

Run the **backfill before** the frontend mirror-removal deploy (so no board is empty in
between).

### I. Lifecycle coupling

- **Delete:** handled by the `on delete cascade` FK (Change A) — deleting ① deletes
  ②③. Verify `delete_jobs` permits deleting a billing-only parent (no payment lines on
  the children).
- **End:** `end_job(① )` — also end its children: `update jobs set billing_active=false,
  status='completed', completed_at=now() where parent_job_id = p_job_id`.
- **On-Hold / Close:** already deal-level and already hit `ai_seo` + `web_seo` +
  `local_seo`, so ①②③ are covered with **no change**.
- (Per-job manual *block* of the billing parent cascading to children is an edge case —
  see Out of scope.)

## Out of scope (YAGNI)

- Splitting or per-team tracking of the AI SEO **price** (explicitly one price on ①).
- A mirror trigger so a manual single-job *block* of ① also blocks ②③ (on-hold/close
  already cascade at the deal level; manual block of a billing-only record is rare).
- Trimming the parent's combined Local+Web monthly checklist (the children now pull
  their own per-board checklists; revisit only if noisy).
- Any change to non-AI services or to the recurring cron.

## Testing (TDD, small commits per task)

- **`create_custom_job('ai_seo')`** (pg/RPC): creates exactly 3 rows — ① ai_seo
  billing_only with the amount, ② web_seo €0 inactive owned by pefstathiadis, ③
  local_seo €0 inactive owned by dtzouvaras, both `parent_job_id=①`; payments
  generated for ① only (assert `deal_payments` total = amount, none reference ②/③).
- **`release_jobs_for_deal`** with an `ai_seo` planned service: same 3-row shape; dedup
  guard prevents a second billing record on re-run.
- **Codes**: ② `…-AISEOWEB`, ③ `…-AISEOLOC`, no collision when the deal also has real
  web_seo/local_seo jobs.
- **Owner triggers**: ② → pefstathiadis, ③ → dtzouvaras, ① unowned; `jobs_web_seo_owner`
  no longer touches plain `ai_seo`.
- **`end_job(①)`**: ② and ③ also become `completed`/`billing_active=false`.
- **Delete ①**: ② and ③ removed (cascade).
- **Backfill**: each of the 52 → 1 billing-only ① (stage null) + ② (inherits stage) +
  ③ (mapped local stage); payments unchanged; backup table populated; 0 `ai_seo` jobs
  left with a `stage_id`.
- **Frontend**: web board shows ②, local board shows ③; deal Overview shows only ①;
  `kanbanGrouping` unit tests updated (the `ai_seo`-mirrors-onto-local tests removed).
  `npm run build` clean.
- Migrations applied to prod via Supabase MCP (DDL); verify with a round-trip on a
  scratch deal + spot-check a converted real deal.

## Changes / Revert

- **Migrations** (atomic, one release migration unless noted):
  1. `jobs.parent_job_id` column + FK `on delete cascade` + index.
  2. `job_service_abbr`/`set_job_code` parentage-aware abbreviations.
  3. `create_custom_job` — 3-row AI SEO branch.
  4. `release_jobs_for_deal` — 3-row AI SEO branch + dedup guard.
  5. `jobs_web_seo_owner` — drop `ai_seo` branch (supersedes `20260624000000`).
  6. `end_job` — cascade to children.
  7. Backfill the 52 + `jobs_ai_seo_split_backup_20260624` snapshot.
- **In-file ROLLBACK:** restore the converted parents from the backup (stage_id, owner,
  billing_only) and delete the generated children; restore `jobs_web_seo_owner` with
  the `ai_seo` branch; restore `create_custom_job`/`release_jobs_for_deal`/`end_job`
  prior bodies; drop `jobs.parent_job_id`.
- **Code:** `kanbanGrouping.ts` simplification (+ tests), `JobsKanbanPage.tsx`,
  `JobsKanbanCard.tsx`, `useJobsBilling`/`JobsBillingPanel` filter, work-child detail
  banner; i18n keys (en + el) for "AI SEO — Web/Local" and the parent-link banner.
  Atomic commits per task; revert = `git revert` of those commits + the rollback
  migration.

## Supersedes

- Commit `6945263` / migration `20260624000000_jobs_ai_seo_owner_pefstathiadis.sql`
  forced `ai_seo` jobs → pefstathiadis. In the 3-row model `ai_seo` becomes a billing
  record and the web work moves to a `web_seo` child, so that owner branch is removed
  (Change E) and the 52 jobs are converted (Change H). No revert of `6945263` needed —
  this design absorbs it.
