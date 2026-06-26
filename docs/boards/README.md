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
   which starts immediately. Moving to **Paid In Full** completes accounting,
   unblocks all the deal's jobs, and moves each renewable service to its
   board's **Renewal** column for the new cycle.
3. **Technical teams** work each job across their own board. Jobs spawn in
   the board's first column and are assigned to the service group's team
   lead (when one is set).
4. **Non-payment → On Hold → blocked**: if a client doesn't pay by the due
   date, accounting's deal goes **On Hold** and their open jobs are
   automatically **blocked** — everything **except the website (Web Dev) and
   hosting**, which keep running. AI SEO blocks together. Blocked jobs show a
   🔒 badge (the Local SEO board collects them in a dedicated **Blocked**
   column); they return to their exact stage when the block clears. Accounting
   can also block/unblock any job manually.
5. **Paid → Renewal**: every time the client pays, all their renewable
   services (**Web SEO, Local SEO, Ads, Social**) automatically move to their
   board's **Renewal** column to start the new cycle.
6. **Done = monthly rest**: on the recurring boards (Web SEO, Local SEO, Ads,
   Social), **Done** means "this period's work is finished, waiting for
   renewal" — *not* the end. The next payment restarts the job in Renewal.
7. **Deal Closed → Closed**: when accounting closes a deal, **all** its jobs
   automatically move to their board's **Closed** column — the permanent end
   of the work.
8. **Onboarding emails**: a new **Web SEO** job in New Project auto-sends the
   client the Google Search Console access-request email; a new **Local SEO**
   job in New project auto-sends the Google Business Profile access-request
   email.
9. **Payment reminders**: clients are emailed automatic reminders **7 days
   before due, 1 day after, and 7 days after**; accounting can pause them per
   deal with the **"Pause payment reminders"** toggle on the deal's Payment
   tab.
