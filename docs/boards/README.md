# ITDevCRM boards — documentation index

Every kanban board in the CRM, what each column means, and the automations
that move cards around. Stage data lives in the `pipeline_stages` table
(admin → Settings → Pipeline stages); job blocking and spawning logic lives
in Supabase functions (`release_jobs_for_deal`, `block_job`, `unblock_job`,
`complete_accounting`).

| Board                 | Route                    | Doc                                                  |
| --------------------- | ------------------------ | ---------------------------------------------------- |
| Sales pipeline        | `/sales/kanban`          | [sales.md](sales.md)                                 |
| Accounting onboarding | `/accounting/onboarding` | [accounting-onboarding.md](accounting-onboarding.md) |
| Web SEO               | `/tech/web-seo`          | [web-seo.md](web-seo.md)                             |
| Local SEO             | `/tech/local-seo`        | [local-seo.md](local-seo.md)                         |
| Web Development       | `/tech/web-dev`          | [web-dev.md](web-dev.md)                             |
| Social Media          | `/tech/social-media`     | [social-media.md](social-media.md)                   |
| Hosting               | `/tech/hosting`          | [hosting.md](hosting.md)                             |
| Ads                   | `/tech/ads`              | [ads.md](ads.md)                                     |

## The shared lifecycle

1. **Sales** works a lead across the sales pipeline. Dropping it in **Won**
   converts the lead to a client + deal, locks the deal, and opens a card on
   the **Accounting onboarding** board.
2. **Accounting** verifies documents, issues the invoice, and tracks payment.
   Moving the deal to **Partial Payment** spawns one job per sold service on
   the technical boards — _blocked_ (🔒) for every service except Web Dev,
   which starts immediately. Moving to **Paid In Full** completes accounting
   and unblocks all the deal's jobs.
3. **Technical teams** work each job across their own board. Jobs spawn in
   the board's first column and are assigned to the service group's team
   lead (when one is set).
4. **Blocking**: accounting (or an admin) can manually block/unblock any job
   at any time (`Block` button on the job page). Blocked jobs show a 🔒
   badge; on the Local SEO board they move to a dedicated **Blocked** column
   and return to their previous column automatically when unblocked.
5. **Completion**: dropping a job into a terminal "completed" stage (Local
   SEO **Done**, Web Dev **Live**/**Maintenance**) stamps it completed (✓);
   dragging it back out clears the stamp.
