# Settings Documentation Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new admin-only Settings → Documentation tab: a developer/technical reference organized by department → process, rendered in-app with Mermaid diagrams, content version-controlled as markdown.

**Architecture:** Reuse the existing `react-markdown` + TOC stack; add a lazy-loaded Mermaid renderer; load `docs/tech/**/*.md` via `import.meta.glob`; a `docIndex.ts` drives the department→process nav. Content authored per-area from the real migrations/code via research subagents.

**Tech Stack:** React + TS + Tailwind, react-markdown + remark-gfm (present), mermaid (new, lazy), vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-tech-documentation-tab-design.md`

---

## File Map
- `src/components/docs/MermaidDiagram.tsx` — lazy Mermaid renderer (themed).
- `src/components/docs/MermaidDiagram.test.tsx` — render + theme test.
- `src/components/docs/TechDocView.tsx` — renders one doc (markdown + TOC + mermaid).
- `src/features/documentation/docIndex.ts` — department→process nav model + glob loader.
- `src/features/documentation/docIndex.test.ts` — integrity test.
- `src/features/documentation/DocumentationPage.tsx` — two-pane page.
- `src/app/router.tsx`, `src/app/AdminLayout.tsx`, `src/i18n/locales/{el,en}/admin.json` — route + tab + label.
- `docs/tech/**/*.md` — the content (authored per area).
- `docs/boards/*.md` — updated user-facing guides.

---

## Task 1: Mermaid renderer (lazy, themed)

**Files:** Create `src/components/docs/MermaidDiagram.tsx` + `.test.tsx`

- [ ] **Step 1: Install mermaid**

```bash
npm install mermaid
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/components/docs/MermaidDiagram.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

const renderMock = vi.fn().mockResolvedValue({ svg: '<svg data-testid="m-svg"></svg>' });
const initialize = vi.fn();
vi.mock('mermaid', () => ({ default: { initialize, render: renderMock } }));
vi.mock('@/lib/stores/themeStore', () => ({
  useThemeStore: (sel: (s: unknown) => unknown) => sel({ resolved: 'dark' }),
}));

import { MermaidDiagram } from './MermaidDiagram';

describe('MermaidDiagram', () => {
  it('renders the mermaid SVG and uses the dark theme', async () => {
    render(<MermaidDiagram chart={'graph TD; A-->B'} />);
    await waitFor(() => expect(screen.getByTestId('m-svg')).toBeInTheDocument());
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module './MermaidDiagram'`).

Run: `npx vitest run src/components/docs/MermaidDiagram.test.tsx`

- [ ] **Step 4: Implement**

```tsx
// src/components/docs/MermaidDiagram.tsx
import { useEffect, useId, useRef, useState } from 'react';
import { useThemeStore } from '@/lib/stores/themeStore';

export function MermaidDiagram({ chart }: { chart: string }) {
  const resolved = useThemeStore((s) => (s as { resolved?: 'light' | 'dark' }).resolved ?? 'light');
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: resolved === 'dark' ? 'dark' : 'default' });
        const { svg } = await mermaid.render(`mmd-${id}`, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [chart, resolved, id]);

  if (error) {
    return <pre className="my-4 overflow-x-auto rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{chart}</pre>;
  }
  return <div ref={ref} className="my-5 flex justify-center overflow-x-auto rounded-lg border border-border/60 bg-card p-4" />;
}
```

> Verify the `themeStore` selector field name first: read `src/lib/stores/themeStore.ts` — if the resolved-mode field is not `resolved`, adjust both the component and the test mock to the real name (e.g. `mode`).

- [ ] **Step 5: Run test — PASS.** `npx vitest run src/components/docs/MermaidDiagram.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/docs/MermaidDiagram.tsx src/components/docs/MermaidDiagram.test.tsx
git commit -m "feat(docs): lazy themed Mermaid diagram renderer"
```

---

## Task 2: TechDocView (markdown + TOC + mermaid)

**Files:** Create `src/components/docs/TechDocView.tsx`

- [ ] **Step 1: Implement** (mirrors `BoardDocView` but takes a raw markdown string and renders ```mermaid fences via `MermaidDiagram`)

```tsx
// src/components/docs/TechDocView.tsx
import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractToc, splitDocIntoBlocks } from '@/lib/markdown-toc';
import { MermaidDiagram } from './MermaidDiagram';

const components = {
  h1: (p: React.ComponentProps<'h1'>) => <h1 className="mb-4 text-2xl font-bold tracking-tight" {...p} />,
  p: (p: React.ComponentProps<'p'>) => <p className="my-3 text-sm leading-7 text-foreground" {...p} />,
  ul: (p: React.ComponentProps<'ul'>) => <ul className="my-3 list-disc space-y-1.5 pl-6 text-sm text-foreground" {...p} />,
  ol: (p: React.ComponentProps<'ol'>) => <ol className="my-3 list-decimal space-y-1.5 pl-6 text-sm text-foreground" {...p} />,
  li: (p: React.ComponentProps<'li'>) => <li className="leading-7" {...p} />,
  a: (p: React.ComponentProps<'a'>) => <a className="font-medium text-[#157777] underline-offset-2 hover:underline dark:text-[#7ad4d4]" {...p} />,
  table: (p: React.ComponentProps<'table'>) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border/60"><table className="w-full border-collapse text-sm" {...p} /></div>
  ),
  thead: (p: React.ComponentProps<'thead'>) => <thead className="bg-muted/60 text-left" {...p} />,
  th: (p: React.ComponentProps<'th'>) => <th className="border-b border-border/60 px-3 py-2.5 font-semibold text-muted-foreground" {...p} />,
  td: (p: React.ComponentProps<'td'>) => <td className="border-b border-border/50 px-3 py-2.5 align-top text-foreground" {...p} />,
  code: (p: React.ComponentProps<'code'>) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]" {...p} />,
  pre: ({ children, ...rest }: React.ComponentProps<'pre'>) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cn = (child as { props?: { className?: string } } | undefined)?.props?.className ?? '';
    if (cn.includes('language-mermaid')) {
      const chart = String((child as { props: { children: unknown } }).props.children).trim();
      return <MermaidDiagram chart={chart} />;
    }
    return <pre className="my-4 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-4 text-xs leading-6" {...rest}>{children}</pre>;
  },
};

export function TechDocView({ markdown }: { markdown: string }) {
  const toc = useMemo(() => extractToc(markdown), [markdown]);
  const blocks = useMemo(() => splitDocIntoBlocks(markdown, toc), [markdown, toc]);
  return (
    <article className="min-w-0 rounded-xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">
      {blocks.map((block, i) =>
        block.type === 'heading' ? (
          block.level === 2 ? (
            <h2 key={block.id} id={block.id} className="scroll-mt-24 border-b border-border/60 pb-2 pt-4 text-xl font-semibold first:pt-0">{block.text}</h2>
          ) : (
            <h3 key={block.id} id={block.id} className="scroll-mt-24 pt-4 text-base font-semibold">{block.text}</h3>
          )
        ) : (
          <Markdown key={`md-${i}`} remarkPlugins={[remarkGfm]} components={components}>{block.content}</Markdown>
        ),
      )}
    </article>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc -b` → no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/docs/TechDocView.tsx
git commit -m "feat(docs): TechDocView renders markdown + TOC + mermaid"
```

---

## Task 3: docIndex + glob loader + integrity test

**Files:** Create `src/features/documentation/docIndex.ts` + `docIndex.test.ts`

- [ ] **Step 1: Implement the index + loader**

```ts
// src/features/documentation/docIndex.ts
const DOCS = import.meta.glob('../../../docs/tech/**/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

