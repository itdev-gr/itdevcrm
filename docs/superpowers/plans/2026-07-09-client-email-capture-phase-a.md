# Client Email Capture — Phase A1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture mkifokeris's last 10 days of *client* email into a new `email_messages` table — filed on the right client/deal/job, tagged by department, and protected by department-siloed RLS — and verify it against his real mailbox.

**Architecture:** A secret-gated `gmail-sync` edge function reads a target user's Gmail (read scope already granted), and for each message calls a security-definer SQL RPC `resolve_email_filing(from,to,subject)` that decides staff-vs-client, matches the client, resolves deal (newest active) + job (by subject code), and picks the department. Matched messages are upserted into `email_messages` (deduped by RFC822 Message-ID). This plan does a one-shot **backfill** for mkifokeris only; cron + incremental + UI are later plans.

**Tech Stack:** Supabase Postgres + RLS, Deno edge functions, Gmail REST API, TypeScript/vitest for pure helpers.

## Global Constraints

- **Test target only:** mkifokeris — `user_id = 61b53075-398f-43a0-86f6-8bce177b669b`. No other mailbox is read in this phase.
- **Backfill window:** last **10 days** (`newer_than:10d`).
- **Privacy:** store a message ONLY if exactly one of From/To is staff and the other matches a known client. **CC is never read or stored.**
- **Prod project ref:** `xujlrclyzxrvxszepquy`. Migrations are committed as files AND applied to prod via the Supabase Management API (curl + `sbp_` token, `User-Agent` header required). Edge functions deploy via `supabase functions deploy <name> --project-ref xujlrclyzxrvxszepquy` (Docker not required; add `--use-api` if it complains). Prod deploys run outside auto-mode — hand the exact command to the owner to `!`-run when the step says "deploy".
- **verify_jwt:** any new edge function that is called machine-to-machine (no user JWT) MUST have a `[functions.<name>] verify_jwt = false` block in `supabase/config.toml`, or its callback/gateway rejects with `UNAUTHORIZED_NO_AUTH_HEADER`.
- **Job code format:** `\d{6}-[A-Z]{3,}` (e.g. `000280-WEBDEV`); `jobs.code` holds exactly this, and `jobs.deal_id` gives the deal.
- **Department priority (tie-break when staff is in multiple groups):** `technical` > `accounting` > `sales`.
- **Build:** `npm run build` (tsc -b + eslint --max-warnings=0) must stay green.
- TDD, one deliverable per task, commit per task. Migrations carry a `-- ROLLBACK:` footer.

## File Structure

- Create `supabase/migrations/20260709170000_email_messages.sql` — `email_messages` + `user_google_sync` tables, RLS, indexes.
- Create `supabase/migrations/20260709170100_resolve_email_filing.sql` — the matching RPC.
- Modify `supabase/functions/_shared/google.ts` — add `parseAddress`, `extractJobCode`, `getGmailMessageFull`, `listGmailMessageIds` (readd), and MIME body extraction.
- Create `supabase/functions/_shared/google.parse.test.ts` — vitest unit tests for the pure parsers.
- Create `supabase/functions/gmail-sync/index.ts` — the sync/backfill orchestrator.
- Modify `supabase/config.toml` — add `[functions.gmail-sync] verify_jwt = false`.

---

### Task 1: `email_messages` + `user_google_sync` tables and RLS

**Files:**
- Create: `supabase/migrations/20260709170000_email_messages.sql`

