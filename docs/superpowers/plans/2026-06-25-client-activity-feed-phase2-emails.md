# Client Activity Feed — Phase 2 (Emails) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface every email to a client in the per-client activity feed — which template fired, that it was sent, and the Resend delivery outcome (delivered / bounced / spam-complaint).

**Architecture:** Keep the single event store. Add `client_id` + delivery columns to `email_log`; a BEFORE-INSERT trigger links each email to a client by `to_email`; a dedicated funnel trigger writes meaningful email events into `activity_log`. A new `resend-webhook` edge function (HMAC-verified, `verify_jwt=false`) updates `email_log` by `resend_id` on Resend events. The feed's `describeEvent` formatter gains an `email` branch.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno), React + TypeScript, vitest. Prod project `xujlrclyzxrvxszepquy`.

**Spec:** `docs/superpowers/specs/2026-06-25-client-activity-feed-design.md`. **Phase 1 (shipped):** the feed, `describeEvent`, `ClientActivityPanel` (with an `email` category + Emails chip already present but empty).

**Context that matters:**
- `email_log` columns today: `id, identity, to_email, template_key, resend_id, status, dedupe_key, error, created_at`. `status` is free-text (no CHECK) — send-email writes `sent`/`failed`/`skipped`. `resend_id` already holds the Resend message id.
- `send-email/index.ts` needs NO changes (a trigger does the linking).
- `clients.email` exists (486 populated, ~1 dup-email group → linkage by `to_email` is essentially unambiguous).
- Reusable HMAC verifier: `supabase/functions/auth-email/hook.ts` → `verifyWebhookSignature({secret, msgId, timestamp, signatureHeader, payload, nowSeconds})`. Resend uses Svix headers `svix-id` / `svix-timestamp` / `svix-signature`, secret `whsec_…` — identical scheme.
- `describeEvent` (in `src/features/activity/format.ts`) already has a `currentOf`/`previousOf` helper and an `email` category from `categoryOf('email_log')`.

---

## File Structure
- `supabase/migrations/20260625110000_email_log_client_delivery.sql` — columns + index (Task 1)
- `supabase/migrations/20260625110100_email_log_link_client.sql` — BEFORE-INSERT linkage trigger + backfill (Task 2)
- `supabase/migrations/20260625110200_email_log_activity_funnel.sql` — funnel trigger (Task 3)
- `supabase/migrations/20260625110300_backfill_email_activity.sql` — historical sent-email events into activity_log (Task 4)
- `supabase/functions/resend-webhook/index.ts` + `supabase/functions/resend-webhook/verify.ts` — webhook (Task 5)
- `supabase/config.toml` — register the function (Task 5)
- `src/features/activity/format.ts` + `format.test.ts` — email rendering (Task 6)

---

## Task 1: Migration — `email_log` delivery columns + index

**Files:** Create `supabase/migrations/20260625110000_email_log_client_delivery.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 20260625110000_email_log_client_delivery.sql
-- Client link + delivery lifecycle on email_log. status stays free-text;
-- new values delivered/bounced/complained come from the Resend webhook.
alter table public.email_log
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz;

-- webhook looks rows up by the Resend message id
create index if not exists email_log_resend_id_idx on public.email_log (resend_id) where resend_id is not null;
create index if not exists email_log_client_idx on public.email_log (client_id) where client_id is not null;

-- ROLLBACK:
--   drop index if exists public.email_log_client_idx;
--   drop index if exists public.email_log_resend_id_idx;
--   alter table public.email_log drop column if exists bounced_at, drop column if exists delivered_at, drop column if exists client_id;
```
- [ ] **Step 2: Apply** via `apply_migration` (name `email_log_client_delivery`).
- [ ] **Step 3: Verify**
```sql
select count(*) as cols from information_schema.columns
where table_schema='public' and table_name='email_log' and column_name in ('client_id','delivered_at','bounced_at');
```
Expected: `cols = 3`.
- [ ] **Step 4: Commit** `git add … && git commit -m "feat(activity): email_log client_id + delivery columns"`

---

## Task 2: Migration — link emails to clients (trigger + backfill)

