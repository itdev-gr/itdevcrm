# Resend Automated Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send automated transactional email via Resend — one-click client emails for the sales pipeline (Offer sent, Won welcome), automatic internal notifications on new job/task, and cron-driven payment reminders — all in Greek.

**Architecture:** A single Deno Supabase Edge Function `send-email` is the only code that calls Resend (reads `RESEND_API_KEY` secret), renders server-side Greek templates for automated emails, accepts a `custom` template for editable one-click emails, and logs every send to `email_log` (dedupe-protected). Automated emails are enqueued to `email_outbox` (by DB insert-triggers and a daily reminder job) and delivered by a `pg_cron` + `pg_net` "drain" pulse that invokes the function. One-click sales emails invoke the function synchronously from the browser.

**Tech Stack:** Supabase (Postgres, Edge Functions/Deno, `pg_cron`, `pg_net`, Vault), Resend REST API, React 19 + react-i18next + TanStack Query, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-02-resend-automated-email-design.md`

---

## Conventions locked for the whole plan (keep consistent across tasks)

- **Identities** (Edge Function `IDENTITIES` map): `sales` → `ITDev <sales@itdev.gr>` replyTo `sales@itdev.gr`; `accounting` → `ITDev Λογιστήριο <accounting@itdev.gr>` replyTo `accounting@itdev.gr`; `internal` → `ITDev <noreply@itdev.gr>` replyTo `noreply@itdev.gr`.
- **Template keys**: `custom`, `payment_due_soon`, `payment_due_today`, `payment_overdue`, `internal_new_job`, `internal_new_task`.
- **Dedupe keys**: `offer:<lead_id>` (informational only — UI allows resend), `pay_soon:<payment_id>`, `pay_today:<payment_id>`, `pay_overdue:<payment_id>`, `task:<task_id>`, `job:<job_id>:<user_id>`.
- **Function name**: `send-email`. **Request body**: `{ identity, to, templateKey, data, dedupeKey?, dryRun? }` OR `{ drain: true }`.
- **Tables**: `public.email_outbox`, `public.email_log` (created in Task 1).

## File Structure

- `supabase/migrations/20260602000001_email_tables.sql` — `email_outbox` + `email_log` + RLS + indexes.
- `supabase/functions/send-email/index.ts` — the Edge Function (entry, auth, drain loop).
- `supabase/functions/send-email/identities.ts` — identity → From/Reply-To map.
- `supabase/functions/send-email/templates.ts` — server-side Greek templates + `custom` + `renderTemplate()`.
- `supabase/functions/send-email/templates.test.ts` — Deno-free unit test of templates (run via vitest, see Task 4).
- `supabase/migrations/20260602000002_email_drain_cron.sql` — enable `pg_net`, drain `pg_cron` job (reads Vault secrets).
- `supabase/migrations/20260602000003_payment_reminders.sql` — `enqueue_payment_reminders()` + daily cron.
- `supabase/tests/enqueue_payment_reminders.sql` — pgTAP-style SQL test.
- `supabase/migrations/20260602000004_email_notify_triggers.sql` — AFTER INSERT triggers on `assigned_tasks` + `jobs`.
- `src/features/email/useSendEmail.ts` — hook wrapping `supabase.functions.invoke('send-email')`.
- `src/features/email/SendEmailDialog.tsx` — editable draft dialog (subject + body) → sends `custom`.
- `src/features/email/SendEmailDialog.test.tsx` — RTL test.
- `src/features/email/buildDraft.ts` — builds the Greek offer/won drafts from i18n.
- `src/i18n/locales/{en,el}/email.json` — dialog UI strings + offer/won draft text; registered in `src/lib/i18n.ts`.
- Wire-in: `src/features/leads/LeadDetailPage.tsx` (offer button), `src/features/deals/DealDetailPage.tsx` (welcome button).

---

## Phase 1 — Foundation: tables + Edge Function (synchronous send + dry-run)

### Task 1: Email tables migration

**Files:**
- Create: `supabase/migrations/20260602000001_email_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- email_outbox: queue for asynchronous sends (triggers + reminder cron).
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  identity text not null check (identity in ('sales','accounting','internal')),
  to_email text not null,
  template_key text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_pending on public.email_outbox (created_at) where status = 'pending';

-- email_log: audit + idempotency for every attempted send.
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  identity text not null,
  to_email text not null,
  template_key text not null,
  resend_id text,
  status text not null check (status in ('sent','failed')),
  dedupe_key text,
  error text,
  created_at timestamptz not null default now()
);
-- A given logical email (dedupe_key) can be 'sent' at most once.
create unique index email_log_dedupe_sent
  on public.email_log (dedupe_key) where dedupe_key is not null and status = 'sent';

alter table public.email_outbox enable row level security;
alter table public.email_log enable row level security;

-- Admins may read both (for an ops view); writes go through security-definer
-- functions / the service-role Edge Function, never directly from clients.
create policy email_outbox_admin_read on public.email_outbox for select
  using (public.current_user_is_admin());
create policy email_log_admin_read on public.email_log for select
  using (public.current_user_is_admin());