**Interfaces:**
- Produces: table `public.email_messages(id, message_id unique, gmail_id, thread_id, direction, from_email, from_name, to_email, subject, body_text, body_html, snippet, sent_at, client_id, deal_id, job_id, department, staff_user_id, captured_from_user_id, created_at)`; table `public.user_google_sync(user_id pk, last_synced_at, backfilled_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- 2026-07-09: Client email capture — storage + department-siloed RLS.
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,            -- RFC822 Message-ID (dedup key)
  gmail_id text, thread_id text,
  direction text not null check (direction in ('inbound','outbound')),
  from_email text not null, from_name text,
  to_email text not null,
  subject text, body_text text, body_html text, snippet text,
  sent_at timestamptz,
  client_id uuid references public.clients(id),
  deal_id uuid references public.deals(id),
  job_id uuid references public.jobs(id),
  department text check (department in ('sales','accounting','technical')),
  staff_user_id uuid references public.profiles(user_id),
  captured_from_user_id uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index if not exists email_messages_deal_idx on public.email_messages(deal_id);
create index if not exists email_messages_job_idx on public.email_messages(job_id) where job_id is not null;
create index if not exists email_messages_client_idx on public.email_messages(client_id);
create index if not exists email_messages_thread_idx on public.email_messages(thread_id);

alter table public.email_messages enable row level security;

-- Department-siloed reads: admins all; you always see your own (sender/receiver);
-- otherwise the email's department must be one of your group codes.
create policy email_messages_select on public.email_messages for select using (
  current_user_is_admin()
  or staff_user_id = auth.uid()
  or exists (
    select 1 from public.user_groups ug
      join public.groups g on g.id = ug.group_id
     where ug.user_id = auth.uid() and g.code = email_messages.department
  )
);
-- No INSERT/UPDATE/DELETE policies: only the service-role edge function writes.

create table if not exists public.user_google_sync (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  last_synced_at timestamptz,
  backfilled_at timestamptz
);
alter table public.user_google_sync enable row level security;
-- No client policies: service-role only.

-- ROLLBACK:
--   drop table if exists public.user_google_sync;
--   drop table if exists public.email_messages;
```

- [ ] **Step 2: Apply to prod and verify the table + policy exist**

```bash
export SUPABASE_ACCESS_TOKEN=<sbp token>
REF=xujlrclyzxrvxszepquy
python3 -c "import json;open('/tmp/m.json','w').write(json.dumps({'query':open('supabase/migrations/20260709170000_email_messages.sql').read()}))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/m.json
# verify
python3 -c "import json;open('/tmp/v.json','w').write(json.dumps({'query':\"select count(*) as t from information_schema.tables where table_schema='public' and table_name in ('email_messages','user_google_sync');\"}))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/v.json
```
Expected: first call `[]`; verify call `[{"t":2}]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260709170000_email_messages.sql
git commit -m "feat(email): email_messages + user_google_sync tables with dept-siloed RLS"
```

---

### Task 2: `resolve_email_filing` matching RPC

**Files:**
- Create: `supabase/migrations/20260709170100_resolve_email_filing.sql`

**Interfaces:**
- Produces: `public.resolve_email_filing(p_from text, p_to text, p_subject text) returns table(client_id uuid, deal_id uuid, job_id uuid, department text, staff_user_id uuid, direction text)`. Returns **zero rows** when the message is not a staff↔client email (caller skips it).

- [ ] **Step 1: Write the migration**

```sql
-- 2026-07-09: decide how a captured email is filed. security definer because it
-- reads profiles/clients/deals/jobs across RLS. Returns 0 rows => don't store.
create or replace function public.resolve_email_filing(p_from text, p_to text, p_subject text)
returns table (client_id uuid, deal_id uuid, job_id uuid, department text, staff_user_id uuid, direction text)
language plpgsql security definer set search_path = public stable
as $$
declare
  v_from text := lower(trim(coalesce(p_from,'')));
  v_to   text := lower(trim(coalesce(p_to,'')));
  v_staff_email text; v_client_email text; v_dir text;
  v_staff uuid; v_client uuid; v_dept text; v_deal uuid; v_job uuid; v_code text;
begin
  if exists (select 1 from profiles where lower(email)=v_from) then
    v_staff_email:=v_from; v_client_email:=v_to; v_dir:='outbound';
  elsif exists (select 1 from profiles where lower(email)=v_to) then
    v_staff_email:=v_to; v_client_email:=v_from; v_dir:='inbound';
  else
    return;  -- no staff party
  end if;

  select user_id into v_staff from profiles where lower(email)=v_staff_email limit 1;

  select id into v_client from clients where lower(email)=v_client_email limit 1;
  if v_client is null then return; end if;  -- not a known client

  select g.code into v_dept
    from user_groups ug join groups g on g.id=ug.group_id
   where ug.user_id=v_staff and g.code in ('technical','accounting','sales')
   order by case g.code when 'technical' then 1 when 'accounting' then 2 else 3 end
   limit 1;

  v_code := substring(coalesce(p_subject,'') from '(\d{6}-[A-Z]{3,})');
  if v_code is not null then
    select j.id, j.deal_id into v_job, v_deal from jobs j where j.code=v_code limit 1;
  end if;
  if v_deal is null then
    select d.id into v_deal from deals d
     where d.client_id=v_client and d.archived=false
     order by d.created_at desc limit 1;
  end if;

  return query select v_client, v_deal, v_job, v_dept, v_staff, v_dir;
end $$;

grant execute on function public.resolve_email_filing(text,text,text) to service_role;

-- ROLLBACK: drop function if exists public.resolve_email_filing(text,text,text);
```