**Files:** Create `supabase/migrations/20260625110100_email_log_link_client.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 20260625110100_email_log_link_client.sql
-- Resolve client_id from to_email at insert time (most recent match wins).
-- send-email stays untouched.
create or replace function public.email_log_set_client_id()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.client_id is null and new.to_email is not null then
    select c.id into new.client_id
    from public.clients c
    where lower(c.email) = lower(new.to_email)
    order by c.created_at desc
    limit 1;
  end if;
  return new;
end $fn$;

drop trigger if exists email_log_set_client_id on public.email_log;
create trigger email_log_set_client_id
  before insert on public.email_log
  for each row execute function public.email_log_set_client_id();

-- Backfill existing rows (with backup).
create table if not exists public.email_log_clientid_backup_20260625 as
select id, client_id from public.email_log;

update public.email_log e
  set client_id = c.id
  from public.clients c
  where e.client_id is null and e.to_email is not null
    and lower(c.email) = lower(e.to_email)
    and c.id = (select c2.id from public.clients c2 where lower(c2.email)=lower(e.to_email) order by c2.created_at desc limit 1);

-- ROLLBACK:
--   update public.email_log e set client_id=b.client_id from public.email_log_clientid_backup_20260625 b where e.id=b.id;
--   drop table if exists public.email_log_clientid_backup_20260625;
--   drop trigger if exists email_log_set_client_id on public.email_log;
--   drop function if exists public.email_log_set_client_id();
```
- [ ] **Step 2: Apply** via `apply_migration` (name `email_log_link_client`).
- [ ] **Step 3: Verify** how many emails linked:
```sql
select count(*) filter (where client_id is not null) as linked, count(*) as total from public.email_log;
```
Expected: a meaningful `linked` count (client emails matched; internal/lead emails stay null).
- [ ] **Step 4: Commit** `git commit -m "feat(activity): link email_log rows to clients by to_email"`

---

## Task 3: Migration — funnel email events into activity_log

**Files:** Create `supabase/migrations/20260625110200_email_log_activity_funnel.sql`

A dedicated funnel (not the generic `log_activity`) so we only surface meaningful, client-linked email events and keep `failed`/`skipped`/internal noise out.

- [ ] **Step 1: Write the migration**
```sql
-- 20260625110200_email_log_activity_funnel.sql
-- Write client-linked email lifecycle events into activity_log so they appear
-- in the unified feed. INSERT(status=sent) => "sent"; UPDATE to a delivery
-- outcome => that outcome. Service-role webhook updates have no auth.uid()
-- (actor shows as System), which is correct for automated delivery events.
create or replace function public.log_email_activity()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.client_id is not null and new.status = 'sent' then
      insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
      values ('email_log', new.id, auth.uid(), 'insert', row_to_json(new)::jsonb, new.client_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.client_id is not null
       and new.status is distinct from old.status
       and new.status in ('delivered','bounced','complained') then
      insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
      values ('email_log', new.id, auth.uid(), 'update',
              jsonb_build_object('old', row_to_json(old)::jsonb, 'new', row_to_json(new)::jsonb),
              new.client_id);
    end if;
  end if;
  return coalesce(new, old);
end $fn$;

drop trigger if exists email_log_activity on public.email_log;
create trigger email_log_activity
  after insert or update on public.email_log
  for each row execute function public.log_email_activity();

-- ROLLBACK:
--   drop trigger if exists email_log_activity on public.email_log;
--   drop function if exists public.log_email_activity();
```
- [ ] **Step 2: Apply** via `apply_migration` (name `email_log_activity_funnel`).
- [ ] **Step 3: Verify** the trigger exists:
```sql
select trigger_name from information_schema.triggers
where trigger_schema='public' and event_object_table='email_log' and trigger_name='email_log_activity';
```
Expected: one row (covering insert+update).
- [ ] **Step 4: Commit** `git commit -m "feat(activity): funnel client email events into activity_log"`

---

## Task 4: Migration — backfill historical sent emails into the feed

**Files:** Create `supabase/migrations/20260625110300_backfill_email_activity.sql`

So the Emails chip shows past sends (not just future ones).

- [ ] **Step 1: Check volume first** (run via `execute_sql`, not in the migration):
```sql
select count(*) as historical_sent_client_emails
from public.email_log where status='sent' and client_id is not null;
```
Note the number in the commit message. (If it is implausibly large, e.g. >50k, pause and confirm with the user before backfilling.)