-- ROLLBACK:
-- drop table if exists public.email_log;
-- drop table if exists public.email_outbox;
```

- [ ] **Step 2: Verify the helper exists**

Run: `grep -rn "function public.current_user_is_admin" supabase/migrations | head -1`
Expected: a match (the admin predicate already used by other RLS policies). If it does not exist, replace `public.current_user_is_admin()` with the project's existing admin check — find it via `grep -rn "is_admin" supabase/migrations | grep -i "policy\|function" | head`.

- [ ] **Step 3: Push the migration to the linked project**

Run: `supabase db push`
Expected: applies `20260602000001_email_tables.sql` with no error; `email_outbox` and `email_log` exist.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602000001_email_tables.sql
git commit -m "feat(email): email_outbox + email_log tables with dedupe + RLS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Identity map + template module (server-side, Greek)

**Files:**
- Create: `supabase/functions/send-email/identities.ts`
- Create: `supabase/functions/send-email/templates.ts`

- [ ] **Step 1: Write `identities.ts`**

```ts
export type Identity = 'sales' | 'accounting' | 'internal';

export const IDENTITIES: Record<Identity, { from: string; replyTo: string }> = {
  sales: { from: 'ITDev <sales@itdev.gr>', replyTo: 'sales@itdev.gr' },
  accounting: { from: 'ITDev Λογιστήριο <accounting@itdev.gr>', replyTo: 'accounting@itdev.gr' },
  internal: { from: 'ITDev <noreply@itdev.gr>', replyTo: 'noreply@itdev.gr' },
};
```

- [ ] **Step 2: Write `templates.ts`** (pure functions, no Deno APIs, so they unit-test under vitest)

```ts
// Greek transactional templates + an editable `custom` passthrough.
// Each template returns { subject, html, text }. Keep `data` shapes documented here.

export type Rendered = { subject: string; html: string; text: string };

const APP_BASE = 'https://app.itdev.gr'; // deal/offer links; adjust if the prod URL differs.

const SERVICE_LABELS_EL: Record<string, string> = {
  web_seo: 'Web SEO',
  local_seo: 'Τοπικό SEO',
  web_dev: 'Ανάπτυξη Ιστού',
  social_media: 'Social Media',
  ai_seo: 'AI SEO',
  hosting: 'Φιλοξενία',
  ads: 'Διαφημίσεις',
};

function shell(bodyHtml: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
<p style="font-size:12px;color:#64748b">ITDev · itdev.gr</p>
</div>`;
}

function eur(n: number): string {
  return `€${Number(n).toFixed(2)}`;
}

export const TEMPLATES: Record<string, (data: Record<string, unknown>) => Rendered> = {
  // Editable one-click emails pass their own subject/html/text.
  custom: (d) => ({
    subject: String(d.subject ?? ''),
    html: shell(String(d.html ?? '')),
    text: String(d.text ?? String(d.html ?? '').replace(/<[^>]+>/g, '')),
  }),

  payment_due_soon: (d) => {
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Υπενθύμιση πληρωμής — λήγει ${d.due_date}`;
    const html = shell(
      `<p>Αγαπητέ/ή ${d.client_name},</p>
<p>Σας υπενθυμίζουμε ότι η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> λήγει στις <b>${d.due_date}</b>.</p>
<p>Ευχαριστούμε για τη συνεργασία.</p>`,
    );
    return { subject, html, text: `Υπενθύμιση: πληρωμή ${eur(Number(d.amount_gross))} (${svc}) λήγει ${d.due_date}.` };
  },

  payment_due_today: (d) => {
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Η πληρωμή σας λήγει σήμερα`;
    const html = shell(
      `<p>Αγαπητέ/ή ${d.client_name},</p>
<p>Η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> λήγει <b>σήμερα</b> (${d.due_date}).</p>`,
    );
    return { subject, html, text: `Η πληρωμή ${eur(Number(d.amount_gross))} (${svc}) λήγει σήμερα.` };
  },

  payment_overdue: (d) => {
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Εκπρόθεσμη πληρωμή`;
    const html = shell(
      `<p>Αγαπητέ/ή ${d.client_name},</p>
<p>Η πληρωμή για την υπηρεσία <b>${svc}</b> ύψους <b>${eur(Number(d.amount_gross))}</b> με λήξη στις <b>${d.due_date}</b> παραμένει εκκρεμής.</p>
<p>Παρακαλούμε επικοινωνήστε μαζί μας στο accounting@itdev.gr.</p>`,
    );
    return { subject, html, text: `Εκπρόθεσμη πληρωμή ${eur(Number(d.amount_gross))} (${svc}), λήξη ${d.due_date}.` };
  },

  internal_new_task: (d) => {
    const link = `${APP_BASE}/deals/${d.deal_id ?? ''}`;
    const subject = `Νέα εργασία: ${d.title}`;
    const html = shell(
      `<p>Σου ανατέθηκε νέα εργασία: <b>${d.title}</b>.</p>
<p><a href="${link}">Άνοιγμα στο CRM</a></p>`,
    );
    return { subject, html, text: `Νέα εργασία: ${d.title} — ${link}` };
  },

  internal_new_job: (d) => {
    const link = `${APP_BASE}/deals/${d.deal_id ?? ''}`;
    const svc = SERVICE_LABELS_EL[String(d.service_type)] ?? String(d.service_type ?? '');
    const subject = `Νέο job: ${svc}`;
    const html = shell(
      `<p>Δημιουργήθηκε νέο job <b>${svc}</b> για τον πελάτη <b>${d.client_name}</b>.</p>
<p><a href="${link}">Άνοιγμα στο CRM</a></p>`,
    );
    return { subject, html, text: `Νέο job ${svc} για ${d.client_name} — ${link}` };
  },
};