- [ ] **Step 2: Apply to prod**

```bash
python3 -c "import json;open('/tmp/m2.json','w').write(json.dumps({'query':open('supabase/migrations/20260709170100_resolve_email_filing.sql').read()}))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/m2.json
```
Expected: `[]`.

- [ ] **Step 3: Validate against real data (the upd8 thread we saw)**

```bash
# mkifokeris <-> admin@upd8.gr with code 000280-WEBDEV in the subject.
python3 -c "import json;open('/tmp/t.json','w').write(json.dumps({'query':\"select * from public.resolve_email_filing('admin@upd8.gr','mkifokeris@itdev.gr','Re: 000280-WEBDEV Re: Orthohouse');\"}))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/t.json
```
Expected: one row with `direction=inbound`, a non-null `client_id`, `deal_id`, and a `job_id` matching the `000280-WEBDEV` job (department = mkifokeris's group). Also run with a made-up external address on both sides → expect **zero rows** (privacy skip).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260709170100_resolve_email_filing.sql
git commit -m "feat(email): resolve_email_filing RPC (staff/client match, code->job, dept)"
```

---

### Task 3: Gmail read + parse helpers

**Files:**
- Modify: `supabase/functions/_shared/google.ts`
- Test: `supabase/functions/_shared/google.parse.test.ts`

**Interfaces:**
- Produces (all exported from `_shared/google.ts`):
  - `parseAddress(v: string): { email: string; name: string }`
  - `extractJobCode(subject: string): string | null`
  - `listGmailMessageIds(accessToken: string, query: string, max: number): Promise<string[]>`
  - `getGmailMessageFull(accessToken: string, id: string): Promise<GmailMessage>` where
    `GmailMessage = { message_id, gmail_id, thread_id, from_email, from_name, to_email, subject, date, internal_date, body_text, body_html, snippet }` (direction is decided by the RPC, not read from the message)

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/google.parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseAddress, extractJobCode } from './google.ts';

describe('parseAddress', () => {
  it('splits "Name <email>" and lowercases the address', () => {
    expect(parseAddress('Marios Kifokeris <MKifokeris@itdev.gr>'))
      .toEqual({ name: 'Marios Kifokeris', email: 'mkifokeris@itdev.gr' });
  });
  it('handles a bare address', () => {
    expect(parseAddress('admin@upd8.gr')).toEqual({ name: '', email: 'admin@upd8.gr' });
  });
});

describe('extractJobCode', () => {
  it('finds the code inside a Re: subject', () => {
    expect(extractJobCode('Re: 000280-WEBDEV Re: Orthohouse')).toBe('000280-WEBDEV');
  });
  it('returns null when there is no code', () => {
    expect(extractJobCode('Meeting tomorrow')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run supabase/functions/_shared/google.parse.test.ts`
Expected: FAIL — `parseAddress`/`extractJobCode` not exported.

- [ ] **Step 3: Add the helpers to `_shared/google.ts`**

```ts
// Append to supabase/functions/_shared/google.ts
export function parseAddress(v: string): { email: string; name: string } {
  const m = (v ?? '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: (v ?? '').trim().toLowerCase() };
}

export function extractJobCode(subject: string): string | null {
  const m = (subject ?? '').match(/(\d{6}-[A-Z]{3,})/);
  return m ? m[1] : null;
}

export type GmailMessage = {
  message_id: string; gmail_id: string; thread_id: string;
  from_email: string; from_name: string; to_email: string;
  subject: string; date: string; internal_date: number;
  body_text: string; body_html: string; snippet: string;
};

function b64urlDecodeUtf8(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// deno-lint-ignore no-explicit-any
function collectBody(payload: any, acc: { text: string[]; html: string[] }): void {
  if (!payload) return;
  const mime = payload.mimeType ?? '';
  if (mime === 'text/plain' && payload.body?.data) acc.text.push(b64urlDecodeUtf8(payload.body.data));
  else if (mime === 'text/html' && payload.body?.data) acc.html.push(b64urlDecodeUtf8(payload.body.data));
  for (const p of payload.parts ?? []) collectBody(p, acc);
}

export async function listGmailMessageIds(accessToken: string, query: string, max: number): Promise<string[]> {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  u.searchParams.set('maxResults', String(max));
  if (query) u.searchParams.set('q', query);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`list_failed: ${await r.text()}`);
  const j = await r.json();
  return ((j.messages ?? []) as { id: string }[]).map((m) => m.id);
}

export async function getGmailMessageFull(accessToken: string, id: string): Promise<GmailMessage> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`get_failed: ${await r.text()}`);
  const j = await r.json();
  const headers = (j.payload?.headers ?? []) as { name: string; value: string }[];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
  const from = parseAddress(h('From'));
  const to = parseAddress(h('To'));
  const acc = { text: [] as string[], html: [] as string[] };
  collectBody(j.payload, acc);
  return {
    message_id: h('Message-ID') || h('Message-Id') || j.id,
    gmail_id: j.id, thread_id: j.threadId,
    from_email: from.email, from_name: from.name, to_email: to.email,
    subject: h('Subject'), date: h('Date'), internal_date: Number(j.internalDate ?? 0),
    body_text: acc.text.join('\n'), body_html: acc.html.join('\n'), snippet: j.snippet ?? '',
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run supabase/functions/_shared/google.parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/google.ts supabase/functions/_shared/google.parse.test.ts
git commit -m "feat(email): Gmail read + parse helpers (parseAddress, extractJobCode, full message)"
```

---

### Task 4: `gmail-sync` edge function (backfill orchestrator)

**Files:**
- Create: `supabase/functions/gmail-sync/index.ts`
- Modify: `supabase/config.toml` (add `[functions.gmail-sync] verify_jwt = false`)

**Interfaces:**
- Consumes: `decryptToken`, `refreshAccessToken`, `listGmailMessageIds`, `getGmailMessageFull`, `parseAddress` from `_shared/google.ts`; `timingSafeEqual` from `_shared/timing.ts`; RPC `resolve_email_filing`.
- Produces: `POST { user_id, mode: 'backfill' }` with `Authorization: Bearer <GMAIL_SYNC_SECRET>` → reads that user's last 10 days, upserts matched messages into `email_messages`, updates `user_google_sync`. Returns `{ scanned, matched, stored }`.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/gmail-sync/index.ts
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { decryptToken, refreshAccessToken, listGmailMessageIds, getGmailMessageFull } from '../_shared/google.ts';
import { timingSafeEqual } from '../_shared/timing.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const TOKEN_KEY = Deno.env.get('GMAIL_TOKEN_KEY')!;
const SYNC_SECRET = Deno.env.get('GMAIL_SYNC_SECRET') ?? '';
const admin = createClient(URL_, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!SYNC_SECRET || !timingSafeEqual(token, SYNC_SECRET)) return json({ error: 'forbidden' }, 403);

  const body = (await req.json().catch(() => ({}))) as { user_id?: string; mode?: string };
  if (!body.user_id) return json({ error: 'user_id required' }, 400);

  const { data: acct } = await admin.from('user_google_accounts')
    .select('refresh_token_enc, revoked_at, scopes').eq('user_id', body.user_id).maybeSingle();
  if (!acct || acct.revoked_at) return json({ error: 'not_connected' }, 409);
  if (!String(acct.scopes ?? '').includes('gmail.readonly')) return json({ error: 'no_read_scope' }, 409);

  const refresh = await decryptToken(acct.refresh_token_enc, TOKEN_KEY);
  const access = await refreshAccessToken(refresh, CLIENT_ID, CLIENT_SECRET);
  if (!access) return json({ error: 'token_refresh_failed' }, 502);

  const ids = await listGmailMessageIds(access, 'newer_than:10d', 200);
  let matched = 0, stored = 0;
  for (const id of ids) {
    const m = await getGmailMessageFull(access, id);
    if (!m.from_email || !m.to_email) continue;
    const { data: fil } = await admin.rpc('resolve_email_filing', {
      p_from: m.from_email, p_to: m.to_email, p_subject: m.subject,
    });
    const f = Array.isArray(fil) ? fil[0] : null;
    if (!f) continue;               // not a staff<->client email
    matched++;
    const { error } = await admin.from('email_messages').upsert({
      message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
      direction: f.direction, from_email: m.from_email, from_name: m.from_name, to_email: m.to_email,
      subject: m.subject, body_text: m.body_text, body_html: m.body_html, snippet: m.snippet,
      sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
      client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, department: f.department,
      staff_user_id: f.staff_user_id, captured_from_user_id: body.user_id,
    }, { onConflict: 'message_id', ignoreDuplicates: true });
    if (!error) stored++;
  }
  await admin.from('user_google_sync').upsert({
    user_id: body.user_id, last_synced_at: new Date().toISOString(), backfilled_at: new Date().toISOString(),
  });
  return json({ scanned: ids.length, matched, stored });
});
```

- [ ] **Step 2: Add the config block**

```toml
# supabase/config.toml — append near the other function blocks
# Machine-to-machine (cron/backfill); auth is a GMAIL_SYNC_SECRET Bearer token.
[functions.gmail-sync]
verify_jwt = false
```

- [ ] **Step 3: Build check (edge fn is Deno, but keep the repo green)**

Run: `npm run build`
Expected: exit 0 (edge functions are not part of the vite build; this just confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/gmail-sync/index.ts supabase/config.toml
git commit -m "feat(email): gmail-sync edge fn — backfill a user's client email into email_messages"
```

