# Email Composer: Rich Text + Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CRM email composer (New email + Reply) sends the recipient formatted text (bold/italic/underline/colour/lists/link) and file attachments.

**Architecture:** Phase 1 (Tasks 1-3) is frontend-only: a lightweight `contentEditable` rich-text editor whose HTML is sanitised (DOMPurify) and sent as the already-existing `html` field. Phase 2 (Tasks 4-6) adds attachments: reuse the comment file-staging UI, upload to the `attachments` bucket, and rebuild the personal-Gmail message as `multipart/mixed` in the `send-email` edge function.

**Tech Stack:** React/TS, TanStack Query, vitest, DOMPurify (new dep), Supabase Storage + edge functions (Deno), Gmail API.

**Spec:** `docs/superpowers/specs/2026-07-23-email-composer-richtext-attachments-design.md`

## Global Constraints

- Work on main; commit per task; push directly (no PRs; `git pull --rebase` on rejection). Commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `npm run build` (tsc -b + eslint --max-warnings=0) must pass. vitest is file-scoped ONLY (repo has prod-hitting integration tests) — never the bare suite.
- Formatting scope is **email-basic**: bold, italic, underline, text colour, bullet + numbered lists, link. No font sizes/headings/inline images.
- Sanitiser allowlist — TAGS: `p, br, b, strong, i, em, u, a, ul, ol, li, span, div`; ATTR: `href, target, rel, style`; `style` restricted to `color` only; `href` restricted to `http/https/mailto`; every `<a>` forced to `rel="noopener noreferrer" target="_blank"`.
- Attachment limits: per-file ≤ 25 MB; **total ≤ 18 MB** raw (keeps the base64 Gmail message under 25 MB). Enforced on BOTH client and server.
- Personal Gmail send requires the sender's own user JWT (unchanged); attachment bytes are fetched service-role from the allowlisted `attachments` bucket.
- Edge-function deploy: `supabase functions deploy send-email` with `SUPABASE_ACCESS_TOKEN=<sbp token>` (owner supplies; rotate after). No DB schema change anywhere.
- Non-goal: the CRM Emails tab keeps rendering sent copies as plain text without attachment chips (out of scope).
- The `send-email` `sendPersonal` path already wraps `data.html` in a div + appends the signature (`index.ts:290`) — Phase 1 needs NO backend change.

## File Structure

- Create: `src/features/email/sanitizeEmailHtml.ts` (+ `.test.ts`) — DOMPurify wrapper, strict email allowlist.
- Create: `src/features/email/RichTextEditor.tsx` (+ `.test.tsx`) — contentEditable + toolbar.
- Modify: `src/features/email/SendEmailDialog.tsx` — editor in place of textarea; (Phase 2) file staging.
- Modify: `src/features/email/useSendEmail.ts` — send sanitised HTML + `htmlToText` text; (Phase 2) forward attachment refs.
- Create: `src/features/email/hooks/useEmailAttachmentStaging.ts` (+ `.test.ts`) — upload/stage/remove/cleanup files to `attachments` bucket.
- Modify: `supabase/functions/send-email/attachments.ts` — allowlist `attachments`, raise cap, optional `mimeType`, total-size guard.
- Modify: `supabase/functions/_shared/google.ts` — `buildMime` multipart/mixed when attachments present (single-part unchanged otherwise).
- Modify: `supabase/functions/send-email/index.ts` — `sendPersonal` fetches + passes attachments to `buildMime`.
- Modify: `src/i18n/locales/{en,el}/email.json` — toolbar/attachment labels + errors.

---

## PHASE 1 — Rich text

### Task 1: `sanitizeEmailHtml` (+ DOMPurify)

**Files:** Create `src/features/email/sanitizeEmailHtml.ts`, `src/features/email/sanitizeEmailHtml.test.ts`.

**Interfaces:**
- Produces: `sanitizeEmailHtml(html: string): string` — returns HTML containing only the allowlisted tags/attrs; `style` limited to `color`; unsafe hrefs dropped; `<a>` forced `rel="noopener noreferrer" target="_blank"`. Used by Task 3 (`useSendEmail`) and Task 2 (defensive load).

- [ ] **Step 1: Add DOMPurify.** `npm install dompurify && npm install -D @types/dompurify`. Verify it lands in `package.json` dependencies.