export function renderTemplate(templateKey: string, data: Record<string, unknown>): Rendered {
  const fn = TEMPLATES[templateKey];
  if (!fn) throw new Error(`Unknown template: ${templateKey}`);
  return fn(data ?? {});
}
```

- [ ] **Step 2b: Commit**

```bash
git add supabase/functions/send-email/identities.ts supabase/functions/send-email/templates.ts
git commit -m "feat(email): server-side Greek templates + identity map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `send-email` Edge Function (auth, single send, dry-run, drain loop)

**Files:**
- Create: `supabase/functions/send-email/index.ts`

- [ ] **Step 1: Write the function**

```ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { IDENTITIES, type Identity } from './identities.ts';
import { renderTemplate } from './templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const DRY_RUN = (Deno.env.get('EMAIL_DRY_RUN') ?? 'false').toLowerCase() === 'true';

const admin = createClient(URL, SERVICE_KEY);

type SendInput = {
  identity: Identity;
  to: string;
  templateKey: string;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
  dryRun?: boolean;
};

async function sendOne(input: SendInput): Promise<{ status: 'sent' | 'failed' | 'skipped'; resendId?: string; error?: string }> {
  const { identity, to, templateKey, data = {}, dedupeKey = null } = input;
  // Idempotency: never send the same dedupe_key twice.
  if (dedupeKey) {
    const { data: prior } = await admin
      .from('email_log').select('id').eq('dedupe_key', dedupeKey).eq('status', 'sent').limit(1);
    if (prior && prior.length > 0) return { status: 'skipped' };
  }
  const id = IDENTITIES[identity];
  if (!id) return { status: 'failed', error: `unknown identity ${identity}` };

  let rendered;
  try {
    rendered = renderTemplate(templateKey, data);
  } catch (e) {
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error: String(e) });
    return { status: 'failed', error: String(e) };
  }

  const dry = input.dryRun || DRY_RUN;
  if (dry) {
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'sent', resend_id: 'dry-run', dedupe_key: dedupeKey });
    return { status: 'sent', resendId: 'dry-run' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: id.from, reply_to: id.replyTo, to, subject: rendered.subject, html: rendered.html, text: rendered.text }),
  });
  if (!res.ok) {
    const error = await res.text();
    await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'failed', dedupe_key: dedupeKey, error });
    return { status: 'failed', error };
  }
  const body = await res.json().catch(() => ({}));
  await admin.from('email_log').insert({ identity, to_email: to, template_key: templateKey, status: 'sent', resend_id: body.id ?? null, dedupe_key: dedupeKey });
  return { status: 'sent', resendId: body.id };
}

async function drain(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: rows } = await admin
    .from('email_outbox').select('*').eq('status', 'pending').lt('attempts', 5)
    .order('created_at', { ascending: true }).limit(50);
  let sent = 0, failed = 0;
  for (const r of rows ?? []) {
    const result = await sendOne({ identity: r.identity, to: r.to_email, templateKey: r.template_key, data: r.data, dedupeKey: r.dedupe_key });
    if (result.status === 'failed') {
      failed++;
      await admin.from('email_outbox').update({ attempts: r.attempts + 1, last_error: result.error ?? null }).eq('id', r.id);
    } else {
      sent++;
      await admin.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: r.attempts + 1 }).eq('id', r.id);
    }
  }
  return { processed: (rows ?? []).length, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'Server misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole = token === SERVICE_KEY;

  const body = (await req.json().catch(() => null)) as (SendInput & { drain?: boolean }) | null;
  if (!body) return json({ error: 'Bad request' }, 400);

  // Drain mode: service role only (the cron pulse).
  if (body.drain) {
    if (!isServiceRole) return json({ error: 'Forbidden' }, 403);
    return json(await drain());
  }

  // Single-send mode: allow service role OR an authenticated admin/staff user.
  if (!isServiceRole) {
    const caller = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    if (!userData?.user) return json({ error: 'Unauthorized' }, 401);
    // Any authenticated staff member may send; tighten to admin if desired.
  }
  if (!body.identity || !body.to || !body.templateKey) return json({ error: 'Missing identity/to/templateKey' }, 400);
  const result = await sendOne(body);
  return json(result, result.status === 'failed' ? 502 : 200);
});
```

- [ ] **Step 2: Deploy and smoke-test in dry-run**