export type DocEntry = { slug: string; title: string; file: string };
export type DocArea = { area: string; areaTitle: string; docs: DocEntry[] };

// Single source of nav order. `file` is the path tail under docs/tech/.
export const DOC_AREAS: DocArea[] = [
  { area: 'overview', areaTitle: 'Overview', docs: [
    { slug: 'architecture', title: 'Architecture & stack', file: 'overview/architecture.md' },
    { slug: 'data-model', title: 'Data model map', file: 'overview/data-model.md' },
    { slug: 'environments', title: 'Environments & deploy', file: 'overview/environments.md' },
    { slug: 'conventions', title: 'Conventions & gotchas', file: 'overview/conventions.md' },
  ]},
  { area: 'sales', areaTitle: 'Sales', docs: [
    { slug: 'lead-intake', title: 'Lead intake', file: 'sales/lead-intake.md' },
    { slug: 'distribution', title: 'Lead distribution', file: 'sales/distribution.md' },
    { slug: 'kanban', title: 'Sales kanban & stages', file: 'sales/kanban.md' },
    { slug: 'conversion', title: 'Lead → deal conversion', file: 'sales/conversion.md' },
  ]},
  { area: 'accounting', areaTitle: 'Accounting', docs: [
    { slug: 'deal-lifecycle', title: 'Deal & onboarding stages', file: 'accounting/deal-lifecycle.md' },
    { slug: 'billing-model', title: 'Billing model (jobs & payments)', file: 'accounting/billing-model.md' },
    { slug: 'block-lifecycle', title: 'Block / On-Hold lifecycle', file: 'accounting/block-lifecycle.md' },
    { slug: 'renewal-close', title: 'Renewal & close', file: 'accounting/renewal-close.md' },
    { slug: 'payment-reminders', title: 'Payment reminders', file: 'accounting/payment-reminders.md' },
  ]},
  { area: 'technical', areaTitle: 'Technical', docs: [
    { slug: 'service-boards', title: 'Service boards & job lifecycle', file: 'technical/service-boards.md' },
    { slug: 'ai-seo', title: 'AI SEO 3-row split', file: 'technical/ai-seo.md' },
    { slug: 'onboarding-emails', title: 'SEO onboarding emails', file: 'technical/onboarding-emails.md' },
    { slug: 'info-attachments', title: 'Service Info & attachments', file: 'technical/info-attachments.md' },
  ]},
  { area: 'platform', areaTitle: 'Platform', docs: [
    { slug: 'email-system', title: 'Email system', file: 'platform/email-system.md' },
    { slug: 'auth-permissions', title: 'Auth, permissions & RLS', file: 'platform/auth-permissions.md' },
    { slug: 'tasks-notifications', title: 'Tasks & notifications', file: 'platform/tasks-notifications.md' },
    { slug: 'integrations', title: 'Integrations', file: 'platform/integrations.md' },
    { slug: 'monitoring', title: 'Monitoring & health', file: 'platform/monitoring.md' },
  ]},
];

