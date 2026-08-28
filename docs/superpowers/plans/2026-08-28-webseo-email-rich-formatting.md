# Web SEO Onboarding Email — Rich Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `webseo_gsc_access` email (sent when a `web_seo` job — incl. the AI SEO web child — lands in `new_project`) renders exactly like the owner's reference screenshots: bold phrases, numbered section headings, a bullet list, clickable URL + e-mail links, paragraph spacing.

**Architecture:** Today `email_templates.body` is plain text and both renderers — the `send-email` edge function (`renderDbTemplate` in `supabase/functions/send-email/templates.ts`) and the admin preview (`textToHtml` in `EmailAutomationsPage.tsx`) — escape it and only add `<br/>` and URL links. We add ONE dependency-free markdown-lite renderer in `supabase/functions/_shared/emailMarkup.ts` (the house pattern for code shared by Deno edge functions and the Vite frontend — see `_shared/signature.ts`), wire it into `renderDbTemplate` (HTML + text versions) and into the admin preview, then rewrite the template body with that markup via a migration. The markup subset is `**bold**`, `## Heading`, `- bullet` lines, blank-line paragraphs, and auto-links for `http(s)://` URLs and e-mail addresses. No existing template body contains any of these markers (verified against every seed migration), so all other templates render unchanged apart from blank lines becoming real paragraphs (which is what the admin preview already showed).

**Tech Stack:** TypeScript shared module (no Deno/browser globals), Deno edge function `send-email`, React 19 admin page, Vitest (`vitest.config.ts` already includes `supabase/functions/**/*.test.ts`), Supabase SQL migration applied via the Management API script pattern, `npx supabase functions deploy` for the edge function.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`, work on `main` (team norm: push straight to `main`; other sessions commit concurrently — `git add` only the files each task names, never `--amend`, rebase/fast-forward before push, never touch other sessions' uncommitted files).
- **`npm run build` is the strict gate** (`tsc -b` → `eslint . --max-warnings=0` → `vite build`). Run before every commit touching `src/` or `supabase/functions/`.
- `supabase/functions/_shared/emailMarkup.ts` must be importable by BOTH runtimes: no `Deno.*`, no `window`/`document`, no npm imports, relative `.ts` import paths only (mirror `_shared/signature.ts`). Frontend imports it as `'../../../supabase/functions/_shared/emailMarkup.ts'` (same style as `src/features/email/SignaturePreview.tsx:4`).
- Markup subset (exact rules, both renderers share them via the module):
  - Blocks are separated by one or more blank lines (`/\n\s*\n/`).
  - A line starting with `## ` is a heading → `<h3 style="font-size:16px;font-weight:700;margin:24px 0 8px">…</h3>`.
  - A block whose every non-empty line starts with `- ` is a list → `<ul style="margin:0 0 12px 20px;padding:0">` with `<li style="margin:4px 0">…</li>`.
  - Any other block → `<p style="margin:0 0 12px">…</p>` with single newlines → `<br/>`.
  - Inline, applied after HTML-escaping in this order: URL links (`https?://[^\s<]+` → `<a href="$1" style="color:#2563eb;text-decoration:underline">$1</a>`), e-mail links (`[\w.+-]+@[\w-]+(?:\.[\w-]+)+` not already inside an `href` → `<a href="mailto:X" style="color:#2563eb;text-decoration:underline">X</a>`), then `**bold**` (`/\*\*([^*\n]+?)\*\*/g` → `<strong>$1</strong>`).
  - Plain-text version: `**` removed, `## ` removed, `- ` kept, blank lines kept.
- `{{variable}}` interpolation stays where it is (`interpolate()` runs before rendering in `renderDbTemplate`); the renderer never sees `{{`.
- **Ordering in production:** deploy the new `send-email` function BEFORE applying the body migration — otherwise the `**`/`##` markers ship raw in any email sent in between.
- Edge-function deploy and the migration both need the owner's `sbp_` Management token and are run by the owner in the session with the `!` prefix (the auto-mode classifier blocks Claude from calling `api.supabase.com`). No token is ever written to a file or committed; scripts read it from the `SBP_TOKEN` env var.
- Every migration carries a `-- ROLLBACK:` section. Back up the current row before changing it (the backup table `public.email_templates_backup_20260828` from `20260828200000` already exists — append a row to it).
- No literal secrets in markdown, migrations or commit messages.
- Test send after everything: ONE outbox row to `mkifokeris@itdev.gr` with `{"code":"TEST"}` (owner asked for it).