Run (requires the project linked + `RESEND_API_KEY` already set as a secret — see Go-Live checklist):
```bash
supabase secrets set EMAIL_DRY_RUN=true --project-ref xujlrclyzxrvxszepquy
supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy
```
Expected: deploy succeeds. (Full end-to-end send is verified after DNS in the Go-Live checklist.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "feat(email): send-email Edge Function (single send + dry-run + drain)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Template unit tests (vitest)

**Files:**
- Create: `supabase/functions/send-email/templates.test.ts`
- Modify: `vitest.config.ts` (only if its `include` glob excludes `supabase/`)

- [ ] **Step 1: Confirm vitest will pick up the file**

Run: `cat vitest.config.ts`
Expected: note the `test.include` glob. If it is limited to `src/`, add `'supabase/functions/**/*.test.ts'` to `include`. If there is no `include` (defaults to all `*.test.ts`), no change needed.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from './templates';

describe('email templates', () => {
  it('renders a Greek payment_due_soon email with amount and date', () => {
    const r = renderTemplate('payment_due_soon', {
      client_name: 'Acme', service_type: 'web_seo', amount_gross: 124, due_date: '2026-06-05',
    });
    expect(r.subject).toContain('2026-06-05');
    expect(r.html).toContain('€124.00');
    expect(r.html).toContain('Web SEO');
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('passes through a custom email subject/body', () => {
    const r = renderTemplate('custom', { subject: 'Γεια', html: '<p>Σώμα</p>' });
    expect(r.subject).toBe('Γεια');
    expect(r.html).toContain('Σώμα');
  });

  it('throws on an unknown template', () => {
    expect(() => renderTemplate('nope', {})).toThrow(/Unknown template/);
  });
});
```

Note: `templates.ts` imports nothing from Deno, so this resolves under vitest. The `.ts` extension on the import in `index.ts` is Deno-only and does not affect this test (we import `./templates`).

- [ ] **Step 3: Run it (red→green; code already exists from Task 2)**

Run: `npx vitest run supabase/functions/send-email/templates.test.ts`
Expected: PASS (3 tests). If the file is not discovered, apply the `include` change from Step 1 and re-run.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-email/templates.test.ts vitest.config.ts
git commit -m "test(email): unit-test Greek template rendering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Drain pipeline (pg_net + Vault + cron)

### Task 5: Enable pg_net and schedule the drain pulse

**Files:**
- Create: `supabase/migrations/20260602000002_email_drain_cron.sql`

> The cron pulse needs the project URL + service-role key to call the function. These are secrets, so they are **not** in the migration — they are stored in Supabase Vault by a manual step (Go-Live checklist) under names `project_url` and `service_role_key`. The migration only schedules the job that reads them.

- [ ] **Step 1: Write the migration**

```sql
create extension if not exists pg_net with schema extensions;

-- Drain the email outbox every 2 minutes by pulsing the send-email Edge Function.
-- Reads project_url + service_role_key from Vault (set manually, see go-live checklist).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'drain_email_outbox') then
    perform cron.unschedule('drain_email_outbox');
  end if;
  perform cron.schedule(
    'drain_email_outbox',
    '*/2 * * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := jsonb_build_object('drain', true)
      );
    $cron$
  );
end $$;

-- ROLLBACK:
-- do $$ begin
--   if exists (select 1 from cron.job where jobname = 'drain_email_outbox') then
--     perform cron.unschedule('drain_email_outbox');
--   end if;
-- end $$;
```

- [ ] **Step 2: Push (after the Vault secrets exist — see Go-Live)**

Run: `supabase db push`
Expected: applies cleanly. If `vault` secrets are not yet set, the job is scheduled but each run no-ops/errors harmlessly until they are added; that's acceptable pre-go-live.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602000002_email_drain_cron.sql
git commit -m "feat(email): pg_net + 2-min drain cron pulsing send-email

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Payment reminders

### Task 6: `enqueue_payment_reminders()` + daily cron

**Files:**
- Create: `supabase/migrations/20260602000003_payment_reminders.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Enqueue accounting reminder emails for pending deal_payments at the
-- 3-days-before / due-today / 1-day-overdue marks. Idempotent: skips any
-- (dedupe_key) already sent (email_log) or already queued (email_outbox).
create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  tkey text;
  dkey text;
  prefix text;
  created int := 0;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id and d.archived = false
      join public.clients c on c.id = d.client_id
     where dp.status = 'pending'
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 3, current_date, current_date - 1)
  loop
    if r.due_date = current_date + 3 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date then
      tkey := 'payment_due_today'; prefix := 'pay_today';
    else
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
    end if;
    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('client_name', r.client_name, 'service_type', r.service_type,
                               'amount_gross', r.amount_gross, 'due_date', to_char(r.due_date, 'DD/MM/YYYY'),
                               'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- Daily at 06:00 UTC (~09:00 Europe/Athens in summer).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily_payment_reminders') then
    perform cron.unschedule('daily_payment_reminders');
  end if;
  perform cron.schedule('daily_payment_reminders', '0 6 * * *',
    $cron$ select public.enqueue_payment_reminders(); $cron$);
end $$;

