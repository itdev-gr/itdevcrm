# Web SEO board (`/tech/web-seo`)

Cards are **jobs** for organic-search work on client websites. This board also
hosts **AI SEO** jobs (purple "AI SEO" badge) — they share these stages and
additionally mirror onto the Local SEO board. Columns mirror the agency's
ClickUp Web SEO pipeline.

## How cards arrive

A deal containing a Web SEO (or AI SEO) service reaches **Partial Payment** →
the job spawns in **New Project**, 🔒 blocked until **Paid In Full**.
Auto-assigned to the Web SEO team lead when one is set.

**The client is emailed automatically.** When a Web SEO job lands in **New
Project**, the CRM sends the client the **Google Search Console access-request
email** for you — so the access ask is already on its way before you make first
contact.

## Stages

| #   | Stage                  | Greek                  | What it means / what the team does                                                                                          |
| --- | ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **New Project**        | Νέο Έργο               | Entry column. A new Web SEO/AI SEO client just landed. Review the deal, goals, and notes from sales, and plan first contact. |
| 2   | **No Response**        | Χωρίς Απάντηση         | We tried to reach the client (for access/details) and got no answer. Follow up until contact is made.                       |
| 3   | **Renewal**            | Ανανέωση               | An existing client whose subscription renewed for another period. **Cards land here automatically every time the client pays** — restart the cycle, review last period and plan next. |
| 4   | **GSC & GA4 Setup**    | Ρύθμιση GSC & GA4      | Mandatory access & setup: Google Search Console + GA4 analytics, plus site/CMS credentials.                                 |
| 5   | **Sitemap & Schema**   | Sitemap & Schema       | Put sitemap.xml, robots.txt, and schema markup in place.                                                                     |
| 6   | **Performance Audit**  | Έλεγχος Απόδοσης       | Performance & technical-quality check — speed, Core Web Vitals, technical health.                                            |
| 7   | **Technical Crawl**    | Τεχνικός Έλεγχος       | Full crawl & technical audit of the site: errors, indexability, structure.                                                  |
| 8   | **Keyword Research**   | Έρευνα Keywords        | Keyword and competitor research; build the target keyword list and strategy.                                                |
| 9   | **Metadata**           | Metadata               | Optimize titles, meta descriptions, and headings across target pages.                                                       |
| 10  | **Content**            | Περιεχόμενο            | Content enrichment and on-page optimization across the target pages.                                                        |
| 11  | **Internal Links**     | Εσωτ. Σύνδεσμοι        | Build and tidy the internal linking structure.                                                                              |
| 12  | **Backlink Cleanup**   | Καθαρισμός Backlinks   | Audit the backlink profile and clean it up (disavow toxic links).                                                          |
| 13  | **Blogs**              | Μπλογκ                 | Blog/article production for topical coverage and freshness.                                                                 |
| 14  | **Results Review**     | Έλεγχος Αποτελεσμάτων  | Review performance via GSC & Semrush; measure impact and iterate (often loops back to the audit/crawl steps).               |
| 15  | **Stuck**              | Κολλημένο              | Blocked on something (client input, access, a dependency). Park here, flag the blocker, resume when it clears.              |
| 16  | **Done**               | Ολοκληρώθηκε           | **A monthly rest, not the end.** Use it for "this period's work is finished, waiting for the client to renew." It is **not** terminal — the next payment automatically restarts the job in **Renewal**. (To end the engagement for good, accounting **Closes** the deal, which sends the job to **Closed**.) |

## Automations & rules

- **Onboarding email:** a job arriving in **New Project** triggers the **Google
  Search Console access-request email** to the client automatically.
- **Paid → Renewal:** every time the client pays, the job automatically moves to
  **Renewal** to start the new cycle — from wherever it was (Active, Done, or
  blocked).
- **Done = monthly rest:** Done is *not* the end of the job, just "finished for
  this period, waiting for renewal." The next payment restarts it in Renewal.
- **On Hold = work paused for non-payment:** if the client doesn't pay by the due
  date, accounting's deal goes On Hold and this job is **blocked** (shown with the
  🔒 badge). AI SEO blocks together (its Web SEO + Local SEO parts pause as one).
  Jobs already in **Done** are left alone. The website and hosting are never
  blocked.
- **Deal Closed → Closed:** when accounting closes the deal, the job moves to
  **Done/Closed** as the permanent end of the work.
- Blocked jobs show the 🔒 badge **in place** (this board has no separate
  Blocked column).
- **AI SEO** jobs share these stages and also mirror onto the Local SEO board
  (see below).
- Monthly recurring amounts feed Accounting → Recurring and the MRR figure on
  the report.

## AI SEO cards (Local SEO mirror)

AI SEO jobs live on these Web SEO stages but also display on the **Local SEO**
board. The two boards no longer share stage codes, so a fixed mapping is used:

| Web SEO stage                                                                 | Shown on Local SEO as |
| ----------------------------------------------------------------------------- | --------------------- |
| New Project                                                                   | New project           |
| No Response                                                                   | Called/No response    |
| Renewal                                                                       | Renewal               |
| All work stages (GSC & GA4 → Results Review)                                  | Optimize              |
| Stuck                                                                         | Suspended             |
| Done                                                                          | Done                  |

Dragging an AI SEO card on the **Local SEO** board writes back to a Web SEO
stage: New project → New Project, Renewal → Renewal, Called/No response → No
Response, Optimize → Content, Suspended → Stuck, Done → Done. Local SEO columns
with no Web SEO equivalent (Send form, Rank tracking, New GBP, Verification) do
nothing.