---

### Task 5: Deploy, set the secret, backfill mkifokeris, verify

**Files:** none (ops + validation)

- [ ] **Step 1: Set `GMAIL_SYNC_SECRET`**

```bash
SECRET=$(openssl rand -hex 24); echo -n "$SECRET" > /tmp/sync_secret.txt
python3 -c "import json;open('/tmp/s.json','w').write(json.dumps([{'name':'GMAIL_SYNC_SECRET','value':open('/tmp/sync_secret.txt').read()}]))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/secrets" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/s.json -w "\nHTTP %{http_code}\n"
```
Expected: `HTTP 201`.

- [ ] **Step 2: Deploy (owner `!`-runs — prod deploy)**

```
! SUPABASE_ACCESS_TOKEN=<sbp> supabase functions deploy gmail-sync --project-ref xujlrclyzxrvxszepquy
```
Expected: `Deployed Functions on project xujlrclyzxrvxszepquy: gmail-sync`.

- [ ] **Step 3: Run the backfill for mkifokeris**

```bash
SECRET=$(cat /tmp/sync_secret.txt)
curl -sS -X POST "https://$REF.supabase.co/functions/v1/gmail-sync" \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"user_id":"61b53075-398f-43a0-86f6-8bce177b669b","mode":"backfill"}'
```
Expected: `{"scanned":N,"matched":M,"stored":M}` with M ≥ 1.