-- ROLLBACK:
-- do $$ begin
--   if exists (select 1 from cron.job where jobname='daily_payment_reminders') then
--     perform cron.unschedule('daily_payment_reminders'); end if;
-- end $$;
-- drop function if exists public.enqueue_payment_reminders();
```

Note: `to_char(due_date,'DD/MM/YYYY')` matches the Greek-friendly format; the template renders the string verbatim.

- [ ] **Step 2: Push**

Run: `supabase db push`
Expected: applies cleanly; `select public.enqueue_payment_reminders();` returns an integer.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602000003_payment_reminders.sql
git commit -m "feat(email): enqueue_payment_reminders + daily cron

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: SQL test for reminder selection logic

**Files:**
- Create: `supabase/tests/enqueue_payment_reminders.sql`

- [ ] **Step 1: Write the test (mirrors the style of `supabase/tests/ensure_recurring_expenses.sql`)**

```sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(3);

-- Arrange: a non-archived deal + client with email, and 3 pending payments
-- due in +3 / today / -1 days, plus one paid (must be ignored).
-- (Assumes test helpers/fixtures; if the repo seeds via raw inserts, insert a
--  client, deal, and deal_payments rows here with explicit ids.)
do $$
declare cid uuid; did uuid;
begin
  insert into public.clients (name, email, country) values ('TestCo', 't@example.com', 'Greece') returning id into cid;
  insert into public.deals (client_id, archived) values (cid, false) returning id into did;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
  values (did,'web_seo',0,'recurring_monthly',100,24, current_date + 3,'pending'),
         (did,'web_seo',1,'recurring_monthly',100,24, current_date,'pending'),
         (did,'web_seo',2,'recurring_monthly',100,24, current_date - 1,'pending'),
         (did,'web_seo',3,'recurring_monthly',100,24, current_date,'paid');
end $$;

select is( public.enqueue_payment_reminders(), 3, 'enqueues exactly 3 reminders (skips paid)');
select is( (select count(*)::int from public.email_outbox where template_key='payment_due_soon'), 1, 'one due_soon');
-- Idempotent: a second run enqueues nothing new (dedupe).
select is( public.enqueue_payment_reminders(), 0, 'second run is idempotent');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it**

Run: `supabase test db`
Expected: all 3 assertions pass. If the project's `deals`/`clients` columns differ from the inserts (e.g. required NOT NULL columns), adjust the fixture inserts to satisfy them — verify with `\d public.deals` / `\d public.clients` against the linked DB, or `grep -n "create table public.deals" -A40 supabase/migrations/20260502000008_deals_jobs.sql`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/enqueue_payment_reminders.sql
git commit -m "test(email): SQL test for enqueue_payment_reminders selection + idempotency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — Internal notifications (new task / new job)

### Task 8: AFTER INSERT triggers enqueueing internal emails

**Files:**
- Create: `supabase/migrations/20260602000004_email_notify_triggers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- New task → email the assignee (skip self-assignment), mirroring the existing
-- in-app assigned_tasks_notify_assignee logic.
create or replace function public.email_notify_new_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare assignee_email text;
begin
  if new.assignee_user_id = new.created_by_user_id then
    return new;
  end if;
  select email into assignee_email from public.profiles where user_id = new.assignee_user_id;
  if assignee_email is null or assignee_email = '' then return new; end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('internal', assignee_email, 'internal_new_task',
          jsonb_build_object('title', new.title, 'deal_id', new.deal_id),
          'task:' || new.id);
  return new;
end $$;

create trigger trg_email_notify_new_task
  after insert on public.assigned_tasks
  for each row execute function public.email_notify_new_task();

-- New job → email every active member of the assigned group.
create or replace function public.email_notify_new_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare m record; client_name text;
begin
  if new.assigned_group_id is null then return new; end if;
  select name into client_name from public.clients where id = new.client_id;
  for m in
    select p.email
      from public.user_groups ug
      join public.profiles p on p.user_id = ug.user_id
     where ug.group_id = new.assigned_group_id
       and p.email is not null and p.email <> ''
  loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('internal', m.email, 'internal_new_job',
            jsonb_build_object('service_type', new.service_type, 'client_name', client_name, 'deal_id', new.deal_id),
            'job:' || new.id || ':' || m.email);
  end loop;
  return new;
end $$;

create trigger trg_email_notify_new_job
  after insert on public.jobs
  for each row execute function public.email_notify_new_job();

-- ROLLBACK:
-- drop trigger if exists trg_email_notify_new_task on public.assigned_tasks;
-- drop trigger if exists trg_email_notify_new_job on public.jobs;
-- drop function if exists public.email_notify_new_task();
-- drop function if exists public.email_notify_new_job();
```

Note: the job dedupe key uses the recipient email (one row per member) so multiple members each get one. If `profiles.user_id` is the right column for membership join, this matches `user_groups(user_id, group_id)` confirmed in the schema.

- [ ] **Step 2: Push and verify dry-run end-to-end**

Run:
```bash
supabase db push
```
Then, with `EMAIL_DRY_RUN=true` still set, create a task assigned to another user in the app (or insert a row) and confirm an outbox row appears:
```bash
# after creating a task in the UI:
# psql/dashboard:  select template_key, to_email, status from public.email_outbox order by created_at desc limit 3;
```
Expected: an `internal_new_task` `pending` row; after the drain cron runs (or a manual `{drain:true}` invoke) it flips to `sent` with a `dry-run` log entry.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602000004_email_notify_triggers.sql
git commit -m "feat(email): internal notifications on new task (assignee) and new job (group)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5 — Sales one-click emails (Offer sent, Won welcome)

