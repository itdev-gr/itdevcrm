# AI SEO convert parked the new sibling card on an archived stage (2026-08-06)

## Symptom

Deal **006122** (ΜΑΝΩΛΗΣ / Dynamis Capital FZ LLE, business profile "MYKONOS
BOOKER"): the Web SEO team had no card to work on. Reported as "το local και το
web SEO δεν έχουν ανοίξει".

## What was actually true

All three trio jobs existed, none archived, none blocked.

| Job | Service | Stage | Visible? |
|---|---|---|---|
| `006122-AISEO` | ai_seo | off-board (`stage_id` null) | n/a — billing parent, by design |
| `006122-AISEOLOC` | local_seo | `local_seo/rank_tracking` | yes, but in Rank Tracking, not New Project |
| `006122-AISEOWEB` | web_seo | `web_seo/onboarding` — **archived** | **no** |

`JobsKanbanPage` builds its columns from non-archived stages only
(`src/features/jobs/JobsKanbanPage.tsx:114`), and `groupJobsForBoard` silently
drops any card whose stage has no column
(`src/features/jobs/kanbanGrouping.ts:78-82`). The Web SEO card was in the
database and invisible on the board.

## Timeline (read from activity_log)

| When | What |
|---|---|
| 2026-07-20 11:25 | Deal won → `006122-LOCALSEO` "Local Seo" €230/mo, off-board |
| 2026-07-22 09:54 | Fully Paid → `local_seo/new_project`, onboarded, `localseo_gbp` email delivered |
| 2026-07-28 → 07-29 | Worked: New Project → Optimize → **Rank Tracking** |
| **2026-08-03 15:00** | **Converted local_seo → ai_seo** via `convert_job_service_type` |
| 2026-08-04 09:30 | `webseo_gsc` access email sent manually (so the client already had the ask) |
| 2026-08-04 08:23–08:24 | Accounting stage moves; `release_deal_jobs` stamped `onboarded_at` on the web card but could not move it (see below) |

## Root cause — three defects in `convert_job_service_type`

1. **The sibling stage pick ignored `archived`.**
   ```sql
   select id into v_sib_stage from public.pipeline_stages
     where board = v_sibling order by position limit 1;
   ```
   Both SEO boards carry **two** stages at `position = 10` — `new_project`
   (live) and `onboarding` (archived). `order by position limit 1` left the tie
   to the planner and prod resolved it to the archived row. The identical shape
   on the v1 convert path had the same bug. Checked across every board: three
   were resolving to an archived stage — `local_seo`, `web_seo`, `web_dev`.

2. **The converted job was left `billing_only = true`** while the new sibling
   got `billing_only = false` — the two children of one parent ended up with
   opposite flags. The canonical trio spawn in `release_billing_jobs_for_deal`
   (`20260728120000_domains_service.sql:118-128`) makes both children
   `billing_only = false, billing_active = false, amount_net = 0`.
   `billing_only = true` also blocks force-renewal
   (`src/features/jobs/renewalAction.ts:26`).

3. **The new sibling was left `billing_active = true`**, so a child card
   advertised itself as a live billing row beside its billing parent.

Compounding: **the paid-in-full re-run could not rescue it.** `release_deal_jobs`
only moves a SEO job to `new_project` when `onboarded_at IS NULL AND stage_id IS
NULL`. The web card already had a stage (the archived one), so it fell to the
branch that merely stamps `onboarded_at` — which it did on 2026-08-04 08:24.
After that no future Fully Paid could ever move it.

Also confirmed: `006122-AISEOLOC` was the **only row in the whole `jobs` table**
tripping integrity alert #5 `aiseo_child_amount` — `amount_net` 0.00 but
`monthly_amount` still 230.00, and the alert reads all three amount columns
(`20260805091000_service_card_not_billing_alert.sql:107-110`).

## Fixes

**Code** — `supabase/migrations/20260806110000_convert_ai_seo_sibling_stage_and_flags.sql`,
applied to prod 2026-08-06 (pre md5 `0518d677…` → post md5 `76955f9b…`):
both stage picks now filter `not archived` and are deterministic
(`order by (code = 'new_project') desc, position, code`); children get
`billing_only = false, billing_active = false`; the converted card's
`one_time_amount` / `monthly_amount` / `setup_fee` are cleared alongside
`amount_net`.

Verified after apply — the stage pick per board, old vs new:

| Board | Before | After |
|---|---|---|
| `local_seo` | `onboarding` (archived) | `new_project` |
| `web_seo` | `onboarding` (archived) | `new_project` |
| `web_dev` | `awaiting_brief` (archived) | `new_project` |

**Data (deal 006122 only)** — applied 2026-08-06. Backups:
`public.jobs_aiseo_convert_backup_20260806`, `public.deals_aiseo_convert_backup_20260806`.

- `006122-AISEOWEB` → `web_seo/new_project`, `billing_active = false`
- `006122-AISEOLOC` → `billing_only = false`, amount columns nulled (clears alert #5)
- `deals.services_planned` re-keyed `local_seo` → `ai_seo`

No email fired: `webseo_gsc:99c31758-…` was already `delivered` (2026-08-04
09:30), so `jobs_seo_onboarding_email`'s dedupe check short-circuited. Confirmed
after the write — `email_outbox` still holds only the 2026-08-04 row.

**Data (deal 000230)** — applied 2026-08-06, same backup tables. Deal 000230
(ΧΑΧΑΛΗΣ ΧΑΡΑΛΑΜΠΟΣ ΗΛΙΑΣ) hit the identical bug on its 2026-08-04 10:30
convert.

- `000230-AISEOWEB` → `web_seo/new_project`, `billing_active = false`
- `000230-AISEOLOC` → `billing_only = false` (amounts were already null)
- `deals.services_planned` re-keyed `local_seo` → `ai_seo`

This deal had **no** `webseo_gsc:<deal_id>` row, so the dedupe check would not
have saved it — the stage move would have queued a `webseo_gsc_access` mail to
`hachalis@gmail.com`. Owner asked to move the card without contacting the
client. Suppressed by toggling `email_automation_settings.enabled` for
`webseo_gsc` off → move → back on, all inside the single implicit transaction
the Management API wraps the file in, so no other session could observe the
disabled state and no other deal's mail could be dropped. A guard aborts the
whole file if the automation was already off, so the restore cannot enable
something that was deliberately disabled. Deliberately **not** done by inserting
a forged `'sent'` row into `email_log` — that would leave a permanent false
record that the client had been contacted.

Verified after the write: `webseo_gsc` is `enabled = true` again, and
`email_outbox`/`email_log` hold no row for this deal. Billing is healthy —
`deal_payments` are keyed `ai_seo` with two paid periods and a pending
2026-08-11 → 2026-09-11 at €241.94, so `ensure_recurring_payments` is still
extending the schedule.

**Data (deal 000060)** — applied 2026-08-06, same backup tables. Converted
local_seo → ai_seo the same day at 07:02:15, hours before the migration landed
(~14:11), so it ran on the buggy function. Its web card happened to land on the
**live** `web_seo/new_project` — the `order by position limit 1` tie really was
left to the planner and this time it fell the other way, which is the clearest
evidence the pick was nondeterministic rather than consistently wrong. Only the
flags needed repair: `000060-AISEOLOC` → `billing_only = false`,
`000060-AISEOWEB` → `billing_active = false`, `services_planned` re-keyed to
`ai_seo`. No stage move, so no email could fire.

**Deal 000129 — AI SEO → Local SEO @ €180 + 24% VAT** (owner request, applied
2026-08-06). Client ΚΑΡΑΜΠΟΙΚΗ ΝΙΚΗ ΚΩΝΣΤΑΝΤΙΝΟΣ, card title "MeTattoo".

Run as raw SQL, not through `convert_job_service_type`: the RPC guards on
`current_user_is_admin()`, and over the Management API `auth.uid()` is NULL so
the guard returns false (verified — `select auth.uid(), current_user_is_admin()`
returns `null, false`). The teardown branch was replicated statement for
statement, with **one deliberate departure**: the RPC does
`delete from public.jobs` on the web child and the parent; per owner instruction
("χωρίς να χαθεί τίποτα") both were **archived** instead. Nothing was removed —
all three job rows still exist. Archiving is behaviourally equivalent for
everything downstream: billing (`ensure_recurring_payments`), dedup guards, the
kanban query (`useJobs` filters `.eq('archived', false)`) and every integrity
alert are already gated on `not archived`.

- `000129-AISEOLOC` → promoted to standalone `000129-LOCALSEO`, `parent_job_id`
  null, `billing_only = false`, `billing_active = true`, €180 net, `vat_rate` 24
- `000129-AISEO` (parent) and `000129-AISEOWEB` → archived, `billing_active = false`
- `deal_payment_lines` re-pointed from parent to survivor (2 lines);
  `deal_payments` re-keyed `ai_seo` → `local_seo`
- `deals.services_planned` replaced — it held two stale zero-amount rows
  (`local_seo` + `web_seo`) and **no** `ai_seo` entry, so the RPC's own re-key
  would have been a no-op; set to a single `local_seo` @ 180, and
  `recurring_monthly_value` = 180
- `deals.cash_charge_vat` flipped to `true`. The deal is `payment_method = 'cash'`
  with `cash_charge_vat = false`, which is precisely why every job on it carried
  `vat_rate = 0`. Charging "180 + VAT" while leaving that flag false would put
  the deal and the card in permanent disagreement and silently create the next
  job on this deal at 0% again.
- The web card's only dependent — `metattoo-gr-seo-geo-audit-2026-07-10-v2.pdf`
  (`attachments` is polymorphic, `parent_type`/`parent_id`, no FK) — was moved to
  the surviving card first so it stays in daily reach. Verified after the write:
  it now resolves to `000129-LOCALSEO`.

Left alone: the card sits on `local_seo/done` and the deal's accounting stage is
`on_hold`; neither was touched. The paid €350 period (2026-06-09 → 07-09) and the
cancelled one (07-09 → 08-09) keep their original amounts — history, not forecast.

## Safety net: integrity alert 25 `invisible_card`

`supabase/migrations/20260806170000_invisible_card_alert.sql` (post md5
`b477063586…`). The root cause is fixed, but nothing in the product could ever
have *told* us a card was invisible — that is why 006122 sat unnoticed for three
days. Alert 25 fires on any non-archived job, on a non-closed deal, that has a
`stage_id` which renders no column: either the stage is archived or it belongs to
another board. It is distinct from check 20 `off_board_job`, which catches
`stage_id IS NULL`.

Suppressed for a blocked card on a board that renders a virtual Blocked column —
`groupJobsForBoard` diverts those before the column lookup, so they stay visible.
`signature` is the stage id, so dismissing one broken stage does not keep the
card hidden if it later lands on a different one.

No frontend change needed: the alerts UI is generic over `check_key` and takes
`title`/`detail` straight from the RPC.

## Verification sweep (whole table, after all four fixes)

| Check | Rows |
|---|---|
| Non-archived jobs sitting on an archived stage | 0 |
| Alert #5 `aiseo_child_amount` | 0 |
| AI-SEO children with `billing_only = true` | 0 |
| AI-SEO children with `billing_active = true` | 0 |
| Non-archived children whose parent is archived/missing | 0 |

## Not fixed here

- ~~**`deals.services_planned` re-key inside the RPC.**~~ Fixed the same day in
  `supabase/migrations/20260806150000_convert_rekey_planned_service.sql` (post
  md5 `019fd236…`). New helper `rekey_planned_service()` re-keys exactly one
  entry, matched on `service_type` + `billing_type` and preferring the one whose
  amount agrees — read from `one_time_amount`/`monthly_amount`, the keys the UI
  actually writes, with `amount_net` kept only as a legacy fallback. Verified in
  a rolled-back transaction against live rows, including a plain count proving
  the replaced `(e->>'amount_net')` predicate matched 0 rows.
- **`006122-AISEOLOC` stays in Rank Tracking.** Not moved back to New Project —
  that would discard the work already logged there.
- **`000230-AISEO` parent** has `period_start_date` / `period_due_date` NULL
  while its child `000230-AISEOLOC` holds 2026-07-11 → 2026-08-11. Pre-existing,
  unrelated to this bug, and not touched here. Billing is unaffected (the
  payment schedule is intact and extending); it only means the parent card shows
  no due chip. `recompute_deal_job_period_dates('<deal>')` is the intended
  repair if it matters.
- **`006122-AISEO` parent** carries `amount_net` 350.00 but `monthly_amount`
  230.00. Display and billing both read `amount_net`
  (`src/features/jobs/jobAmount.ts`), and the paid `deal_payments` row is
  €350.00, so the card and the money agree; the stale `monthly_amount` is
  cosmetic in the DB only.