- [ ] **Step 2: Write the failing test** `sanitizeEmailHtml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';

describe('sanitizeEmailHtml', () => {
  it('keeps allowed formatting', () => {
    const html = '<p>Hi <strong>bold</strong> <em>it</em> <u>u</u> <span style="color:#e11d48">red</span></p><ul><li>a</li></ul>';
    const out = sanitizeEmailHtml(html);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('color:');
    expect(out).toContain('<li>a</li>');
  });
  it('strips scripts, event handlers, and disallowed tags', () => {
    const out = sanitizeEmailHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
  });
  it('drops non-color inline styles', () => {
    const out = sanitizeEmailHtml('<span style="color:red;position:fixed;background:url(x)">t</span>');
    expect(out).toContain('color:red');
    expect(out).not.toContain('position');
    expect(out).not.toContain('background');
  });
  it('forces safe link attributes and blocks javascript: hrefs', () => {
    expect(sanitizeEmailHtml('<a href="https://x.gr">l</a>')).toContain('rel="noopener noreferrer"');
    expect(sanitizeEmailHtml('<a href="https://x.gr">l</a>')).toContain('target="_blank"');
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">l</a>')).not.toContain('javascript:');
  });
  it('preserves Greek text', () => {
    expect(sanitizeEmailHtml('<p>Καλημέρα <strong>κόσμε</strong></p>')).toContain('Καλημέρα');
  });
});
```

Run: `npx vitest run src/features/email/sanitizeEmailHtml.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `sanitizeEmailHtml.ts`:**

```ts
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'span', 'div'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'style'];

// Keep only `color:` declarations in any style attribute (drops position/background/etc.).
function keepColorOnly(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => /^color\s*:/i.test(d))
    .join('; ');
}

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element) {
      if (node.hasAttribute('style')) {
        const kept = keepColorOnly(node.getAttribute('style') ?? '');
        if (kept) node.setAttribute('style', kept);
        else node.removeAttribute('style');
      }
      if (node.tagName === 'A') {
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
      }
    }
  });
}

/** Sanitise author HTML for outgoing email: allowlisted formatting tags,
 *  color-only inline styles, safe http/https/mailto links with rel/target. */
export function sanitizeEmailHtml(html: string): string {
  ensureHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}
```

- [ ] **Step 4: Run the test** → PASS (5 tests). `npm run build` → clean.

- [ ] **Step 5: Commit.**
```bash
git add package.json package-lock.json src/features/email/sanitizeEmailHtml.ts src/features/email/sanitizeEmailHtml.test.ts
git commit -m "feat(email): sanitizeEmailHtml (DOMPurify, email-safe allowlist)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

### Task 2: `RichTextEditor` component

**Files:** Create `src/features/email/RichTextEditor.tsx`, `src/features/email/RichTextEditor.test.tsx`. Modify `src/i18n/locales/{en,el}/email.json`.

**Interfaces:**
- Consumes: `sanitizeEmailHtml` (Task 1) to sanitise `value` when loading it into the DOM.
- Produces: `<RichTextEditor value={string} onChange={(html: string) => void} disabled?={boolean} ariaLabel={string} />`. Toolbar commands: bold, italic, underline, colour (palette popover), bullet list, numbered list, link. Emits `el.innerHTML` on input.

- [ ] **Step 1: Add i18n keys** to `src/i18n/locales/en/email.json` and `el/email.json` under a new `editor` object: `bold, italic, underline, color, bullet_list, numbered_list, link, link_prompt`. EN values: "Bold","Italic","Underline","Text colour","Bullet list","Numbered list","Link","Enter URL:". EL values: "Έντονα","Πλάγια","Υπογράμμιση","Χρώμα κειμένου","Λίστα με κουκκίδες","Αριθμημένη λίστα","Σύνδεσμος","Δώσε URL:".

- [ ] **Step 2: Write the failing test** `RichTextEditor.test.tsx`: render with `value=''`; assert the toolbar buttons exist (by aria-label / role button with the EN labels); typing into the contentEditable region (fire `input` with innerHTML set) calls `onChange` with the HTML. Mock `document.execCommand = vi.fn()` and assert clicking Bold calls `execCommand('bold')`. Run → FAIL (module missing).

- [ ] **Step 3: Implement `RichTextEditor.tsx`:**

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Palette } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';

const COLORS = ['#0f172a', '#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  ariaLabel: string;
};

