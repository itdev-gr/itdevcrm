# Settings → Documentation tab (developer tech reference)

**Date:** 2026-06-26
**Status:** Draft for review (no implementation yet)

## Problem

The system has grown a lot of interlocking processes (billing/block/renewal/close lifecycle,
email automation, lead pipeline, permissions, integrations) with knowledge spread across
migrations, edge functions, and memory. A new developer has no single, accurate, up-to-date
reference for how it all works.

## Goal

A new admin-only **Settings → Documentation** tab: a comprehensive **developer/technical
reference**, organized **by department → process**, rendered in-app with **Mermaid diagrams**,
and version-controlled as markdown so the next dev keeps it current. Plus: update the existing
user-facing board guides with the new processes.

## Architecture

- **Route/tab:** `/admin/documentation`, added to `SETTINGS_TABS` in `AdminLayout.tsx`
  (admin-gated by the existing `AdminGuard`). Tab label via `admin.json` (`documentation`).
- **Page:** `src/features/documentation/DocumentationPage.tsx` — two-pane:
  - **Left:** a nav tree grouped by department (Overview, Sales, Accounting, Technical,
    Platform), each listing its processes. Selected doc tracked in the URL query
    (`?doc=<area>/<slug>`), default = the Overview doc.
  - **Right:** the selected doc rendered as markdown + a table-of-contents, reusing the
    existing `BoardDocView` markdown component set (`src/components/docs/BoardDocView.tsx`)
    and TOC helper (`src/lib/markdown-toc.ts`).
- **Content storage:** version-controlled markdown under a new `docs/tech/<area>/<slug>.md`
  tree, loaded with `import.meta.glob('/docs/tech/**/*.md', { query:'?raw', import:'default',
  eager:true })` (same pattern the app already uses for `docs/boards`).
- **Index:** `src/features/documentation/docIndex.ts` — the single source of nav order:
  an array of `{ area, areaTitle, docs: [{ slug, title, path }] }`. Adding a doc = drop a
  `.md` file + one index line. A test asserts every index `path` resolves to a real glob key
  and every glob file is referenced (no orphans).
- **Diagrams (Mermaid):** add `mermaid` (dynamic-imported, so it only loads on this page).
  A `MermaidDiagram` component renders ` ```mermaid ` code fences as SVG, themed from
  `themeStore` (dark → mermaid `dark` theme). The markdown `code` renderer detects
  `language-mermaid` and routes to `MermaidDiagram`; all other code stays as today.

## Content (comprehensive, by department → process)

Each process doc follows one template: **Purpose → Data model (tables/columns) → Flow
(Mermaid) → Functions / triggers / crons → Gotchas → File references**.

- **Overview:** architecture & stack; data model map; environments/deploy (Vercel + Supabase);
  conventions (migrations via MCP, RLS, build strictness); secrets/env.
- **Sales:** lead intake (Meta webhook / CSV import → `lead_intake` → release/merge); round-robin
  distribution; sales kanban + stages; lead→deal conversion + lock; sales welcome emails.
- **Accounting:** onboarding stages; billing model (jobs = billing unit, `deal_payments`,
  recurring generation); **payment-driven block / On-Hold lifecycle** (due-date, reconciler,
  payment_method guard); **Done = monthly rest → Renewal on payment**; **deal close → Closed**;
  payment reminders; partial / paid-in-full.
- **Technical:** the 6 service boards; job lifecycle (Done, virtual block, renewal, close);
  **AI SEO 3-row split**; per-service onboarding emails (GSC/GBP on New-project entry); Info
  tab + per-service attachments.
- **Platform:** email system (templates → `email_outbox` → `send-email` edge fn → drain/pulse,
  department toggles, dedupe); auth, groups, capabilities & RLS; tasks & notifications;
  activity log; integrations (Meta leads, Yeastar PBX, Resend); monitoring (Sentry, email
  health).

## Also: update user-facing board guides

Update `docs/boards/*.md` (rendered at `/sales/docs`, `/accounting/docs`, `/tech/*/docs`) with
the new block / renewal / close lifecycle and the email processes — in plain how-to language
for staff (distinct from the developer reference).

## Build approach

The infra (tab, renderer, Mermaid, docIndex) is a small engineered unit. The content is the
bulk: research subagents extract the exact tables/functions/triggers/crons per area from the
migrations + code, then each doc is written grounded in real identifiers + an accurate diagram.

## Testing

- **docIndex integrity** (vitest): every index `path` resolves to a globbed file; no orphan
  files. Slugs unique.
- **Mermaid component** (vitest, mocked dynamic import): renders a container for a chart string;
  picks dark theme when themeStore is dark.
- **Build:** `npm run build` passes (Mermaid lazy-loaded; no bundle blow-up on other routes).
- **Manual:** the tab loads, nav switches docs, diagrams render, dark mode readable.

## Changes / Revert

| Change | Revert |
| --- | --- |
| Add `mermaid` dep + `MermaidDiagram` + markdown `code` hook | remove dep + component; restore renderer |
| New `/admin/documentation` route + tab + `DocumentationPage` + `docIndex.ts` | remove route/tab/files |
| New `docs/tech/**` content | delete folder |
| Updated `docs/boards/*.md` | git revert those edits |

Frontend-only + markdown; no DB changes, no prod migration. All atomic commits.