### Task 9: Email i18n namespace + draft builder

**Files:**
- Create: `src/i18n/locales/en/email.json`
- Create: `src/i18n/locales/el/email.json`
- Modify: `src/lib/i18n.ts`
- Create: `src/features/email/buildDraft.ts`

- [ ] **Step 1: Create `el/email.json`**

```json
{
  "dialog": {
    "title": "Αποστολή email",
    "to": "Προς",
    "subject": "Θέμα",
    "body": "Μήνυμα",
    "send": "Αποστολή",
    "cancel": "Άκυρο",
    "sent": "Το email στάλθηκε.",
    "failed": "Η αποστολή απέτυχε.",
    "to_required": "Απαιτείται email παραλήπτη."
  },
  "offer": {
    "subject": "Η προσφορά σας από την ITDev",
    "body": "Αγαπητέ/ή {{name}},\n\nΣας ευχαριστούμε για το ενδιαφέρον σας. Μπορείτε να δείτε την προσφορά σας εδώ: {{offerUrl}}\n\nΜε εκτίμηση,\nΟμάδα ITDev"
  },
  "won": {
    "subject": "Καλώς ήρθατε στην ITDev",
    "body": "Αγαπητέ/ή {{name}},\n\nΧαιρόμαστε που ξεκινάμε τη συνεργασία μας! Θα επικοινωνήσουμε σύντομα με τα επόμενα βήματα.\n\nΜε εκτίμηση,\nΟμάδα ITDev"
  }
}
```

- [ ] **Step 2: Create `en/email.json`** (same keys, English values)

```json
{
  "dialog": {
    "title": "Send email",
    "to": "To",
    "subject": "Subject",
    "body": "Message",
    "send": "Send",
    "cancel": "Cancel",
    "sent": "Email sent.",
    "failed": "Sending failed.",
    "to_required": "Recipient email is required."
  },
  "offer": {
    "subject": "Your offer from ITDev",
    "body": "Dear {{name}},\n\nThank you for your interest. You can view your offer here: {{offerUrl}}\n\nBest regards,\nThe ITDev team"
  },
  "won": {
    "subject": "Welcome to ITDev",
    "body": "Dear {{name}},\n\nWe're glad to start working together! We'll be in touch shortly with next steps.\n\nBest regards,\nThe ITDev team"
  }
}
```

- [ ] **Step 3: Register the namespace in `src/lib/i18n.ts`**

Add imports next to the other locale imports:
```ts
import enEmail from '@/i18n/locales/en/email.json';
import elEmail from '@/i18n/locales/el/email.json';
```
Add `'email'` to the `ns: [...]` array, and add `email: enEmail` to the `en` resources object and `email: elEmail` to the `el` resources object (mirror how `accounting_report` is wired at lines ~36/50).

- [ ] **Step 4: Write `buildDraft.ts`**

```ts
import i18n from '@/lib/i18n';

export type Draft = { subject: string; body: string };

export function buildOfferDraft(name: string, offerUrl: string): Draft {
  const t = i18n.getFixedT(null, 'email');
  return { subject: t('offer.subject'), body: t('offer.body', { name, offerUrl }) };
}

export function buildWonDraft(name: string): Draft {
  const t = i18n.getFixedT(null, 'email');
  return { subject: t('won.subject'), body: t('won.body', { name }) };
}
```

- [ ] **Step 5: Validate + typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/el/email.json','utf8'));JSON.parse(require('fs').readFileSync('src/i18n/locales/en/email.json','utf8'));console.log('OK')" && npm run typecheck`
Expected: `OK` then typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en/email.json src/i18n/locales/el/email.json src/lib/i18n.ts src/features/email/buildDraft.ts
git commit -m "feat(email): email i18n namespace + offer/won draft builders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: `useSendEmail` hook

**Files:**
- Create: `src/features/email/useSendEmail.ts`

- [ ] **Step 1: Write the hook (mirrors `src/features/users/hooks/useCreateUser.ts`)**

```ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type SendEmailVars = {
  identity: 'sales' | 'accounting' | 'internal';
  to: string;
  subject: string;
  body: string; // plain text; newlines become <br/> in html
  dedupeKey?: string;
};

export function useSendEmail() {
  return useMutation({
    mutationFn: async (vars: SendEmailVars) => {
      const html = vars.body.replace(/\n/g, '<br/>');
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          identity: vars.identity,
          to: vars.to,
          templateKey: 'custom',
          data: { subject: vars.subject, html, text: vars.body },
          dedupeKey: vars.dedupeKey ?? null,
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

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: exit 0.
```bash
git add src/features/email/useSendEmail.ts
git commit -m "feat(email): useSendEmail hook (invokes send-email custom)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: `SendEmailDialog` component + test