export function RichTextEditor({ value, onChange, disabled, ariaLabel }: Props) {
  const { t } = useTranslation('email');
  const ref = useRef<HTMLDivElement | null>(null);

  // Load external value only when it diverges (avoids caret jumps on each keystroke).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = sanitizeEmailHtml(value);
  }, [value]);

  function exec(cmd: string, arg?: string) {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function onLink() {
    const url = window.prompt(t('editor.link_prompt', { defaultValue: 'Enter URL:' }));
    if (url) exec('createLink', url);
  }

  const btn = 'flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';

  return (
    <div className="rounded border">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.bold', { defaultValue: 'Bold' })} onClick={() => exec('bold')}><Bold className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.italic', { defaultValue: 'Italic' })} onClick={() => exec('italic')}><Italic className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.underline', { defaultValue: 'Underline' })} onClick={() => exec('underline')}><Underline className="size-4" /></button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={btn} disabled={disabled} aria-label={t('editor.color', { defaultValue: 'Text colour' })}><Palette className="size-4" /></button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5"><div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => exec('foreColor', c)}
                className="size-6 rounded-full border" style={{ backgroundColor: c }} />
            ))}
          </div></PopoverContent>
        </Popover>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.bullet_list', { defaultValue: 'Bullet list' })} onClick={() => exec('insertUnorderedList')}><List className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.numbered_list', { defaultValue: 'Numbered list' })} onClick={() => exec('insertOrderedList')}><ListOrdered className="size-4" /></button>
        <button type="button" className={btn} disabled={disabled} aria-label={t('editor.link', { defaultValue: 'Link' })} onClick={onLink}><Link2 className="size-4" /></button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable={!disabled}
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        className={cn('min-h-[10rem] w-full px-3 py-2 text-sm focus:outline-none', disabled && 'opacity-60')}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test** → PASS. `npm run build` → clean.

- [ ] **Step 5: Commit.**
```bash
git add src/features/email/RichTextEditor.tsx src/features/email/RichTextEditor.test.tsx src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(email): RichTextEditor — email-basic formatting toolbar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

### Task 3: Wire rich text into the composer + send path

**Files:** Modify `src/features/email/SendEmailDialog.tsx`, `src/features/email/useSendEmail.ts`.

**Interfaces:**
- Consumes: `RichTextEditor` (Task 2), `sanitizeEmailHtml` (Task 1), existing `htmlToText` from `src/features/email/htmlToText.ts`.
- Produces: after this task, `SendEmailVars.body` carries **HTML** (was plain text); `useSendEmail` sanitises it to `html` and derives `text = htmlToText(...)`. Phase 2 adds `attachments` to these same types.

- [ ] **Step 1: `useSendEmail.ts`** — send sanitised HTML + derived text. Replace the `html`/`data` lines:

```ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';
import { htmlToText } from './htmlToText';

export type SendEmailVars = {
  identity: 'sales' | 'accounting' | 'internal' | 'personal';
  to: string;
  subject: string;
  body: string; // HTML from the rich-text editor
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  dedupeKey?: string | undefined;
};

export function useSendEmail() {
  return useMutation({
    mutationFn: async (vars: SendEmailVars) => {
      const html = sanitizeEmailHtml(vars.body);
      const text = htmlToText(vars.body);
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: vars.identity,
          to: vars.to,
          templateKey: 'custom',
          data: { subject: vars.subject, html, text },
          dedupeKey: vars.dedupeKey ?? null,
          ...(vars.cc && vars.cc.length > 0 ? { cc: vars.cc } : {}),
          ...(vars.bcc && vars.bcc.length > 0 ? { bcc: vars.bcc } : {}),
        },
      });
      if (error) throw new Error(error.message);
      if ((data as { status?: string })?.status === 'failed') {
        throw new Error((data as { error?: string }).error ?? 'send failed');
      }
      return data;
    },
  });
}
```

- [ ] **Step 2: `SendEmailDialog.tsx`** — replace the body `<textarea>` (lines 79-82) with the editor; state stays `text` (now HTML). Import `RichTextEditor`. Replace the block:

```tsx
<div className="mt-3 block text-sm">
  <span>{t('dialog.body')}</span>
  <div className="mt-1">
    <RichTextEditor value={text} onChange={setText} disabled={send.isPending} ariaLabel={t('dialog.body')} />
  </div>