---

### Task 1: Shared markdown-lite renderer `emailMarkup.ts`

**Files:**
- Create: `supabase/functions/_shared/emailMarkup.ts`
- Test: `supabase/functions/_shared/emailMarkup.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function renderEmailMarkup(text: string): { html: string; text: string }` and `export function markupToText(text: string): string`. Task 2 (edge function) and Task 3 (admin preview) import `renderEmailMarkup` from this file. `html` is body-only HTML (no wrapper/signature), `text` is the plain-text version described in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/emailMarkup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderEmailMarkup, markupToText } from './emailMarkup';

describe('renderEmailMarkup', () => {
  it('turns blank-line separated blocks into paragraphs and single newlines into <br/>', () => {
    const { html } = renderEmailMarkup('α\nβ\n\nγ');
    expect(html).toBe('<p style="margin:0 0 12px">α<br/>β</p><p style="margin:0 0 12px">γ</p>');
  });

  it('renders **bold** inline as <strong>', () => {
    const { html } = renderEmailMarkup('Για τις **τεχνικές βελτιώσεις** σας.');
    expect(html).toContain('Για τις <strong>τεχνικές βελτιώσεις</strong> σας.');
    expect(html).not.toContain('**');
  });

  it('renders a "## " line as an h3 heading', () => {
    const { html } = renderEmailMarkup('## 1. Πρόσβαση στη διαχείριση\n\nκείμενο');
    expect(html).toContain('<h3 style="font-size:16px;font-weight:700;margin:24px 0 8px">1. Πρόσβαση στη διαχείριση</h3>');
    expect(html).toContain('<p style="margin:0 0 12px">κείμενο</p>');
  });

  it('renders a block of "- " lines as a bullet list with inline bold', () => {
    const { html } = renderEmailMarkup('- **Όνομα χρήστη**\n- Ιδανικά, **πλήρη δικαιώματα**');
    expect(html).toBe(
      '<ul style="margin:0 0 12px 20px;padding:0">' +
        '<li style="margin:4px 0"><strong>Όνομα χρήστη</strong></li>' +
        '<li style="margin:4px 0">Ιδανικά, <strong>πλήρη δικαιώματα</strong></li>' +
        '</ul>',
    );
  });

  it('links bare URLs and e-mail addresses (mailto), bold wrapping a link works', () => {
    const { html } = renderEmailMarkup('https://shorturl.at/OqTid\n**info@itdev.gr**\n**Email:** pefstathiadis@itdev.gr');
    expect(html).toContain('<a href="https://shorturl.at/OqTid" style="color:#2563eb;text-decoration:underline">https://shorturl.at/OqTid</a>');
    expect(html).toContain('<strong><a href="mailto:info@itdev.gr" style="color:#2563eb;text-decoration:underline">info@itdev.gr</a></strong>');
    expect(html).toContain('<strong>Email:</strong> <a href="mailto:pefstathiadis@itdev.gr"');
  });

  it('does not double-link an e-mail that is part of a URL', () => {
    const { html } = renderEmailMarkup('https://x.test/?u=a@b.co');
    expect(html.match(/<a /g)?.length).toBe(1);
  });

  it('escapes HTML before applying markup', () => {
    const { html } = renderEmailMarkup('**<script>alert(1)</script>** & "q"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> &amp; &quot;q&quot;');
  });

  it('leaves a body without markup unchanged apart from paragraphs (backwards compatible)', () => {
    const { html, text } = renderEmailMarkup('Καλησπέρα σας,\nΠαρακάτω οδηγίες.\n\nΕυχαριστούμε.');
    expect(html).toBe('<p style="margin:0 0 12px">Καλησπέρα σας,<br/>Παρακάτω οδηγίες.</p><p style="margin:0 0 12px">Ευχαριστούμε.</p>');
    expect(text).toBe('Καλησπέρα σας,\nΠαρακάτω οδηγίες.\n\nΕυχαριστούμε.');
  });

  it('returns empty html/text for a blank body', () => {
    expect(renderEmailMarkup('   \n\n ')).toEqual({ html: '', text: '' });
  });
});