**Files:**
- Create: `src/features/email/SendEmailDialog.tsx`
- Create: `src/features/email/SendEmailDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('./useSendEmail', () => ({ useSendEmail: () => ({ mutateAsync, isPending: false }) }));

import { SendEmailDialog } from './SendEmailDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('SendEmailDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); mutateAsync.mockResolvedValue({ status: 'sent' }); });

  it('blocks send when recipient is empty', () => {
    render(wrap(<SendEmailDialog open identity="sales" to="" subject="S" body="B" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /Αποστολή|Send/ }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('sends the edited subject/body to the recipient', () => {
    render(wrap(<SendEmailDialog open identity="sales" to="c@x.gr" subject="S" body="B" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /Αποστολή|Send/ }));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'sales', to: 'c@x.gr', subject: 'S', body: 'B' }),
    );
  });
});
```

- [ ] **Step 2: Run it (red)**

Run: `npx vitest run src/features/email/SendEmailDialog.test.tsx`
Expected: FAIL — module `./SendEmailDialog` not found.

- [ ] **Step 3: Write the component**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSendEmail, type SendEmailVars } from './useSendEmail';

export type SendEmailDialogProps = {
  open: boolean;
  identity: SendEmailVars['identity'];
  to: string;
  subject: string;
  body: string;
  dedupeKey?: string;
  onClose: () => void;
};