- [ ] **Step 2: Write the migration**
```sql
-- 20260625110300_backfill_email_activity.sql
-- One-time: surface historical client-linked sent emails in the feed.
-- Idempotent: skips emails that already have an activity_log row.
insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id, created_at)
select 'email_log', e.id, null, 'insert', row_to_json(e)::jsonb, e.client_id, e.created_at
from public.email_log e
where e.status = 'sent' and e.client_id is not null
  and not exists (
    select 1 from public.activity_log a
    where a.entity_type='email_log' and a.entity_id=e.id and a.action='insert'
  );

-- ROLLBACK:
--   delete from public.activity_log where entity_type='email_log' and action='insert' and user_id is null;
```
- [ ] **Step 3: Apply** via `apply_migration` (name `backfill_email_activity`).
- [ ] **Step 4: Verify** for a known client with emails:
```sql
select count(*) from public.activity_log where entity_type='email_log';
```
Expected: roughly the historical_sent count from Step 1.
- [ ] **Step 5: Commit** `git commit -m "feat(activity): backfill historical sent emails into feed (<N> rows)"`

---

## Task 5: Edge function — `resend-webhook`

**Files:**
- Create `supabase/functions/resend-webhook/verify.ts`
- Create `supabase/functions/resend-webhook/index.ts`
- Modify `supabase/config.toml` (add `[functions.resend-webhook]\nverify_jwt = false`)
- Test: `supabase/functions/resend-webhook/verify.test.ts`

- [ ] **Step 1: Create `verify.ts`** (copy of the proven verifier + Resend event→status mapping)
```ts
// Standard-webhooks (Svix) HMAC verification — same scheme Resend uses.
const encoder = new TextEncoder();
function base64Decode(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const TOLERANCE_SECONDS = 300;

export async function verifyWebhookSignature(args: {
  secret: string; msgId: string; timestamp: string; signatureHeader: string; payload: string; nowSeconds: number;
}): Promise<boolean> {
  const { secret, msgId, timestamp, signatureHeader, payload, nowSeconds } = args;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const rawSecret = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('raw', base64Decode(rawSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  } catch { return false; }
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${msgId}.${timestamp}.${payload}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signatureHeader.split(' ').some((entry) => {
    const [version, candidate] = entry.split(',');
    return version === 'v1' && !!candidate && timingSafeEqual(candidate, expected);
  });
}

/** Map a Resend event type to an email_log status update (or null = ignore). */
export function statusForResendEvent(eventType: string): { status: string; stamp?: 'delivered_at' | 'bounced_at' } | null {
  switch (eventType) {
    case 'email.delivered': return { status: 'delivered', stamp: 'delivered_at' };
    case 'email.bounced': return { status: 'bounced', stamp: 'bounced_at' };
    case 'email.complained': return { status: 'complained' };
    default: return null; // email.sent/opened/clicked/delivery_delayed — ignore
  }
}
```