describe('markupToText', () => {
  it('strips ** and "## " but keeps bullets, links and blank lines', () => {
    expect(markupToText('## Τίτλος\n\n**Bold** κείμενο\n- **α**\n- β\n\nhttps://x.test'))
      .toBe('Τίτλος\n\nBold κείμενο\n- α\n- β\n\nhttps://x.test');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run supabase/functions/_shared/emailMarkup.test.ts`
Expected: FAIL — `Cannot find module './emailMarkup'`.

- [ ] **Step 3: Implement the renderer**

Create `supabase/functions/_shared/emailMarkup.ts`:

```ts
// Markdown-lite renderer for admin-editable email_templates bodies — the
// single source of truth for BOTH the send-email edge function (Deno) and the
// admin preview in EmailAutomationsPage (Vite/vitest). Keep this file
// dependency-free and free of Deno/browser globals so both runtimes import it.
//
// Supported markup (everything else is literal text, HTML-escaped):
//   blank line          → paragraph break
//   "## Heading"        → <h3>
//   "- item" lines      → <ul><li> (a block where every line starts with "- ")
//   **bold**            → <strong>
//   http(s)://… / a@b.c → clickable links (mailto for e-mail addresses)
// {{variables}} are interpolated by the caller BEFORE rendering.

const P_STYLE = 'margin:0 0 12px';
const H_STYLE = 'font-size:16px;font-weight:700;margin:24px 0 8px';
const UL_STYLE = 'margin:0 0 12px 20px;padding:0';
const LI_STYLE = 'margin:4px 0';
const A_STYLE = 'color:#2563eb;text-decoration:underline';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// URL links first, then e-mails that are NOT inside an <a …> we just made
// (split on anchors so "https://x/?u=a@b.co" is linked once), then bold.
function inline(escaped: string): string {
  const withUrls = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="${A_STYLE}">${url}</a>`,
  );
  const withMail = withUrls
    .split(/(<a [^>]*>[^<]*<\/a>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g,
            (mail) => `<a href="mailto:${mail}" style="${A_STYLE}">${mail}</a>`,
          ),
    )
    .join('');
  return withMail.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
}

function renderBlock(block: string): string {
  const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (lines.length === 0) return '';
  if (lines.every((l) => l.startsWith('- '))) {
    const items = lines.map((l) => `<li style="${LI_STYLE}">${inline(escapeHtml(l.slice(2).trim()))}</li>`);
    return `<ul style="${UL_STYLE}">${items.join('')}</ul>`;
  }
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p style="${P_STYLE}">${para.map((l) => inline(escapeHtml(l))).join('<br/>')}</p>`);
    para = [];
  };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      out.push(`<h3 style="${H_STYLE}">${inline(escapeHtml(line.slice(3).trim()))}</h3>`);
    } else {
      para.push(line);
    }
  }
  flush();
  return out.join('');
}

/** Plain-text twin of the HTML: markup markers removed, structure kept. */
export function markupToText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^## /, '').replace(/\*\*([^*\n]+?)\*\*/g, '$1'))
    .join('\n')
    .trim();
}