</div>
```

The submit still calls `send.mutateAsync({ ..., body: text, ... })` — `text` is now HTML; no other change.

- [ ] **Step 3: Build + tests.** `npm run build` → clean. Run any existing `SendEmailDialog`/`useSendEmail` tests file-scoped; update mocks if a test asserted the old `\n→<br/>` behaviour (now it sanitises HTML + `htmlToText`). If a `useSendEmail.test.ts` exists, add an assertion that the invoked payload's `data.html` equals `sanitizeEmailHtml(body)` and `data.text` equals `htmlToText(body)`.

- [ ] **Step 4: Commit.** (Phase 1 shippable — recipient now gets formatted email.)
```bash
git add src/features/email/SendEmailDialog.tsx src/features/email/useSendEmail.ts
git commit -m "feat(email): compose with rich text — send sanitized HTML body

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

## PHASE 2 — Attachments

### Task 4: Backend — multipart MIME + attachment fetch in the personal path

**Files:** Modify `supabase/functions/send-email/attachments.ts`, `supabase/functions/_shared/google.ts`, `supabase/functions/send-email/index.ts`. Test: `supabase/functions/_shared/google.buildMime.test.ts` (Deno test) if the repo runs Deno tests; else document a manual decode check.

**Interfaces:**
- Consumes: existing `fetchAttachments`/`toBase64`/`validateAttachmentRefs` (extended here).
- Produces: `buildMime` accepts optional `attachments: { filename: string; mimeType: string; base64: string }[]` and emits `multipart/mixed` when non-empty (single-part `text/html` unchanged when empty). `validateAttachmentRefs` allows the `attachments` bucket, cap 10, optional `mimeType`, and enforces a total-size guard by fetched byte length. `sendPersonal` accepts `attachments` refs from the request and passes fetched parts to `buildMime`.

- [ ] **Step 1: `attachments.ts`** — allow the `attachments` bucket, raise the cap, add `mimeType`, and expose the raw byte size for the total guard:

```ts
export type AttachmentRef = { bucket: string; path: string; filename: string; mimeType?: string };
export type MimeAttachment = { filename: string; mimeType: string; base64: string; bytes: number };

const ALLOWED_BUCKETS = new Set(['contract-pdfs', 'offer-pdfs', 'attachments']);
const MAX_ATTACHMENTS = 10;
export const MAX_TOTAL_BYTES = 18 * 1024 * 1024; // ~18MB raw → base64 stays under Gmail's 25MB
```
Update `validateAttachmentRefs` cap message to `max 10` and carry `mimeType` through (typeof string || undefined). Add a `fetchMimeAttachments(storage, refs): Promise<MimeAttachment[]>` mirroring `fetchAttachments` but returning `{ filename, mimeType: ref.mimeType ?? 'application/octet-stream', base64, bytes }`, and throw `attachments_too_large` if the summed `bytes` exceeds `MAX_TOTAL_BYTES`. Keep the existing `fetchAttachments` (Resend path) untouched.

- [ ] **Step 2: `google.ts` `buildMime`** — multipart when attachments present:

```ts
export function buildMime(m: {
  from: string; to: string; subject: string; html: string;
  cc?: string[]; bcc?: string[];
  attachments?: { filename: string; mimeType: string; base64: string }[];
}): string {
  const subj = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(m.subject)))}?=`;
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    ...(m.cc && m.cc.length > 0 ? [`Cc: ${m.cc.join(', ')}`] : []),
    ...(m.bcc && m.bcc.length > 0 ? [`Bcc: ${m.bcc.join(', ')}`] : []),
    `Subject: ${subj}`,
    'MIME-Version: 1.0',
  ];
  const htmlB64 = btoa(unescape(encodeURIComponent(m.html)));

  if (!m.attachments || m.attachments.length === 0) {
    // Unchanged single-part output (backward compatible).
    const lines = [...headers, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', htmlB64];
    return b64url(enc.encode(lines.join('\r\n')));
  }

  const boundary = `itdev_${crypto.randomUUID().replace(/-/g, '')}`;
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
  ];
  for (const a of m.attachments) {
    const name = a.filename.replace(/["\\\r\n]/g, '_');
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      a.base64.replace(/(.{76})/g, '$1\r\n'), // RFC 2045 76-char line wrap
    );
  }
  parts.push(`--${boundary}--`);
  return b64url(enc.encode(parts.join('\r\n')));
}
```

- [ ] **Step 3: `index.ts` `sendPersonal`** — accept attachment refs, fetch, pass to `buildMime`. Add a param `attachmentRefs: AttachmentRef[] = []`; before the `buildMime` call (line 301) fetch:

```ts
let mimeAtts: MimeAttachment[] = [];
if (attachmentRefs.length > 0) {
  try {
    mimeAtts = await fetchMimeAttachments(admin.storage, attachmentRefs);
  } catch (e) {
    await admin.from('email_log').insert({ identity: 'personal', to_email: to, template_key: 'custom', status: 'failed', dedupe_key: dedupeKey, error: String((e as Error).message) });
    return { status: 'failed', error: (e as Error).message };
  }
}
const raw = buildMime({ from: acct.google_email, to, subject, html, cc, bcc: mergedBcc, attachments: mimeAtts.map((a) => ({ filename: a.filename, mimeType: a.mimeType, base64: a.base64 })) });
```
In the `Deno.serve` personal branch (~line 342), validate + pass: `const attachmentRefs = body.attachments ? validateAttachmentRefs(body.attachments) : [];` (wrap in try/catch → `json({ error: (e as Error).message }, 400)`), then `sendPersonal(u.user.id, body.to, body.data ?? {}, body.dedupeKey ?? null, cc, bcc, attachmentRefs)`. Add `attachments?: unknown` to the `SendInput` type. Import `fetchMimeAttachments`, `MimeAttachment`, `validateAttachmentRefs` from `./attachments.ts`.

- [ ] **Step 4: Test `buildMime`.** If `supabase/functions` has Deno tests (look for `*.test.ts` there), add `google.buildMime.test.ts`: (a) no attachments → output decodes to a single-part `text/html` message identical in structure to before; (b) with one attachment → decoded raw contains `multipart/mixed; boundary=`, a `text/html` part, and a `Content-Disposition: attachment; filename="a.png"` part whose base64 decodes to the input bytes. Run with `deno test`. If the repo has NO Deno test runner, instead add a Node/vitest test that imports the pure `buildMime` (it uses only `btoa`/`crypto`/`TextEncoder`, all available in vitest) and asserts the same on the base64url-decoded string; document that choice in the report.

- [ ] **Step 5: Commit** (not deployed yet — deploy is Task 6).
```bash
git add supabase/functions/send-email/attachments.ts supabase/functions/_shared/google.ts supabase/functions/send-email/index.ts supabase/functions/_shared/google.buildMime.test.ts
git commit -m "feat(email): multipart MIME + attachment fetch in personal Gmail send

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

### Task 5: Frontend — file staging in the composer

**Files:** Create `src/features/email/hooks/useEmailAttachmentStaging.ts` (+ `.test.ts`). Modify `src/features/email/SendEmailDialog.tsx`, `src/features/email/useSendEmail.ts`, `src/i18n/locales/{en,el}/email.json`.

**Interfaces:**
- Consumes: `CommentAttachButton` + `useFileDropPaste` from `src/features/comments/`; `sanitizeStorageFileName` from `src/lib/sanitizeStorageKey`; the `attachments` bucket; `supabase`.
- Produces: `useEmailAttachmentStaging()` → `{ refs: EmailAttachmentRef[], pending: File[], busy: boolean, error: string | null, addFiles(files: File[]): Promise<void>, remove(index: number): void, clear(): void, cleanup(): Promise<void> }` where `EmailAttachmentRef = { bucket: 'attachments'; path: string; filename: string; mimeType: string; bytes: number }`. `useSendEmail` gains optional `attachments?: EmailAttachmentRef[]` forwarded as `attachments` in the invoke body.

- [ ] **Step 1: `useSendEmail.ts`** — add `attachments?: { bucket: string; path: string; filename: string; mimeType?: string }[]` to `SendEmailVars` and include `...(vars.attachments && vars.attachments.length ? { attachments: vars.attachments } : {})` in the invoke body.

- [ ] **Step 2: Failing test** `useEmailAttachmentStaging.test.ts`: mock `@/lib/supabase` storage; assert `addFiles([file])` uploads to a path starting `email/` + sanitised name and records a ref with `mimeType`/`bytes`; a file over 25 MB sets `error` and uploads nothing; total over 18 MB after a second file sets `error` and doesn't add it; `remove(0)` calls storage `.remove` and drops the ref; `cleanup()` removes all staged paths. Run → FAIL.

- [ ] **Step 3: Implement `useEmailAttachmentStaging.ts`:**