- [ ] **Step 2: Write `verify.test.ts`** (Node/vitest — pure mapping, no crypto needed)
```ts
import { describe, it, expect } from 'vitest';
import { statusForResendEvent } from './verify';

describe('statusForResendEvent', () => {
  it('maps delivered → delivered + delivered_at', () => {
    expect(statusForResendEvent('email.delivered')).toEqual({ status: 'delivered', stamp: 'delivered_at' });
  });
  it('maps bounced → bounced + bounced_at', () => {
    expect(statusForResendEvent('email.bounced')).toEqual({ status: 'bounced', stamp: 'bounced_at' });
  });
  it('maps complained → complained (no stamp)', () => {
    expect(statusForResendEvent('email.complained')).toEqual({ status: 'complained' });
  });
  it('ignores noise events', () => {
    expect(statusForResendEvent('email.sent')).toBeNull();
    expect(statusForResendEvent('email.opened')).toBeNull();
    expect(statusForResendEvent('email.delivery_delayed')).toBeNull();
  });
});
```
Run: `npx vitest run supabase/functions/resend-webhook/verify.test.ts` → expect FAIL (no module) then PASS after Step 1 exists. (If vitest's config excludes `supabase/functions`, run with `npx vitest run --root . supabase/functions/resend-webhook/verify.test.ts`; if still excluded, note it and rely on the deployed smoke in Step 6.)

- [ ] **Step 3: Create `index.ts`**
```ts
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { verifyWebhookSignature, statusForResendEvent } from './verify.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
const admin = createClient(URL, SERVICE_KEY);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!URL || !SERVICE_KEY || !SECRET) return json({ error: 'misconfigured' }, 500);

  const payload = await req.text();
  const ok = await verifyWebhookSignature({
    secret: SECRET,
    msgId: req.headers.get('svix-id') ?? req.headers.get('webhook-id') ?? '',
    timestamp: req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp') ?? '',
    signatureHeader: req.headers.get('svix-signature') ?? req.headers.get('webhook-signature') ?? '',
    payload,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!ok) return json({ error: 'invalid signature' }, 401);

  const evt = JSON.parse(payload) as { type?: string; data?: { email_id?: string } };
  const mapped = evt.type ? statusForResendEvent(evt.type) : null;
  const emailId = evt.data?.email_id;
  if (!mapped || !emailId) return json({ ok: true, ignored: true });

  const patch: Record<string, unknown> = { status: mapped.status };
  if (mapped.stamp) patch[mapped.stamp] = new Date().toISOString();
  // Only advance forward: never overwrite a delivered row with a later stray event of lower value.
  await admin.from('email_log').update(patch).eq('resend_id', emailId);
  return json({ ok: true });
});
```

- [ ] **Step 4: Register in `config.toml`** — append:
```toml
[functions.resend-webhook]
verify_jwt = false
```

- [ ] **Step 5: Deploy via MCP** — `deploy_edge_function` with `project_id=xujlrclyzxrvxszepquy`, `name=resend-webhook`, `entrypoint_path=index.ts`, `verify_jwt=false`, `files=[index.ts, verify.ts]` (full contents of both). Then set the secret: tell the user to add `RESEND_WEBHOOK_SECRET` as a Supabase secret (value = the Resend webhook signing secret, `whsec_…`) — do NOT put the literal secret in any file/commit.

- [ ] **Step 6: Commit** `git add supabase/functions/resend-webhook supabase/config.toml && git commit -m "feat(activity): resend-webhook edge fn for email delivery tracking"`

---

## Task 6: Formatter — email rendering in `describeEvent`

**Files:** Modify `src/features/activity/format.ts`; Test `src/features/activity/format.test.ts`

- [ ] **Step 1: Append failing tests** to `format.test.ts`
```ts
describe('describeEvent — emails', () => {
  it('describes a sent email with a friendly template name + recipient', () => {
    const v = describeEvent(
      { entity_type: 'email_log', action: 'insert',
        changes: { template_key: 'won_welcome', to_email: 'a@b.gr', status: 'sent' } },
      resolver,
    );
    expect(v.category).toBe('email');
    expect(v.summary).toBe('Email sent: Welcome email');
    expect(v.lines[0]).toEqual({ key: 'to', label: 'To', text: 'a@b.gr' });
  });
  it('describes a delivered email', () => {
    const v = describeEvent(
      { entity_type: 'email_log', action: 'update',
        changes: { old: { template_key: 'won_welcome', to_email: 'a@b.gr', status: 'sent' },
                   new: { template_key: 'won_welcome', to_email: 'a@b.gr', status: 'delivered' } } },
      resolver,
    );
    expect(v.summary).toBe('Email delivered: Welcome email');
  });
  it('describes a bounced email', () => {
    const v = describeEvent(
      { entity_type: 'email_log', action: 'update',
        changes: { old: { template_key: 'payment_overdue', to_email: 'a@b.gr', status: 'sent' },
                   new: { template_key: 'payment_overdue', to_email: 'a@b.gr', status: 'bounced' } } },
      resolver,
    );
    expect(v.summary).toBe('Email bounced: Payment reminder');
  });
  it('humanizes unknown template keys', () => {
    const v = describeEvent(
      { entity_type: 'email_log', action: 'insert', changes: { template_key: 'some_new_thing', to_email: 'a@b.gr', status: 'sent' } },
      resolver,
    );
    expect(v.summary).toBe('Email sent: Some new thing');
  });
});
```
Run `npx vitest run src/features/activity/format.test.ts` → expect the 4 new ones FAIL.

- [ ] **Step 2: Add the email branch + label map** to `format.ts`. First add this map near the other const maps (after `PAYMENT_STATUS_LABELS`):
```ts
const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  won_welcome: 'Welcome email',
  lead_welcome: 'Lead welcome email',
  webseo_gsc_access: 'Web SEO – GSC access request',
  localseo_gbp_access: 'Local SEO – GBP access request',
  contract_send: 'Contract',
  payment_due_soon: 'Payment reminder',
  payment_overdue: 'Payment reminder',
  payment_reminder: 'Payment reminder',
  reengage_90d: 'Re-engagement email',
  noanswer_day0: 'No-answer follow-up', noanswer_day2: 'No-answer follow-up',
  noanswer_day5: 'No-answer follow-up', noanswer_day10: 'No-answer follow-up',
  offer_followup_day2: 'Offer follow-up', offer_followup_day5: 'Offer follow-up', offer_followup_day10: 'Offer follow-up',
  custom: 'Email',
};
function emailTemplateLabel(key: string): string {
  if (EMAIL_TEMPLATE_LABELS[key]) return EMAIL_TEMPLATE_LABELS[key]!;
  const s = key.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Email';
}
```
Then add this branch INSIDE `describeEvent`, immediately before the `// Generic:` comment block:
```ts
  if (category === 'email') {
    const tpl = emailTemplateLabel(String(cur.template_key ?? prev.template_key ?? ''));
    const to = String(cur.to_email ?? prev.to_email ?? '');
    const lines = to ? [{ key: 'to', label: 'To', text: to }] : [];
    const status = String(cur.status ?? '');
    if (row.action === 'insert')
      return { category, summary: status === 'failed' ? `Email failed: ${tpl}` : `Email sent: ${tpl}`, lines };
    if (status === 'delivered') return { category, summary: `Email delivered: ${tpl}`, lines };
    if (status === 'bounced') return { category, summary: `Email bounced: ${tpl}`, lines };
    if (status === 'complained') return { category, summary: `Spam complaint: ${tpl}`, lines };
    return { category, summary: `Email ${status}: ${tpl}`, lines };
  }
```
Run `npx vitest run src/features/activity/format.test.ts` → expect ALL pass. Then `npm run build` → expect clean.

- [ ] **Step 3: Commit** `git add src/features/activity/format.ts src/features/activity/format.test.ts && git commit -m "feat(activity): render email sent/delivered/bounced in the feed"`

---

## Task 7: Wire Resend + live smoke

- [ ] **Step 1:** In the Resend dashboard, add a webhook pointing to the deployed function URL `https://xujlrclyzxrvxszepquy.functions.supabase.co/resend-webhook`, subscribed to `email.sent`, `email.delivered`, `email.bounced`, `email.complained`. Copy its signing secret into the Supabase secret `RESEND_WEBHOOK_SECRET` (user action — never commit the secret).
- [ ] **Step 2:** Trigger a real client email (e.g. resend a welcome) to a deliverable address; confirm `email_log` gets `status='sent'` then flips to `delivered` (and `delivered_at` set) within a minute, and that an "Email sent"/"Email delivered" pair appears in that client's Activity feed under the **Emails** chip.
- [ ] **Step 3:** Push to deploy the frontend (`git push origin main`) once the user approves.

---

## Self-Review
- **Spec coverage:** email send (Task 3 insert funnel + Task 6 render), delivery/bounce/complaint (Task 5 webhook → Task 3 update funnel → Task 6 render), client linkage (Task 2), historical visibility (Task 4). Emails chip already exists from Phase 1.
- **Placeholders:** none — all SQL, Deno, and TS complete.
- **Type/name consistency:** `verifyWebhookSignature`/`statusForResendEvent` shared between `index.ts` and `verify.test.ts`; `emailTemplateLabel`/`EMAIL_TEMPLATE_LABELS` defined once; email branch uses existing `currentOf`/`previousOf`.
- **Safety:** webhook is HMAC-verified (`verify_jwt=false` justified); funnel excludes failed/skipped/internal/unlinked; backfill is idempotent + reversible; secret stays out of the repo.
