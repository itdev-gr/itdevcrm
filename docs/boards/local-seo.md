# Local SEO board (`/tech/local-seo`)

Workflow for Google Business Profile (GBP) and local-search work. Cards are
**jobs**: one per client per Local SEO service sold. AI SEO jobs also appear
here (see "AI SEO cards" below).

## How cards arrive

- A deal containing a Local SEO service reaches **Partial Payment** on the
  accounting board → a Local SEO job spawns in **New project**, 🔒 blocked
  until the deal is **Paid In Full** (it sits in the Blocked column until
  then).
- Jobs are auto-assigned to the Local SEO group's team lead when one is set;
  otherwise they spawn unassigned.

## Stages

| #   | Stage                  | Greek                   | What it means / what the team does                                                                                                                                                                                                       |
| --- | ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **New project**        | Νέο Έργο                | Entry column. A new Local SEO client just landed. Review the deal (services, pricing, notes from sales), open the client file, and decide the first action — usually contacting the client for access and business details.              |
| 2   | **Renewal**            | Ανανέωση                | An existing client whose subscription renewed for another period. The cycle restarts here instead of New project so renewals are distinguishable from first-time setups; review last period's results and plan the next one.             |
| 3   | **Called/No response** | Κλήση/Χωρίς Απάντηση    | We tried to reach the client (for access, details, or the intake form) and they did not respond. Cards parked here need a follow-up call or email; chase until contact is made, then move forward.                                       |
| 4   | **Send form**          | Αποστολή Φόρμας         | Contact established — send the client the intake form (business info, categories, hours, photos, access). The card waits here until the form comes back; then move to Optimize or New GBP depending on whether a profile already exists. |
| 5   | **Optimize**           | Βελτιστοποίηση          | Active optimization of an existing GBP: categories, services, descriptions, photos, posts, citations/NAP consistency, review strategy, on-site local signals. The main "doing the work" column.                                          |
| 6   | **Rank tracking**      | Παρακολούθηση Κατάταξης | Optimization is in place; the job is in steady-state monitoring. Track local rankings (map pack + organic), watch reviews and Q&A, do periodic refreshes. Recurring monthly work usually lives here between optimization pushes.         |
| 7   | **New GBP**            | Νέο GBP                 | The client has no Google Business Profile — create one from scratch: profile creation, category setup, address/service-area configuration, initial content. Usually followed by Verification.                                            |
| 8   | **Done** ✅            | Ολοκληρωμένο            | Terminal stage. Dropping a card here stamps the job completed (✓ on the card) and it stops counting as active work. Dragging it back out clears the stamp. Use for one-time projects that finished or subscriptions that ended cleanly.  |
| 9   | **Suspended**          | Σε Αναστολή             | Google suspended the profile (or the listing is otherwise down). Work the reinstatement: appeal, evidence documents, compliance fixes. High-priority parking — the client is invisible on Maps while here.                               |
| 10  | **Verification**       | Επαλήθευση              | The profile is awaiting Google verification (postcard, video, phone). Track the verification attempt, retry if it fails, and move to Optimize/Rank tracking once verified.                                                               |
| 11  | **🔒 Blocked**         | Μπλοκαρισμένο           | **Virtual column — not a real stage.** Every blocked job is displayed here automatically instead of its own column. See below.                                                                                                           |

## The Blocked column

- A job lands here when **accounting blocks it**: automatically while the
  deal is in Partial Payment, or manually via the **Block** button on the
  job page (accounting/admin only) — typically when a payment is overdue.
- The job's real stage never changes: when accounting unblocks it (manually,
  or automatically when the deal hits Paid In Full), the card returns to
  exactly the column it was in.
- Blocked cards cannot be dragged, and nothing can be dropped on the Blocked
  column — block/unblock is accounting's call, not a drag action.
- While the _client_ is blocked, monthly task editing is disabled and
  non-admins cannot move any of that client's jobs.

## AI SEO cards

AI SEO jobs canonically live on the Web SEO board, but also show on this
board. Their Web SEO stages map onto Local SEO columns for display: New
Project → New project, No Response → Called/No response, Renewal → Renewal,
all work stages (GSC & GA4 → Results Review) → Optimize, Stuck → Suspended,
Done → Done. Dragging an AI SEO card to a Local SEO column with no Web SEO
equivalent (Send form, Rank tracking, New GBP, Verification) does nothing.

## Suggested flow

```
New project ──► Send form ──► Optimize ──► Rank tracking ──► Done
     │              ▲   │          ▲
     ▼              │   ▼          │
Called/No response ─┘  New GBP ──► Verification
                                    │
Renewal ──► Optimize (cycle)        ▼
                               Suspended (reinstatement) ──► back to Optimize
🔒 Blocked: automatic overlay at any point until payment is settled
```