```ts
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { sanitizeStorageFileName } from '@/lib/sanitizeStorageKey';

const MAX_FILE = 25 * 1024 * 1024;
const MAX_TOTAL = 18 * 1024 * 1024;

export type EmailAttachmentRef = { bucket: 'attachments'; path: string; filename: string; mimeType: string; bytes: number };

export function useEmailAttachmentStaging() {
  const stagingId = useRef(crypto.randomUUID());
  const [refs, setRefs] = useState<EmailAttachmentRef[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    for (const file of files) {
      if (file.size > MAX_FILE) { setError('file_too_large'); continue; }
      const total = refs.reduce((n, r) => n + r.bytes, 0) + file.size;
      if (total > MAX_TOTAL) { setError('attachments_too_large'); continue; }
      setBusy(true);
      setPending((p) => [...p, file]);
      const path = `email/${stagingId.current}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;
      const { error: e } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
      setPending((p) => p.filter((f) => f !== file));
      setBusy(false);
      if (e) { setError(e.message); continue; }
      setRefs((r) => [...r, { bucket: 'attachments', path, filename: file.name, mimeType: file.type || 'application/octet-stream', bytes: file.size }]);
    }
  }, [refs]);

  const remove = useCallback((index: number) => {
    setRefs((r) => {
      const ref = r[index];
      if (ref) void supabase.storage.from('attachments').remove([ref.path]);
      return r.filter((_, i) => i !== index);
    });
  }, []);

  const clear = useCallback(() => setRefs([]), []);
  const cleanup = useCallback(async () => {
    const paths = refs.map((r) => r.path);
    if (paths.length) await supabase.storage.from('attachments').remove(paths);
    setRefs([]);
  }, [refs]);

  return { refs, pending, busy, error, addFiles, remove, clear, cleanup };
}
```

- [ ] **Step 4: Wire into `SendEmailDialog.tsx`.** Add `const att = useEmailAttachmentStaging();` and `const dnd = useFileDropPaste((f) => void att.addFiles(f), send.isPending);`. Render `<CommentAttachButton pending={att.refs.map((r) => new File([], r.filename))} onPick={(f) => void att.addFiles(f)} onRemove={att.remove} disabled={send.isPending} />` below the editor (or a simple chip list from `att.refs` with a remove ✕ — reuse `CommentAttachButton`'s chip styling; the button's pending prop expects `File[]`, so pass a lightweight `File` per ref for the chip label). Spread `{...dnd.dropZoneProps}` on the dialog body container with an `att`/dnd `isDragging` ring, and `onPaste={dnd.onPaste}` on the editor container. Surface `att.error` via the existing error `<p>` (translate `file_too_large`/`attachments_too_large`). In `submit()`, pass `attachments: att.refs` to `send.mutateAsync`; on success call `void att.cleanup()`; on the component's close, also `void att.cleanup()` if not sent. Add i18n error keys `errors.file_too_large` / `errors.attachments_too_large` in both locales.

- [ ] **Step 5: Build + tests.** `npm run build` → clean. Run the new hook test + any SendEmailDialog test file-scoped.

- [ ] **Step 6: Commit.**
```bash
git add src/features/email/hooks/useEmailAttachmentStaging.ts src/features/email/hooks/useEmailAttachmentStaging.test.ts src/features/email/SendEmailDialog.tsx src/features/email/useSendEmail.ts src/i18n/locales/en/email.json src/i18n/locales/el/email.json
git commit -m "feat(email): attach files in the composer (staged to storage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

### Task 6: Deploy edge function + verification + spec flip

- [ ] **Step 1: Deploy** the edge function: `SUPABASE_ACCESS_TOKEN=<sbp token> supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy` (owner supplies the token). Expected: deploy success.
- [ ] **Step 2: Full build + all touched test files** (file-scoped) — green.
- [ ] **Step 3: Live smoke** (browser, prod after deploy; sender = the logged-in staff account with a connected Gmail): open a deal → New email to a test inbox (e.g. info@itdev.gr); type formatted text (bold + a colour + a bullet); attach a small file (drag-drop or paperclip); Send. Verify: the received email shows the formatting AND the attachment; `email_log` has a `sent` row; the staged `email/…` object was cleaned up (storage). If Gmail rejects an oversized message, confirm the 18 MB guard fired first client-side.
- [ ] **Step 4:** Spec `Status:` → `implemented 2026-07-23`; commit + push.
