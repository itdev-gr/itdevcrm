# Local SEO board redesign — stages, Blocked column, Done semantics, board docs

Date: 2026-06-10 · Status: approved (chat) · Owner: Marios

## Goal

Replace the generic Local SEO kanban stages with the team's real workflow,
make accounting blocks visible as a column, make "Done" actually complete the
job, and document every board's stages and processes.

## 1. New Local SEO stages (data)

Archive the five existing `local_seo` rows in `pipeline_stages` and insert:

| Pos | Code | EN | EL | Terminal |
|-----|------|----|----|----------|
| 10  | `new_project`        | New project        | Νέο Έργο                  | — |
| 20  | `renewal`            | Renewal            | Ανανέωση                  | — |
| 30  | `called_no_response` | Called/No response | Κλήση/Χωρίς Απάντηση      | — |
| 40  | `send_form`          | Send form          | Αποστολή Φόρμας           | — |
| 50  | `optimize`           | Optimize           | Βελτιστοποίηση            | — |
| 60  | `rank_tracking`      | Rank tracking      | Παρακολούθηση Κατάταξης   | — |
| 70  | `new_gbp`            | New GBP            | Νέο GBP                   | — |
| 80  | `done`               | Done               | Ολοκληρωμένο              | ✅ `completed` |
| 90  | `suspended`          | Suspended          | Σε Αναστολή               | — |
| 100 | `verification`       | Verification       | Επαλήθευση                | — |

Existing job remap (2 jobs live, both in `onboarding`): `onboarding` →
`new_project`, `gbp_setup` → `new_gbp`, `active` → `optimize`, `on_hold` →
`suspended`, `cancelled` → `done`. New local_seo jobs spawn into the
lowest-position stage (`new_project`).

## 2. Blocked — virtual column (frontend only, local_seo board only)

"Blocked" is NOT a `pipeline_stages` row. On `/tech/local-seo`:

- A "Blocked" column renders after Verification containing every job with
  `is_blocked = true` (accounting blocks manually, or jobs auto-spawn blocked
  while the deal sits in Partial Payment).
- Blocked jobs are hidden from their normal stage column and cannot be
  dragged; the column is not a drop target.
- On unblock (manual or automatic on Paid In Full) the card reappears in the
  column it was in — `stage_id` never changed.
- Other boards keep the 🔒 badge behavior.

## 3. Done = completed (all boards with terminal `completed` stages)

`useMoveJobStage` learns about terminal stages: moving a job INTO a stage
with `terminal_outcome = 'completed'` stamps `completed_at = now()`; moving
it OUT clears it. This also activates the ✓ for Web Dev's Live/Maintenance
columns, which declared `completed` but never set the timestamp.

## 4. AI SEO cards on the Local SEO board

AI SEO jobs canonically live on the `web_seo` board and today appear on
Local SEO via stage-code equality. The new codes break that, so the page
maps explicitly:

- Display (web_seo → local_seo column): onboarding → new_project,
  audit_strategy → optimize, active → optimize, on_hold → suspended,
  cancelled → done.
- Drag (local_seo column → web_seo stage): new_project → onboarding,
  optimize → active, suspended → on_hold, done → cancelled. Dropping an
  AI SEO card on a column with no equivalent (renewal, send form, rank
  tracking, new GBP, verification) is a no-op.

## 5. Board documentation

`docs/boards/<board>.md` for: sales, accounting-onboarding, web-seo,
local-seo, web-dev, social-media, hosting, ads. Each documents: purpose of
the board, every stage (meaning, entry/exit criteria), and the automations
that touch it (job spawn on Won, partial-payment blocking, terminal
outcomes, locks). Local SEO documents the new flow above.

## Testing

- Unit: blocked-column grouping helper; move-stage completion stamping;
  AI SEO code mapping.
- Migration applied to live DB via `supabase db push`; verify board renders
  and the 2 jobs sit in New project.
- e2e smoke: board loads with the 11 columns.

## Changes / Revert

- Migration `20260610000002_local_seo_stages.sql` — rollback SQL in header
  (un-archive old stages, remap jobs back, delete new rows).
- Frontend commits are independently revertable (`git revert <sha>`).
- Docs are additive.