- [ ] **Step 4: Verify the stored rows are correctly filed**

```bash
python3 -c "import json;open('/tmp/q.json','w').write(json.dumps({'query':\"select direction, department, from_email, to_email, left(subject,40) subject, (deal_id is not null) has_deal, (job_id is not null) has_job from public.email_messages order by sent_at desc limit 10;\"}))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/q.json
```
Expected: rows for the upd8/Orthohouse (`000280-WEBDEV`, `has_job=true`) and the yahoo `005188-WEBDEV` threads, each with a department and `has_deal=true`. No calendar/`noreply@itdev.gr`/internal rows (privacy filter dropped them).

- [ ] **Step 5: Verify siloing (RLS role-switch as a non-department user)**

```bash
# As a sales-only non-admin who was NOT on these emails: expect 0 accounting/technical rows visible.
python3 -c "import json;open('/tmp/r.json','w').write(json.dumps({'query':\"begin; set local role authenticated; set local request.jwt.claims='{\\\"sub\\\":\\\"<a sales-only user_id>\\\",\\\"role\\\":\\\"authenticated\\\"}'; select count(*) visible from public.email_messages; rollback;\"}))"
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: itdevcrm-cli" --data @/tmp/r.json
```
Expected: only rows whose `department` matches that user's groups (or that they were on) — proving the silo. Compare against the admin count (all rows).

- [ ] **Step 6: Commit a short validation note**

```bash
# record the run in the plan doc (checked boxes) and commit
git add docs/superpowers/plans/2026-07-09-client-email-capture-phase-a.md
git commit -m "docs(email): Phase A1 capture validated on mkifokeris (backfill 10d)"
```

---

## Follow-up plans (out of scope here)
- **Phase A2:** pg_cron every 5 min + incremental (`after:<last_synced>`) across all connected users; remove the single-user gate.
- **Phase B:** Deal/Job/Client **Emails tab** (threaded, RLS-siloed) + inline Reply reusing the personal-send flow.
- **Phase C:** rollout — everyone reconnects for read; volume/error monitoring.

## Changes / Revert
- Adds two tables, one RPC, one edge function, helper exports, one config block, one project secret.
- Rollback: `drop function resolve_email_filing`; `drop table email_messages, user_google_sync`; `supabase functions delete gmail-sync`; remove `GMAIL_SYNC_SECRET`; revert the `_shared/google.ts` helper additions + config block.