export function renderEmailMarkup(text: string): { html: string; text: string } {
  const html = text
    .split(/\n\s*\n/)
    .map(renderBlock)
    .filter(Boolean)
    .join('');
  return { html, text: markupToText(text) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run supabase/functions/_shared/emailMarkup.test.ts`
Expected: PASS (10 tests). If the `markupToText` test fails on the trailing/leading whitespace only, the bug is in the `.trim()` placement — the expected string has no leading/trailing newline.

- [ ] **Step 5: Strict gate + commit**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npm run build`
Expected: exit 0 (the file is outside `src/` so tsc-b ignores it, but eslint lints it — fix any lint findings in the new files only).

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add supabase/functions/_shared/emailMarkup.ts supabase/functions/_shared/emailMarkup.test.ts
git commit -m "feat(email): shared markdown-lite renderer for template bodies

Changes: _shared/emailMarkup.ts — **bold**, ## headings, - bullets,
paragraphs, URL + mailto links; HTML and plain-text output. Not wired
in yet. Revert: git revert this commit."
```

---

### Task 2: `send-email` renders DB template bodies through the shared renderer

**Files:**
- Modify: `supabase/functions/send-email/templates.ts:304-340` (`renderDbTemplate`)
- Test: `supabase/functions/send-email/templates.test.ts`

**Interfaces:**
- Consumes: `renderEmailMarkup(text)` from Task 1 (`import { renderEmailMarkup } from '../_shared/emailMarkup.ts'`).
- Produces: unchanged signature `renderDbTemplate(row, data, opts?): Rendered` — `html` body now comes from the renderer; `text` = `renderEmailMarkup(...).text` (+ company signature as before). `index.ts` needs no change.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('email templates', …)` block in `supabase/functions/send-email/templates.test.ts` (keep every existing test):

```ts
  it('renders markdown-lite markup from an admin-edited template body', () => {
    const r = renderDbTemplate(
      {
        subject: '{{code}} - Πρόσβαση',
        body: '## 1. Πρόσβαση\n\nΓια τις **βελτιώσεις** σας:\n\n- **Όνομα χρήστη**\n- Κωδικό\n\n**Email:** info@itdev.gr\nhttps://shorturl.at/OqTid',
        client_facing: true,
      },
      { code: '000123' },
    );
    expect(r.subject).toBe('000123 - Πρόσβαση');
    expect(r.html).toContain('<h3 style="font-size:16px;font-weight:700;margin:24px 0 8px">1. Πρόσβαση</h3>');
    expect(r.html).toContain('Για τις <strong>βελτιώσεις</strong> σας:');
    expect(r.html).toContain('<li style="margin:4px 0"><strong>Όνομα χρήστη</strong></li>');
    expect(r.html).toContain('<a href="mailto:info@itdev.gr"');
    expect(r.html).toContain('<a href="https://shorturl.at/OqTid"');
    expect(r.html).not.toContain('**');
    expect(r.html).not.toContain('## ');
    // plain-text twin: markers stripped, structure kept, signature appended
    expect(r.text.startsWith('1. Πρόσβαση\n\nΓια τις βελτιώσεις σας:\n\n- Όνομα χρήστη\n- Κωδικό\n\nEmail: info@itdev.gr\nhttps://shorturl.at/OqTid')).toBe(true);
    expect(r.text).toContain('IT DEV');
  });

  it('keeps interpolating {{variables}} before markup rendering', () => {
    const r = renderDbTemplate(
      { subject: 'S', body: 'Γεια **{{name}}**', client_facing: false },
      { name: 'Μαρία' },
    );
    expect(r.html).toContain('<strong>Μαρία</strong>');
    expect(r.text).toBe('Γεια Μαρία');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run supabase/functions/send-email/templates.test.ts`
Expected: the two new tests FAIL (html contains literal `**` / `## `); all pre-existing tests still PASS.

- [ ] **Step 3: Wire the renderer into `renderDbTemplate`**

In `supabase/functions/send-email/templates.ts` add the import at the top (next to the existing `_shared` imports — there is `import { renderSignatureHtml, renderSignatureText } from '../_shared/signature.ts'` or similar; keep style):

```ts
import { renderEmailMarkup } from '../_shared/emailMarkup.ts';
```

Then in `renderDbTemplate` replace

```ts
  const bodyText = interpolate(row.body, data);
```
with
```ts
  // Admin-edited bodies may carry markdown-lite markup (**bold**, ## heading,
  // - bullets, links). One shared renderer feeds both the HTML and the
  // plain-text part — and the admin preview uses the same module.
  const body = renderEmailMarkup(interpolate(row.body, data));
  const bodyText = body.text;
```
and replace the `shell(` call's first argument

```ts
    `<p>${linkify(escapeHtml(bodyText)).replace(/\n/g, '<br/>')}</p>${cta}${footer}`,
```
with
```ts
    `${body.html}${cta}${footer}`,
```

Leave `linkify` / `escapeHtml` in place — the built-in templates (`custom`, payment reminders, weekly report…) still use them. If eslint reports them unused, they are still used elsewhere in the file; do not delete them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run supabase/functions/send-email`
Expected: PASS — including the pre-existing `renderDbTemplate` tests (`appends a CTA button…` still finds `<a href="https://x.test/verify?a=1&amp;b=2"` because the renderer's URL link runs on escaped text; `renders no CTA button without data.cta_url` still has no `<a href=` because body `Hi` has no links).

- [ ] **Step 5: Strict gate + commit**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npm run build`
Expected: exit 0.

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add supabase/functions/send-email/templates.ts supabase/functions/send-email/templates.test.ts
git commit -m "feat(email): send-email renders template bodies with markdown-lite markup

Changes: renderDbTemplate uses _shared/emailMarkup for the HTML body and
the plain-text part (bold/headings/bullets/mailto). Built-in templates
unchanged. Deploy: npx supabase functions deploy send-email (owner).
Revert: git revert this commit + redeploy."
```

---

### Task 3: Admin preview uses the same renderer + markup hint

**Files:**
- Modify: `src/features/email_automations/EmailAutomationsPage.tsx:24` (import) and `:131-149` (variables hint + preview)
- Modify: `src/i18n/locales/el/admin.json` (`email_automations` block, near line 151) and `src/i18n/locales/en/admin.json` (same)
- Create: `src/features/email_automations/templatePreview.ts`
- Test: `src/features/email_automations/emailTemplatePreview.test.ts`

**Interfaces:**
- Consumes: `renderEmailMarkup` from Task 1 via `'../../../supabase/functions/_shared/emailMarkup.ts'`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/features/email_automations/emailTemplatePreview.test.ts` — a pure test that the preview HTML the page will inject matches the renderer's HTML (this pins the "preview = what is sent" contract without rendering the whole page):

```ts
import { describe, it, expect } from 'vitest';
import { templatePreviewHtml } from './templatePreview';
import { renderEmailMarkup } from '../../../supabase/functions/_shared/emailMarkup.ts';

describe('templatePreviewHtml', () => {
  it('is exactly the send-email HTML body for the same markup', () => {
    const body = '## Τίτλος\n\n**Bold** και link https://x.test\n\n- α\n- β';
    expect(templatePreviewHtml(body)).toBe(renderEmailMarkup(body).html);
    expect(templatePreviewHtml(body)).toContain('<strong>Bold</strong>');
    expect(templatePreviewHtml(body)).toContain('<li style="margin:4px 0">α</li>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run src/features/email_automations`
Expected: FAIL — `Cannot find module './templatePreview'`.

- [ ] **Step 3: Implement**

Create `src/features/email_automations/templatePreview.ts`:

```ts
import { renderEmailMarkup } from '../../../supabase/functions/_shared/emailMarkup.ts';

/** HTML for the admin "Προεπισκόπηση" box — the SAME renderer send-email uses,
 *  so what admins see is what the client receives (minus shell + signature).
 *  Safe to inject: the renderer HTML-escapes the body before adding markup tags. */
export function templatePreviewHtml(body: string): string {
  return renderEmailMarkup(body).html;
}
```

In `src/features/email_automations/EmailAutomationsPage.tsx`:
- line 24: replace `import { textToHtml } from '@/features/offers/offerEmailBody';` with `import { templatePreviewHtml } from './templatePreview';` (if `textToHtml` is used anywhere else in this file, keep the old import too — check with grep).
- lines 146-148: replace
  ```tsx
                // Safe: textToHtml escapes all template text before adding <p>/<br>/<a>.
                dangerouslySetInnerHTML={{ __html: textToHtml(body) }}
  ```
  with
  ```tsx
                // Safe: the shared renderer escapes all template text before adding markup tags.
                dangerouslySetInnerHTML={{ __html: templatePreviewHtml(body) }}
  ```
- Directly under the `<textarea …/>` (after its closing `/>` inside the same `<div>`), add the hint:
  ```tsx
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('email_automations.markup_hint')}
              </p>
  ```
- Also relax the preview container class so headings/lists show: change `[&_p]:mb-2 [&_p:last-child]:mb-0` to `[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-bold` (inline styles from the renderer already set margins; the Tailwind classes only add the bullet marker Tailwind's preflight removes).

i18n — add inside the `"email_automations"` object, after `"variables"`:
- `src/i18n/locales/el/admin.json`: `"markup_hint": "Μορφοποίηση: **έντονα**, «## Επικεφαλίδα» στην αρχή γραμμής, «- » για λίστα, κενή γραμμή = νέα παράγραφος. Links και emails γίνονται αυτόματα σύνδεσμοι.",`
- `src/i18n/locales/en/admin.json`: `"markup_hint": "Formatting: **bold**, \"## Heading\" at line start, \"- \" for a list, blank line = new paragraph. URLs and e-mails become links automatically.",`

- [ ] **Step 4: Run tests + gate**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run src/features/email_automations src/features/offers && npm run build`
Expected: vitest PASS (offer tests untouched — `offerEmailBody.ts` is not modified); build exit 0. If tsc complains about importing a `.ts` extension path, copy exactly how `src/features/email/SignaturePreview.tsx:4` imports `_shared/signature.ts` — it works there.

- [ ] **Step 5: Commit**

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add src/features/email_automations/templatePreview.ts src/features/email_automations/emailTemplatePreview.test.ts src/features/email_automations/EmailAutomationsPage.tsx src/i18n/locales/el/admin.json src/i18n/locales/en/admin.json
git commit -m "feat(email-admin): template preview uses the shared markup renderer + syntax hint

Changes: preview HTML = renderEmailMarkup(body).html (what send-email
sends); markup_hint i18n (el/en) under the body editor.
Revert: git revert this commit."
```

---

### Task 4: New `webseo_gsc_access` body with markup (migration) + deploy/apply/test-send runbook

**Files:**
- Create: `supabase/migrations/20260829000000_webseo_gsc_access_body_v3_markup.sql`
- Create (scratchpad, NOT committed): `/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/apply-webseo-v3.mjs`
- Reference: `supabase/migrations/20260828200000_webseo_gsc_access_body_v2.sql` (previous body + backup table), `docs/tech/technical/onboarding-emails.md`

**Interfaces:**
- Consumes: the markup rules from Task 1 (the body below is written in them) and the deployed edge function from Task 2.
- Produces: the live template body; one test email to the owner.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260829000000_webseo_gsc_access_body_v3_markup.sql` (body transcribed from the owner's reference screenshots, 2026-08-28; `–` in the step titles is an EN DASH, `«»` are Greek quotes):

```sql
-- 2026-08-28: webseo_gsc_access v3 — same content as v2 (20260828200000) but
-- formatted the way the owner's reference screenshots show: bold phrases,
-- "## " section headings, a "- " bullet list, clickable URL + mailto links.
-- Requires the send-email edge function that renders markdown-lite markup
-- (supabase/functions/_shared/emailMarkup.ts) to be DEPLOYED FIRST — with
-- the old function the ** / ## markers would ship raw.
--
-- Backup: appends the current row to email_templates_backup_20260828
-- (created by 20260828200000; locked down, RLS on).
--
-- LIVE DRIFT CHECK: pending — record pre/post md5(body) here when applied.

insert into public.email_templates_backup_20260828
  select now(), t.* from public.email_templates t where t.key = 'webseo_gsc_access';

update public.email_templates
   set body = $body$Καλησπέρα σας,

Για να ξεκινήσουμε τις **τεχνικές βελτιώσεις και τις απαραίτητες ρυθμίσεις στην ιστοσελίδα σας**, θα χρειαστούμε τις παρακάτω προσβάσεις:

## 1. Πρόσβαση στη διαχείριση της ιστοσελίδας

Παρακαλούμε να μας αποστείλετε τα στοιχεία πρόσβασης στο διαχειριστικό περιβάλλον της ιστοσελίδας σας, είτε αυτή λειτουργεί σε **WordPress, OpenCart** είτε σε κάποια άλλη αντίστοιχη πλατφόρμα.

Θα χρειαστούμε:

- **Όνομα χρήστη**
- **Κωδικό πρόσβασης**
- Ιδανικά, **πλήρη δικαιώματα διαχειριστή (Administrator)**

Με αυτόν τον τρόπο θα μπορέσουμε να προχωρήσουμε άμεσα στις απαραίτητες τεχνικές ενέργειες.

Εάν δεν γνωρίζετε τα στοιχεία πρόσβασης ή την πλατφόρμα στην οποία έχει κατασκευαστεί η ιστοσελίδα σας, πιθανότατα τα διαχειρίζεται ο developer ή η εταιρεία που ανέλαβε την κατασκευή της. Σε αυτή την περίπτωση, μπορείτε να απευθυνθείτε σε αυτούς για τα σχετικά στοιχεία.

## 2. Πρόσβαση στο Google Search Console

Μπορείτε να ακολουθήσετε τα απαραίτητα βήματα μέσω του παρακάτω βίντεο:

https://shorturl.at/OqTid

Εναλλακτικά, ακολουθήστε τις παρακάτω οδηγίες:

**Βήμα 1 – Είσοδος**
Συνδεθείτε στον λογαριασμό σας στο **Google Search Console**.

**Βήμα 2 – Επιλογή ιδιοκτησίας**
Από το πτυσσόμενο μενού επάνω αριστερά, επιλέξτε την ιστοσελίδα στην οποία θέλετε να παραχωρήσετε πρόσβαση.

**Βήμα 3 – Ρυθμίσεις**
Κάντε κλικ στην επιλογή **«Ρυθμίσεις»**, στο κάτω μέρος της αριστερής στήλης.

**Βήμα 4 – Χρήστες και δικαιώματα**
Επιλέξτε την ενότητα **«Χρήστες και δικαιώματα»**.

**Βήμα 5 – Προσθήκη χρήστη**
Κάντε κλικ στο κουμπί **«Προσθήκη χρήστη»**, επάνω δεξιά.

**Βήμα 6 – Καταχώριση email**
Καταχωρίστε το email:

**info@itdev.gr**

Επιλέξτε **«Πλήρης άδεια»** και στη συνέχεια πατήστε **«Προσθήκη»**.

## Δεν διαθέτετε Google Search Console;

Εάν δεν διαθέτετε λογαριασμό ή ιδιοκτησία στο Google Search Console, ενημερώστε μας.

Μπορούμε να αναλάβουμε τη **δημιουργία και τη σωστή ρύθμισή του**, εφόσον διαθέτουμε πρόσβαση στη διαχείριση της ιστοσελίδας σας.

## Έναρξη εργασιών

Μόλις λάβουμε τις παραπάνω προσβάσεις, θα προχωρήσουμε άμεσα στις **τεχνικές ρυθμίσεις και τις απαραίτητες βελτιστοποιήσεις** της ιστοσελίδας.

## Χρειάζεστε βοήθεια;

Εάν αντιμετωπίσετε οποιαδήποτε δυσκολία κατά τη διαδικασία, μπορείτε να επικοινωνήσετε με τον υπεύθυνο Web SEO, **κ. Παύλο Ευσταθιάδη**:

**Email:** pefstathiadis@itdev.gr
**Τηλέφωνο:** 210 260 3414, εσωτερικό 104

Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση.$body$,
       updated_at = now()
 where key = 'webseo_gsc_access';

-- ROLLBACK:
-- update public.email_templates t
--    set body = b.body, updated_at = now()
--   from (select body from public.email_templates_backup_20260828
--          where key = 'webseo_gsc_access' order by backed_up_at desc limit 1) b
--  where t.key = 'webseo_gsc_access';
```

- [ ] **Step 2: Render the migration body locally and eyeball it against the screenshots**

Create `/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/render-v3.mjs` (not committed) that extracts the `$body$…$body$` text from the migration and writes `/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/webseo-v3.html` using the shared renderer wrapped in the same font shell send-email uses:

```js
import { readFileSync, writeFileSync } from 'node:fs';
const sql = readFileSync('/Users/marios/Desktop/Projects/itdevcrm-main/supabase/migrations/20260829000000_webseo_gsc_access_body_v3_markup.sql', 'utf8');
const body = sql.split('$body$')[1];
const { renderEmailMarkup } = await import('/Users/marios/Desktop/Projects/itdevcrm-main/supabase/functions/_shared/emailMarkup.ts');
const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">${renderEmailMarkup(body).html}</div>`;
writeFileSync('/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/webseo-v3.html', html);
console.log('ok', html.length);
```

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && node /private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/render-v3.mjs` (Node ≥ 22.6 strips TS types; the machine has Node 24). Open `/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/webseo-v3.html` in Chrome (claude-in-chrome `navigate` to `file://…`) and compare with the two reference screenshots: headings "1. …", "2. …", "Δεν διαθέτετε…", "Έναρξη εργασιών", "Χρειάζεστε βοήθεια;" bold+larger; three bullets; `**Βήμα N – …**` bold line followed by a normal line in the same paragraph; `info@itdev.gr` bold link; `Email:`/`Τηλέφωνο:` labels bold; URL clickable. Fix the migration text (not the renderer) for any wording mismatch.

- [ ] **Step 3: Commit the migration (drift-check still "pending")**

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add supabase/migrations/20260829000000_webseo_gsc_access_body_v3_markup.sql
git commit -m "feat(email): webseo_gsc_access v3 — formatted body (headings, bold, bullets, links)

Changes: template body rewritten with markdown-lite markup per the owner's
reference layout; previous row appended to email_templates_backup_20260828.
NOT yet applied — deploy send-email first, then apply (see plan Task 4).
Revert: ROLLBACK section."
```

- [ ] **Step 4: Owner runbook — deploy, apply, test-send (in this order)**

Write `/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/apply-webseo-v3.mjs` (reads `SBP_TOKEN` from env; never written to disk):

```js
import { readFileSync } from 'node:fs';
const token = process.env.SBP_TOKEN?.trim();
if (!token) { console.error('SBP_TOKEN env var missing'); process.exit(2); }
const PROJECT = 'xujlrclyzxrvxszepquy';
const MIGRATION = '/Users/marios/Desktop/Projects/itdevcrm-main/supabase/migrations/20260829000000_webseo_gsc_access_body_v3_markup.sql';
const ROW = "select key, md5(body) as body_md5, length(body) as body_len, updated_at from public.email_templates where key = 'webseo_gsc_access'";
async function q(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'supabase-cli/2.30.4' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
console.log('pre :', JSON.stringify((await q(ROW))[0]));
await q(readFileSync(MIGRATION, 'utf8'));
console.log('post:', JSON.stringify((await q(ROW))[0]));
console.log('backup rows:', JSON.stringify(await q('select count(*) as n from public.email_templates_backup_20260828')));
const out = await q(`insert into public.email_outbox (identity, to_email, template_key, data)
  values ('accounting', 'mkifokeris@itdev.gr', 'webseo_gsc_access', '{"code":"TEST"}'::jsonb) returning id, status`);
console.log('test email enqueued:', JSON.stringify(out[0]));
```

Then hand the owner these two commands to run in the session (the `!` prefix runs them here so the output lands in the conversation; the classifier blocks Claude from running them):

1. Deploy the edge function (Tasks 1–2 must be committed; the CLI bundles from the working tree):
   ```
   ! cd /Users/marios/Desktop/Projects/itdevcrm-main && SUPABASE_ACCESS_TOKEN=sbp_XXXX npx -y supabase@latest functions deploy send-email --project-ref xujlrclyzxrvxszepquy
   ```
   Expected: `Deployed Functions on project xujlrclyzxrvxszepquy: send-email`. If the CLI asks for Docker, add `--use-api`.
2. Apply the body + send the test email:
   ```
   ! SBP_TOKEN=sbp_XXXX node /private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/apply-webseo-v3.mjs
   ```
   Expected: `pre` md5 `26a8fda61bebe0538775f964ded5c893` (the v2 body, 2209 chars); `post` a different md5; `backup rows: 2`; `test email enqueued: {"id": …, "status":"pending"}`.

- [ ] **Step 5: Verify + record drift check + push**

After the owner's output: (a) confirm the outbox row went `sent` (owner runs a read-only query, or the owner checks the inbox); (b) the owner opens the test email — it must look like the reference screenshots; (c) fill the migration header line `-- LIVE DRIFT CHECK: pending …` with `pre 26a8fda6… → post <md5>` and the apply date; (d) delete `/private/tmp/claude-501/-Users-marios/c8f5d988-331e-4054-9c1f-2b202d969691/scratchpad/apply-webseo-v3.mjs` and `render-v3.mjs`; (e) commit + push:

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add supabase/migrations/20260829000000_webseo_gsc_access_body_v3_markup.sql
git commit -m "chore(migrations): record live drift check for webseo_gsc_access v3 apply"
git fetch origin && git merge-base --is-ancestor origin/main HEAD && git push origin main
```
(If `origin/main` moved and the working tree has other sessions' uncommitted files, do NOT rebase with autostash — wait for a clean tree or ask the owner.)

Also update `docs/tech/technical/onboarding-emails.md` "Data model" bullet for `email_templates` in the same commit: after "(plain text; newlines → `<br>`, URLs auto-linkified by the send-email function)" replace with "(markdown-lite: `**bold**`, `## heading`, `- bullets`, blank-line paragraphs; URLs and e-mails auto-linked — rendered by `supabase/functions/_shared/emailMarkup.ts`, the same module the admin preview uses)".
