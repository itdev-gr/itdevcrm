# Web Development board (`/tech/web-dev`)

Cards are **jobs** for website/app builds — one-time projects taken from first
contact through to launch. Columns mirror the agency's ClickUp Web Dev pipeline.

## How cards arrive

A deal containing a Web Dev service reaches **Partial Payment** → the job
spawns in **New Project**, and **unblocked** (unlike every other service):
build work can start on the deposit. Auto-assigned to the Web Dev team lead
when one is set; otherwise it spawns unassigned.

## Stages

| #   | Stage                       | Greek                   | What it means / what the team does                                                                                                      |
| --- | --------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **New Project**             | Νέο Έργο                | Entry column. A new website/app project just landed. Review the deal (scope, pricing, notes from sales), open the client file, and plan the first contact. |
| 2   | **Client Contact**          | Επικοινωνία Πελάτη      | Reaching out to kick off: introductions, set expectations, and start gathering what's needed to begin.                                  |
| 3   | **Called / No response**    | Χωρίς Απάντηση          | We tried to reach the client and got no answer. Park here and keep following up (call/email) until contact is made, then move forward.  |
| 4   | **Get requirements - Creds**| Απαιτήσεις & Κωδικοί    | Collecting the brief, content, and **access/credentials** (hosting, domain, CMS, assets) needed to build.                              |
| 5   | **Planning**                | Σχεδιασμός              | Scope confirmed. Plan the build — sitemap, page structure, features, integrations, timeline.                                            |
| 6   | **Development**             | Ανάπτυξη                | Active build: templates, pages, CMS, content entry, integrations. The main "doing the work" column.                                     |
| 7   | **Stuck**                   | Κολλημένο               | Work is blocked on something (missing content/asset, a technical blocker, a dependency). Park here, flag the blocker, resume when clear.|
| 8   | **Revision**                | Διόρθωση                | Working through change requests and fixes — internal findings or the client's requested tweaks.                                         |
| 9   | **Redesign**                | Επανασχεδιασμός         | Larger rework of the design or approach, beyond small revisions.                                                                        |
| 10  | **Waiting client Approval** | Αναμονή Έγκρισης Πελάτη | Build/changes are done; waiting for the client to review and approve before launch.                                                     |
| 11  | **Live** ✅                 | Παραδόθηκε              | Terminal (outcome **completed**). Site launched/delivered. Dropping the card here stamps the job completed (✓); dragging it back out clears the stamp. |

## Automations & rules

- Web Dev is the **only** service that spawns **unblocked** on partial payment —
  build starts on the deposit.
- **The website is never blocked for non-payment.** When a client doesn't pay and
  accounting's deal goes **On Hold**, their other services are blocked but the
  Web Dev job (the website) keeps running — and a closed deal never moves into a
  monthly Renewal/Done cycle (Web Dev is a one-time build, not a subscription).
- Accounting can still **manually block** the job (e.g. an overdue balance
  before launch); the 🔒 badge then shows in place (this board has no separate
  Blocked column).
- **Live** stamps `completed_at` (✓ on the card); dragging a card back out of
  Live clears it.

## Client emails (automatic — 2026-08-24)

Three automations, each with its own switch in email automation settings
(`webdev_form_auto`, `webdev_form_followup_auto`, `webdev_waiting_nudge`):

- **Intake form auto-send** — every NEW web_dev job (created after go-live;
  older jobs are never emailed) gets the client intake form email
  automatically within 15 minutes. The intake card shows «Στάλθηκε αυτόματα».
- **Form follow-ups** — if the client hasn't submitted: reminder on day 3 and
  day 8 (weekday mornings, never a third email); on day 12 the job owner and
  the team lead get a notification to call the client.
- **Waiting-client nudge** — a card sitting in *Waiting client approval* or
  *No response* emails the client a polite reminder on day 3 and day 7 of the
  waiting period; on day 10 the owner + team lead are notified instead. A new
  waiting period restarts the sequence. Per-job opt-out: the Info-tab field
  «Χωρίς αυτόματες υπενθυμίσεις πελάτη».

Manual sending from the intake card still works and is the fallback.

## Suggested flow

```
New Project ──► Get requirements ──► Planning ──► Development ──► Waiting client Approval ──► Live
     │                                                │   ▲
     ▼                                                ▼   │
Called / No response                            Revision / Redesign
Stuck: temporary parking whenever work is blocked, at any point
```