export function SendEmailDialog({ open, identity, to, subject, body, dedupeKey, onClose }: SendEmailDialogProps) {
  const { t } = useTranslation('email');
  const send = useSendEmail();
  const [toEmail, setToEmail] = useState(to);
  const [subj, setSubj] = useState(subject);
  const [text, setText] = useState(body);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!toEmail.trim()) return setError(t('dialog.to_required'));
    try {
      await send.mutateAsync({ identity, to: toEmail.trim(), subject: subj, body: text, dedupeKey });
      setDone(true);
    } catch {
      setError(t('dialog.failed'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-white p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold">{t('dialog.title')}</h2>
        {done ? (
          <p className="text-sm text-green-700">{t('dialog.sent')}</p>
        ) : (
          <>
            <label className="block text-sm">{t('dialog.to')}
              <input aria-label={t('dialog.to')} value={toEmail} onChange={(e) => setToEmail(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="mt-3 block text-sm">{t('dialog.subject')}
              <input aria-label={t('dialog.subject')} value={subj} onChange={(e) => setSubj(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="mt-3 block text-sm">{t('dialog.body')}
              <textarea aria-label={t('dialog.body')} value={text} onChange={(e) => setText(e.target.value)}
                rows={8} className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>{t('dialog.cancel')}</button>
          {!done && (
            <button type="button" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
              onClick={submit} disabled={send.isPending}>{t('dialog.send')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it (green)**

Run: `npx vitest run src/features/email/SendEmailDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/email/SendEmailDialog.tsx src/features/email/SendEmailDialog.test.tsx
git commit -m "feat(email): editable SendEmailDialog + test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Wire the "Send offer email" action into the lead page

**Files:**
- Modify: `src/features/leads/LeadDetailPage.tsx`

- [ ] **Step 1: Read the current page to find the offer-sent context**

Run: `sed -n '1,140p' src/features/leads/LeadDetailPage.tsx`
Expected: identify where the lead object (with `email`, `contact_first_name`, `company_name`) and the current stage code are available, and where the action buttons render. Confirm how to obtain the lead's most recent offer id (look for an offers hook/list; the offer URL is `/offers/<id>`). If no offer id is readily available on this page, link to the lead's offers tab URL instead and pass that as `offerUrl`.

- [ ] **Step 2: Add the button + dialog**

Add imports:
```tsx
import { useState } from 'react';
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { buildOfferDraft } from '@/features/email/buildDraft';
```
Inside the component, add state and (when the lead is in the `offer_sent` stage) a button that opens the dialog with a prefilled draft:
```tsx
const [offerEmailOpen, setOfferEmailOpen] = useState(false);
// ...where stage code is known (e.g. lead.stage?.code === 'offer_sent'):
{lead?.stage?.code === 'offer_sent' && (
  <button type="button" className="rounded border px-3 py-1.5 text-sm"
    onClick={() => setOfferEmailOpen(true)}>
    {/* reuse email namespace */}
    Αποστολή προσφοράς
  </button>
)}
{lead && (() => {
  const name = lead.contact_first_name || lead.company_name || '';
  const offerUrl = `${window.location.origin}/leads/${lead.id}`; // or the offer detail URL if available
  const draft = buildOfferDraft(name, offerUrl);
  return (
    <SendEmailDialog
      open={offerEmailOpen}
      identity="sales"
      to={lead.email ?? ''}
      subject={draft.subject}
      body={draft.body}
      dedupeKey={`offer:${lead.id}`}
      onClose={() => setOfferEmailOpen(false)}
    />
  );
})()}
```
Adjust property names to the actual `lead` shape returned by `useLead` (confirm with the Step-1 read; the select is `*, stage:pipeline_stages(...)`).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/LeadDetailPage.tsx
git commit -m "feat(email): one-click Send offer email on the lead page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Wire the "Send welcome email" action into the deal page

**Files:**
- Modify: `src/features/deals/DealDetailPage.tsx`

- [ ] **Step 1: Read the page to find the client + won context**

Run: `sed -n '1,140p' src/features/deals/DealDetailPage.tsx`
Expected: identify how the deal's client (name + email) is available (the deal joins `clients`; `won_by_user_id` indicates a won deal) and where header actions render.

- [ ] **Step 2: Add the button + dialog**

Add imports:
```tsx
import { SendEmailDialog } from '@/features/email/SendEmailDialog';
import { buildWonDraft } from '@/features/email/buildDraft';
```
Add state + a button shown for won deals, and the dialog prefilled with the welcome draft (recipient = client email). Use `useState` for `welcomeOpen`. Pull the client name/email from the deal's joined client (confirm the exact field path in Step 1; if the client email is not already selected, extend the deal query's select to include `client:clients(name,email)`):
```tsx
const [welcomeOpen, setWelcomeOpen] = useState(false);
// ...in the actions area, for a won deal:
<button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setWelcomeOpen(true)}>
  Αποστολή welcome email
</button>
{deal && (() => {
  const client = (deal as any).client ?? {};
  const draft = buildWonDraft(client.name ?? '');
  return (
    <SendEmailDialog open={welcomeOpen} identity="sales" to={client.email ?? ''}
      subject={draft.subject} body={draft.body} dedupeKey={`won:${deal.id}`}
      onClose={() => setWelcomeOpen(false)} />
  );
})()}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/deals/DealDetailPage.tsx
git commit -m "feat(email): one-click Send welcome email on the deal page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Final verification

**Files:** none

- [ ] **Step 1: Full static + unit suite**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: typecheck 0, lint 0, all vitest tests pass (including the new template + dialog tests).

- [ ] **Step 2: Migrations apply cleanly on a fresh shadow DB**

Run: `supabase db reset` (against local) **or** confirm `supabase db push` reported all four `20260602*` migrations applied to the linked project, and `supabase test db` passes Task 7.
Expected: no migration errors; reminder SQL test green.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "chore(email): verification fixups" || echo "nothing to commit"
```

---

## Go-Live checklist (manual — only the user can do these)

These are **not** code steps; document completion separately. Without them, automated emails stay queued and one-click sends fail at Resend.

1. **Resend account + API key.** Rotate the key shared in chat, then:
   `supabase secrets set RESEND_API_KEY=<new_key> --project-ref xujlrclyzxrvxszepquy`
2. **Domain verification.** In Resend, add `itdev.gr`; copy the generated DKIM/SPF/DMARC DNS records into the `itdev.gr` DNS zone. Merge SPF into the single existing SPF record (do not add a second SPF record). Wait for Resend to show "Verified".
3. **Vault secrets for the drain cron** (run in the Supabase SQL editor):
   ```sql
   select vault.create_secret('https://xujlrclyzxrvxszepquy.supabase.co', 'project_url');
   select vault.create_secret('<service_role_key>', 'service_role_key');
   ```
   (Service-role key from Project Settings → API. Never commit it.)
4. **Turn off dry-run when ready:** `supabase secrets set EMAIL_DRY_RUN=false --project-ref xujlrclyzxrvxszepquy` and redeploy: `supabase functions deploy send-email --project-ref xujlrclyzxrvxszepquy`.
5. **Confirm mailboxes** `sales@`, `accounting@`, `noreply@itdev.gr` exist (first two receive replies).
6. **Live smoke:** with dry-run off, send one offer email to your own address from the lead page; confirm receipt + correct From/Reply-To; check `email_log` has a `sent` row with a real `resend_id`.

---

## Changes / Revert

**New:** 4 migrations (`20260602000001`–`04`), the `send-email` Edge Function (+ identities/templates/tests), `src/features/email/*`, `src/i18n/locales/{en,el}/email.json` (+ registration), buttons on Lead/Deal pages. **Secrets:** `RESEND_API_KEY`, `EMAIL_DRY_RUN`, Vault `project_url`/`service_role_key` — none in the repo.

**Revert:** each migration has a `-- ROLLBACK:` block (drop triggers/crons/functions/tables); `supabase functions delete send-email`; frontend changes are additive and revert by commit. **Kill switch without full revert:** `supabase secrets set EMAIL_DRY_RUN=true` (stops real delivery) and/or `cron.unschedule('daily_payment_reminders')` + `cron.unschedule('drain_email_outbox')`.

---

## Self-Review

**Spec coverage:** send-email Edge Function (T2–3), tables+dedupe (T1), identities (T2), Greek templates (T2,T4), dry-run (T3), outbox+drain (T1,T5), payment reminders 3-day/today/overdue + idempotency (T6,T7), internal new-task/new-job to assignee/group (T8), one-click offer/won with editable preview (T9–T13), manual setup incl. key rotation + DNS + Vault (Go-Live), testing (T4,T7,T11,T14). All spec sections map to tasks.

**Placeholder scan:** every code step has complete code; Tasks 12–13 contain real code but explicitly require reading the target page first (the exact `lead`/`deal` field paths are confirmed at execution time) — these are verification steps, not placeholders, because the surrounding component shape can't be fully known until read.

**Type consistency:** `SendEmailVars` (T10) matches `SendEmailDialog` props usage (T11) and the `custom` template `data:{subject,html,text}` contract (T2). Template keys, identities, and dedupe-key prefixes match between the Edge Function (T2–3), the reminder SQL (T6), and the triggers (T8). Function name `send-email` and body shape are identical across T3, T5, T10.