export function loadDoc(file: string): string | null {
  const entry = Object.entries(DOCS).find(([path]) => path.endsWith(`/docs/tech/${file}`));
  return entry?.[1] ?? null;
}
export function allDocFiles(): string[] { return DOC_AREAS.flatMap((a) => a.docs.map((d) => d.file)); }
export function globbedFiles(): string[] {
  return Object.keys(DOCS).map((p) => p.slice(p.indexOf('/docs/tech/') + '/docs/tech/'.length));
}
```

- [ ] **Step 2: Write the integrity test**

```ts
// src/features/documentation/docIndex.test.ts
import { describe, it, expect } from 'vitest';
import { DOC_AREAS, loadDoc, allDocFiles, globbedFiles } from './docIndex';

describe('docIndex', () => {
  it('every indexed doc resolves to a real file', () => {
    for (const f of allDocFiles()) expect(loadDoc(f), `missing ${f}`).toBeTruthy();
  });
  it('has no orphan markdown files (every globbed file is indexed)', () => {
    const indexed = new Set(allDocFiles());
    for (const f of globbedFiles()) expect(indexed.has(f), `orphan ${f}`).toBe(true);
  });
  it('slugs are unique within an area', () => {
    for (const a of DOC_AREAS) {
      const slugs = a.docs.map((d) => d.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
```

This test fails until Task 5 creates the `.md` files — run it after content exists (Task 5 Step N). For now just commit the index + test.

- [ ] **Step 3: Commit**

```bash
git add src/features/documentation/docIndex.ts src/features/documentation/docIndex.test.ts
git commit -m "feat(docs): docIndex nav model + glob loader + integrity test"
```

---

## Task 4: DocumentationPage + route + tab + label

**Files:** Create `src/features/documentation/DocumentationPage.tsx`; modify `src/app/router.tsx`, `src/app/AdminLayout.tsx`, `src/i18n/locales/{el,en}/admin.json`

- [ ] **Step 1: Implement the page** (left dept→process nav, right `TechDocView`; selection in `?doc=`)

```tsx
// src/features/documentation/DocumentationPage.tsx
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TechDocView } from '@/components/docs/TechDocView';
import { DOC_AREAS, loadDoc } from './docIndex';

export function DocumentationPage() {
  const [params, setParams] = useSearchParams();
  const first = DOC_AREAS[0]!.docs[0]!;
  const current = params.get('doc') ?? `${DOC_AREAS[0]!.area}/${first.slug}`;
  const file = DOC_AREAS.flatMap((a) => a.docs).find((d) =>
    DOC_AREAS.some((ar) => ar.docs.includes(d) && current === `${ar.area}/${d.slug}`),
  )?.file;
  const markdown = file ? loadDoc(file) : null;

  return (
    <div className="flex min-h-full gap-6">
      <aside className="hidden w-64 shrink-0 lg:block">
        <nav className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto rounded-xl border border-border/60 bg-card p-4 shadow-sm">
          {DOC_AREAS.map((area) => (
            <div key={area.area}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{area.areaTitle}</p>
              <ul className="space-y-0.5">
                {area.docs.map((d) => {
                  const key = `${area.area}/${d.slug}`;
                  const active = current === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setParams({ doc: key })}
                        className={cn('block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors',
                          active ? 'bg-primary/10 font-medium text-primary ring-1 ring-primary/25'
                                 : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                      >{d.title}</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        {markdown ? <TechDocView markdown={markdown} />
          : <div className="rounded-xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">Doc not found.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the lazy route** in `src/app/router.tsx` — add near the other admin `lazyPage` decls:

```ts
const DocumentationPage = lazyPage(() => import('@/features/documentation/DocumentationPage'), 'DocumentationPage');
```
and add to the `/admin` children array (next to `announcements`):
```tsx
{ path: 'documentation', element: <DocumentationPage /> },
```

- [ ] **Step 3: Add the tab** in `src/app/AdminLayout.tsx` `SETTINGS_TABS`:

```ts
{ to: '/admin/documentation', key: 'documentation' },
```

- [ ] **Step 4: Add the label** to `src/i18n/locales/en/admin.json` and `el/admin.json` under the same section the other tab keys live in (read the file first; mirror the existing key style):
- en: `"documentation": "Documentation"`
- el: `"documentation": "Τεκμηρίωση"`

- [ ] **Step 5: Build.** `npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/documentation/DocumentationPage.tsx src/app/router.tsx src/app/AdminLayout.tsx src/i18n/locales/en/admin.json src/i18n/locales/el/admin.json
git commit -m "feat(settings): Documentation tab (dept -> process nav + TechDocView)"
```

---

## Task 5: Author the content (per area, research-driven)

Each doc follows ONE template:

```markdown
# <Process Title>
**Purpose** — 1–2 sentences.
## Data model
Tables + key columns involved.
## Flow
```mermaid
flowchart TD
  ...real states/transitions...
```
## Functions / triggers / crons
Exact names + what each does + when it fires.
## Gotchas
The non-obvious things that bite.
## File references
`migration / src` paths (file:line where useful).
```

For each area, dispatch a research subagent (read-only) to extract the exact identifiers, then write the docs.

- [ ] **Step 1 — Accounting** (highest value; do first). Research subagent reads `supabase/migrations/2026060*..2026062*` for: deal stages, `deal_payments`, `enqueue_payment_reminders`, `move_overdue_deals_to_on_hold`, `reconcile_block_lifecycle`, `block_deal_jobs`, `release_deal_jobs`, `deals_hold_jobs_on_stage_change`, `deals_close_jobs_on_close`, `deal_payments_release_from_on_hold`, `deal_payments_move_to_awaiting`, `guard_payment_method_before_stage_move`, `ensure_recurring_payments`. Write `docs/tech/accounting/{deal-lifecycle,billing-model,block-lifecycle,renewal-close,payment-reminders}.md` per template, with an accurate Mermaid stage/lifecycle diagram. Cross-check against `docs/superpowers/specs/2026-06-26-*lifecycle*` and the memory.
- [ ] **Step 2 — Technical.** Subagent reads the service-board migrations, `jobs_seo_onboarding_email`, the AI SEO split migrations, `jobs.details`/attachments. Write `docs/tech/technical/{service-boards,ai-seo,onboarding-emails,info-attachments}.md`.
- [ ] **Step 3 — Sales.** Subagent reads lead intake / Meta webhook / import RPCs, distribution (`sales_pool_ids`, round-robin), sales stages, conversion/lock. Write `docs/tech/sales/{lead-intake,distribution,kanban,conversion}.md`.
- [ ] **Step 4 — Platform.** Subagent reads `email_templates`/`email_outbox`/`send-email` edge fn/drain/pulse/dept toggles; permissions engine + RLS; tasks/notifications; integrations (meta, yeastar, resend); sentry/health. Write `docs/tech/platform/{email-system,auth-permissions,tasks-notifications,integrations,monitoring}.md`.
- [ ] **Step 5 — Overview.** Write `docs/tech/overview/{architecture,data-model,environments,conventions}.md` from the gathered material + `docs/system-analysis/2026-06-17-*` + memory.
- [ ] **Step 6: Run the docIndex integrity test** — `npx vitest run src/features/documentation/docIndex.test.ts` → PASS (all indexed docs exist, no orphans).
- [ ] **Step 7: Commit** each area as it lands (`docs(tech): <area> reference`).

---

## Task 6: Update the user-facing board guides

**Files:** Modify `docs/boards/{accounting,accounting-onboarding,web-seo,local-seo,social-media,ads,hosting,web-dev,sales}.md`

- [ ] **Step 1:** For each board guide, add/refresh a plain-language section on the new processes that touch it: On-Hold→blocked, Done = monthly rest, Paid → Renewal, deal Closed → all jobs to Closed, and the relevant emails. Keep the existing how-to tone (these render at `/sales/docs`, `/accounting/docs`, `/tech/*/docs`).
- [ ] **Step 2: Commit** `docs(boards): update guides with block/renewal/close + email processes`.

---

## Task 7: Final build + push

- [ ] **Step 1:** `npx vitest run src/components/docs src/features/documentation` → all PASS.
- [ ] **Step 2:** `npm run build` → PASS.
- [ ] **Step 3:** Manually verify the tab: nav switches docs, a Mermaid diagram renders, dark mode is readable.
- [ ] **Step 4:** `git push origin main` (confirm).

---

## Self-review notes
- Spec coverage: tab+route+admin-gate (T4); markdown+TOC reuse + Mermaid (T1/T2); docIndex + integrity (T3); content by department→process with template + diagrams (T5); board-guide updates (T6); tests + build (T1-3,7). Frontend-only; no DB/migration.
- Consistency: `DOC_AREAS`/`loadDoc`/`TechDocView`/`MermaidDiagram` names used consistently; doc `file` paths in T3 match the files authored in T5.
