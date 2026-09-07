# Campaign Sending Engine (Φάση 1α) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Το σύστημα που στέλνει μια καμπάνια σε χιλιάδες παραλήπτες με δικιά του ουρά, δικό του ρυθμό και δική του καταγραφή — χωρίς να αγγίζει τίποτα από τα email που στέλνει ήδη αυτόματα το CRM. Χωρίς UI· αυτή τη φάση την οδηγούν RPC και probes. Το περιβάλλον έρχεται στη Φάση 1β.

**Architecture:** Ο πίνακας `email_campaign_recipients` **είναι** ταυτόχρονα η ουρά και η γραμμή στοιχείων κάθε παραλήπτη. Ένα νέο edge function `send-campaign` τον αδειάζει με δικό του cron, στέλνοντας με το batch API του Resend, μέσα σε ημερήσιο πλαφόν που επιβάλλεται στον server. Κάθε email φεύγει με tags που επιτρέπουν στο υπάρχον webhook να αποδώσει το συμβάν στη σωστή καμπάνια.

**Tech Stack:** Supabase Postgres (migrations, SECURITY DEFINER RPCs, RLS, pg_cron + pg_net), Deno edge functions, Vercel serverless (TypeScript), vitest.

## Global Constraints

- **ΘΕΜΕΛΙΩΔΗΣ ΚΑΝΟΝΑΣ (ιδιοκτήτης, 2026-09-07): μηδενική σχέση με τα αυτόματα email.** Απαγορεύεται να τροποποιηθεί οτιδήποτε από: `supabase/functions/send-email/**` (εκτός του `identities.ts`, βλ. παρακάτω), `email_outbox`, `claim_email_outbox`, `email_log` (πέραν ανάγνωσης), `enqueue_lead_email`, `email_sequences`, `ud_cadences`, `api/unsubscribe.ts`, `leads`, `clients`, `email_templates`, `email_pipeline_health`.
- **Η μόνη επιτρεπτή αλλαγή σε κοινό αρχείο** είναι η προσθήκη μιας ταυτότητας `marketing` στο `supabase/functions/send-email/identities.ts` (καθαρά προσθετική· καμία υπάρχουσα γραμμή δεν αλλάζει) και η επέκταση του `supabase/functions/resend-webhook/` **με νέο κλάδο πριν** τον υπάρχοντα, ο οποίος παραμένει byte-identical ως fallback.
- Migration timestamps: **20260907200000–20260907290000**. Τρέχουν παράλληλα άλλα sessions — δεν βγαίνουμε από το εύρος χωρίς συνεννόηση.
- Νέες συναρτήσεις: `security definer set search_path = public`, μετά `revoke execute ... from public, anon;` και `grant execute ... to authenticated;`.
- Νέοι πίνακες: `enable row level security`, SELECT μόνο για admin μέσω `(select public.current_user_is_admin())` — **πάντα τυλιγμένο σε `(select ...)`** ώστε να αποτιμάται μία φορά ανά statement και όχι ανά γραμμή (μετρημένη διαφορά 12,7s → 0,6s σε αυτό το repo). Καμία policy για INSERT/UPDATE/DELETE: όλες οι εγγραφές μέσω SECDEF RPC.
- Κάθε κείμενο που βλέπει παραλήπτης είναι στα ελληνικά.
- **Κάθε καμπάνια φέρει λινκ απεγγραφής και headers `List-Unsubscribe` + `List-Unsubscribe-Post`.** Απόφαση ιδιοκτήτη: μόνο στις καμπάνιες, ποτέ στα αυτόματα.
- Η απεγγραφή καμπάνιας γράφει **μόνο** στο `email_suppressions` (μέσω `suppress_email`) και στη γραμμή του παραλήπτη. **Ποτέ** στο `leads.email_opt_out`.

## Τι υπάρχει ήδη και χρησιμοποιούμε

| Πόρος | Πού | Χρήση |
|---|---|---|
| `email_suppressions`, `suppress_email(email, reason, source)` | `20260907100000` (εφαρμοσμένο) | Λίστα «μην στέλνεις», 450 διευθύνσεις |
| `claim_email_outbox` | `20260625150000_email_drain_claim_infra.sql:26-42` | **Πρότυπο** για το `claim_campaign_recipients` (`for update skip locked`) |
| `recover_stale_email_claims` | ίδιο αρχείο, `:48-70` | Πρότυπο για την ανάκτηση κολλημένων |
| cron + `pg_net` + Vault | `20260602000002_email_drain_cron.sql:1-24` | Πρότυπο για το `drain_campaign_sends` |
| `announcementCard(heroRowHtml, raw)` | `supabase/functions/send-email/templates.ts:64` | Η διάταξη του email — **δεν** γράφουμε νέα |
| `renderEmailMarkup` | `supabase/functions/_shared/emailMarkup.ts` | Τρέχει και σε Deno και σε Vite → ίδια προεπισκόπηση με το σταλμένο |
| `verifyWebhookSignature`, `statusForResendEvent` | `supabase/functions/resend-webhook/verify.ts` | Η υπογραφή μένει ως έχει· το mapping αποκτά νέο αδελφό |
| `current_user_is_admin()` | `20260502000001_profiles_groups.sql:99` | Ο έλεγχος admin |

---

## File Structure

| Αρχείο | Ευθύνη |
|---|---|
| `supabase/migrations/20260907200000_campaign_tables.sql` (create) | Οι έξι πίνακες + ρυθμίσεις + RLS |
| `supabase/migrations/20260907210000_campaign_recipients_build.sql` (create) | `build_campaign_recipients` + `campaign_segment_emails` |
| `supabase/migrations/20260907220000_campaign_queue_ops.sql` (create) | claim/launch/pause/resume/cancel/stats + heartbeat + cron |
| `api/campaign-unsubscribe.ts` (create) | Δημόσιο endpoint απεγγραφής **μόνο** για καμπάνιες |
| `api/campaign-unsubscribe.test.ts` (create) | Tests επικύρωσης |
| `supabase/functions/send-campaign/index.ts` (create) | Ο αποστολέας: πλαφόν, batch, tags, headers |
| `supabase/functions/send-campaign/render.ts` (create) | Απόδοση HTML ανά παραλήπτη (καθαρή, testable) |
| `supabase/functions/send-campaign/render.test.ts` (create) | Tests απόδοσης |
| `supabase/functions/send-email/identities.ts` (modify) | **Μόνο** προσθήκη `marketing` |
| `supabase/functions/resend-webhook/verify.ts` (modify) | Νέα καθαρή συνάρτηση `campaignEventFor` δίπλα στην υπάρχουσα |
| `supabase/functions/resend-webhook/index.ts` (modify) | Νέος κλάδος καμπάνιας **πριν** τον υπάρχοντα |
| `supabase/config.toml` (modify) | Δήλωση `send-campaign` με `verify_jwt = false` |

---

### Task 1: Οι πίνακες των καμπανιών

**Files:** Create `supabase/migrations/20260907200000_campaign_tables.sql`

**Interfaces — Produces:** πίνακες `email_campaigns`, `email_audiences`, `email_audience_members`, `email_campaign_audiences`, `email_campaign_recipients`, `email_marketing_settings`, `email_campaign_heartbeat`.

- [ ] **Step 1: Γράψε το migration**

```sql
-- =============================================================================
-- 20260907200000_campaign_tables.sql
-- Το σχήμα των καμπανιών marketing. Εντελώς ξεχωριστό από την υποδομή των
-- αυτόματων email (email_outbox / email_log / send-email): άλλη ουρά, άλλος
-- ρυθμός, άλλο cron. Αυτό είναι ρητή απόφαση του ιδιοκτήτη (2026-09-07) και
-- ταυτόχρονα τεχνική ανάγκη — το email_outbox είναι FIFO 50 γραμμές/2΄ και
-- 10.000 γραμμές καμπάνιας θα καθυστερούσαν ένα τιμολόγιο ~6,7 ώρες, ενώ το
-- email_pipeline_health() θα έδειχνε μόνιμα "degraded".
-- =============================================================================

create table public.email_campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  status            text not null default 'draft'
                    check (status in ('draft','ready','scheduled','sending','paused','sent','cancelled')),
  identity          text not null default 'marketing',
  subject           text not null default '',
  preheader         text,
  body_md           text not null default '',
  hero_image_url    text,
  reply_to          text not null default 'sales@itdev.gr',
  segment           jsonb not null default '{}'::jsonb,
  daily_cap         int,
  hourly_cap        int,
  send_window_start time not null default '09:00',
  send_window_end   time not null default '18:00',
  send_days         int[] not null default '{1,2,3,4,5}',
  scheduled_at      timestamptz,
  prepared_at       timestamptz,
  started_at        timestamptz,
  finished_at       timestamptz,
  autopause_reason  text,
  created_by        uuid references public.profiles(user_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.email_campaigns is 'Μία καμπάνια marketing. Δεν σχετίζεται με τα αυτόματα email.';

create table public.email_audiences (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default 'import' check (kind in ('import','segment','manual')),
  source_file   text,
  -- Υποχρεωτικό: χωρίς καταγεγραμμένη βάση συναίνεσης δεν στέλνουμε σε
  -- εισαγόμενη λίστα. Η ερώτηση πρέπει να τίθεται τη στιγμή της εισαγωγής.
  consent_basis text not null
                check (consent_basis in ('existing_customer','inquiry','public_b2b','purchased','other')),
  source_note   text,
  row_count     int not null default 0,
  created_by    uuid references public.profiles(user_id),
  created_at    timestamptz not null default now()
);

create table public.email_audience_members (
  id           uuid primary key default gen_random_uuid(),
  audience_id  uuid not null references public.email_audiences(id) on delete cascade,
  email_lower  text not null,
  display_name text,
  company      text,
  extra        jsonb not null default '{}'::jsonb,
  source_row   int,
  created_at   timestamptz not null default now(),
  unique (audience_id, email_lower)
);

create table public.email_campaign_audiences (
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  audience_id uuid not null references public.email_audiences(id) on delete restrict,
  primary key (campaign_id, audience_id)
);

create table public.email_campaign_recipients (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.email_campaigns(id) on delete cascade,
  email_lower        text not null,
  display_name       text,
  company            text,
  lead_id            uuid references public.leads(id) on delete set null,
  client_id          uuid references public.clients(id) on delete set null,
  audience_id        uuid references public.email_audiences(id) on delete set null,
  status             text not null default 'pending'
                     check (status in ('pending','sending','sent','failed','suppressed')),
  suppression_reason text,
  unsubscribe_token  uuid not null default gen_random_uuid(),
  resend_id          text,
  attempts           int not null default 0,
  claimed_at         timestamptz,
  error              text,
  queued_at          timestamptz not null default now(),
  sent_at            timestamptz,
  delivered_at       timestamptz,
  bounced_at         timestamptz,
  bounce_type        text,
  complained_at      timestamptz,
  unsubscribed_at    timestamptz,
  open_count         int not null default 0,
  click_count        int not null default 0,
  first_opened_at    timestamptz,
  first_clicked_at   timestamptz,
  replied_at         timestamptz,
  unique (campaign_id, email_lower)
);
comment on table public.email_campaign_recipients is
  'Είναι ταυτόχρονα η ουρά αποστολής και η γραμμή στοιχείων του κάθε παραλήπτη.';

create index email_campaign_recipients_claim
  on public.email_campaign_recipients (campaign_id, queued_at)
  where status = 'pending';
create index email_campaign_recipients_resend
  on public.email_campaign_recipients (resend_id) where resend_id is not null;
create index email_campaign_recipients_stats
  on public.email_campaign_recipients (campaign_id, status);
create index email_campaign_recipients_reply
  on public.email_campaign_recipients (email_lower, sent_at) where sent_at is not null;

-- Singleton ρυθμίσεων. Το `id boolean primary key check (id)` επιτρέπει
-- ακριβώς μία γραμμή.
create table public.email_marketing_settings (
  id                 boolean primary key default true check (id),
  paused             boolean not null default false,
  daily_cap          int not null default 500,
  hourly_cap         int not null default 200,
  batch_slice        int not null default 300,
  warmup_started_on  date,
  warmup_ladder      int[] not null default '{500,1000,2000,3000,5000,7500,10000}',
  max_bounce_rate    numeric not null default 0.04,
  max_complaint_rate numeric not null default 0.0008,
  fatigue_days       int not null default 30,
  updated_at         timestamptz not null default now()
);
insert into public.email_marketing_settings (id) values (true) on conflict do nothing;

create table public.email_campaign_heartbeat (
  id         boolean primary key default true check (id),
  ran_at     timestamptz not null default now(),
  sent_count int not null default 0,
  note       text
);
insert into public.email_campaign_heartbeat (id) values (true) on conflict do nothing;

-- --- RLS: ανάγνωση μόνο από admin, καμία εγγραφή από client -------------------
do $$
declare t text;
begin
  foreach t in array array['email_campaigns','email_audiences','email_audience_members',
                           'email_campaign_audiences','email_campaign_recipients',
                           'email_marketing_settings','email_campaign_heartbeat']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_is_admin()))',
      t || '_select', t);
  end loop;
end $$;

-- ROLLBACK: drop table (με τη σειρά) email_campaign_recipients, email_campaign_audiences,
--   email_audience_members, email_audiences, email_campaigns,
--   email_marketing_settings, email_campaign_heartbeat;
```

- [ ] **Step 2: Έλεγχοι**

```bash
grep -c "enable row level security" supabase/migrations/20260907200000_campaign_tables.sql   # 0 (μέσα σε do-block)
grep -c "for select to authenticated" supabase/migrations/20260907200000_campaign_tables.sql # 1 (μέσα σε format)
grep -cE "alter table public\.(leads|clients|email_log|email_outbox)" supabase/migrations/20260907200000_campaign_tables.sql  # ΠΡΕΠΕΙ 0
```

Ο τρίτος έλεγχος είναι ο σημαντικός: **καμία αλλαγή σε υπάρχοντα πίνακα**. Αν δεν βγει `0`, σταμάτα.

- [ ] **Step 3: Commit** — `feat(marketing): campaign schema, isolated from the transactional email tables`

---

### Task 2: Επιλογή και καθαρισμός παραληπτών

**Files:** Create `supabase/migrations/20260907210000_campaign_recipients_build.sql`

**Interfaces — Produces:**
- `public.campaign_segment_emails(p_segment jsonb) returns table (email_lower text, display_name text, company text, lead_id uuid, client_id uuid)` — κλειστό λεξιλόγιο, **ποτέ dynamic SQL από είσοδο χρήστη**.
- `public.build_campaign_recipients(p_campaign_id uuid) returns jsonb` — `{"ok":true,"built":n,"suppressed":n,"by_reason":{...}}`

**Consumes:** `email_suppressions`, `suppress_email` (Φάση 0).

- [ ] **Step 1: Γράψε το migration**

Απαιτήσεις που πρέπει να ικανοποιεί ο κώδικας — γράψε SQL που τις κάνει ακριβώς αυτές:

1. Επιτρέπεται μόνο όταν `status = 'draft'`· αλλιώς `{"ok":false,"errors":["not_draft"]}`. Δικαίωμα: `current_user_is_admin()`.
2. Καθαρίζει προηγούμενες γραμμές της ίδιας καμπάνιας (`delete ... where campaign_id = p_campaign_id`) ώστε να είναι επαναλήψιμο.
3. Μαζεύει από (α) `email_audience_members` όλων των συνδεδεμένων λιστών, (β) `campaign_segment_emails(c.segment)` αν το segment δεν είναι `{}`.
4. Κανονικοποίηση: `lower(btrim(email))`, αφαίρεση προθέματος `mailto:`, κράτημα του πρώτου κομματιού πριν από `;` ή `,`.
5. Αντιστοίχιση με `leads` και `clients` μέσω `lower(email)` — δημιούργησε πρώτα τα functional indexes:
   ```sql
   create index if not exists leads_email_lower on public.leads (lower(email));
   create index if not exists clients_email_lower on public.clients (lower(email));
   ```
   (Indexes μόνο· **καμία** αλλαγή στηλών σε αυτούς τους πίνακες.)
6. Αποδιπλασιασμός με `distinct on (email_lower)` και σειρά προτεραιότητας **πελάτης > lead > μόνο-λίστα**.
7. Γράφει **όλες** τις γραμμές, και τις αποκλεισμένες, με `status='suppressed'` και `suppression_reason` ένα από:
   `invalid` (αποτυγχάνει το `^[^@\s]+@[^@\s]+\.[^@\s]+$`), `suppressed_list` (υπάρχει στο `email_suppressions`), `opted_out` (`leads.email_opt_out`), `closed_client` (`clients.status='done'` ή `clients.archived`), `internal` (τομέας `itdev.gr` ή local part `noreply|no-reply|postmaster|abuse|mailer-daemon`), `fatigue` (έλαβε καμπάνια μέσα στις `fatigue_days` — έλεγχος σε `email_campaign_recipients` άλλης καμπάνιας με `sent_at > now() - interval`).
8. Στο τέλος `update email_campaigns set prepared_at = now(), status = 'ready'`.
9. Επιστρέφει σύνοψη με πλήθος ανά λόγο αποκλεισμού.

Για το `campaign_segment_emails`, Φάση 1α υποστηρίζει **μόνο** δύο κλειδιά, και τίποτα άλλο δεν γίνεται δεκτό:
```
{"leads":  {"stage_codes": ["..."], "sources": ["..."], "exclude_converted": true}}
{"clients":{"statuses": ["active","new"]}}
```
Άγνωστο κλειδί → αγνοείται σιωπηλά (δεν διευρύνει ποτέ το κοινό).

- [ ] **Step 2: Έλεγχος** — `grep -cE "execute .*p_segment" <file>` πρέπει να είναι `0`: το segment **δεν** μπαίνει ποτέ σε dynamic SQL.
- [ ] **Step 3: Commit** — `feat(marketing): recipient resolution with dedupe and suppression`

---

### Task 3: Ουρά, έλεγχος κύκλου ζωής, στατιστικά, cron

**Files:** Create `supabase/migrations/20260907220000_campaign_queue_ops.sql`

**Interfaces — Produces:**
- `claim_campaign_recipients(p_campaign_id uuid, p_limit int) returns setof email_campaign_recipients` — μοτίβο `for update skip locked`, `status→'sending'`, `attempts+1`, `claimed_at=now()`, μόνο `attempts < 3`.
- `recover_stale_campaign_claims(p_older_than interval default '30 minutes')` — γυρίζει κολλημένα `sending` σε `pending`. **30΄ και όχι 5΄** όπως τα transactional: με batch αποστολή, πρόωρη επαναφορά σημαίνει ότι ξαναστέλνουμε έως 100 άτομα.
- `campaign_launch(p_campaign_id)` / `campaign_pause` / `campaign_resume` / `campaign_cancel` — admin-only, με ελέγχους μετάβασης· το `launch` απαιτεί `prepared_at is not null`, τουλάχιστον έναν παραλήπτη σε `pending` και μη κενά `subject`/`body_md`.
- `campaign_stats(p_campaign_id) returns jsonb` — πλήθη ανά στάδιο και ανά λόγο αποκλεισμού.
- `campaign_daily_budget(p_campaign_id) returns int` — πόσα επιτρέπεται να φύγουν τώρα: σκάλα warm-up ∧ `daily_cap` ∧ `hourly_cap` μείον ό,τι έχει ήδη σταλεί σήμερα/αυτή την ώρα **από όλες τις καμπάνιες**.
- cron `drain_campaign_sends` κάθε λεπτό → `send-campaign` με `{"drain":true}`, ίδιο μοτίβο Vault με το `20260602000002`.
- cron `recover_campaign_claims` κάθε 10 λεπτά.

- [ ] **Step 1** Γράψε το migration. Αντέγραψε τη δομή του `claim_email_outbox` (`20260625150000_email_drain_claim_infra.sql:26-42`) — **μην** εφεύρεις νέο μοτίβο κλειδώματος.
- [ ] **Step 2** Έλεγχος: `grep -c "drain_email_outbox" <file>` → `0` (δεν αγγίζουμε το υπάρχον cron).
- [ ] **Step 3: Commit** — `feat(marketing): campaign queue, lifecycle and pacing`

---

### Task 4: Δημόσιο endpoint απεγγραφής καμπάνιας

**Files:** Create `api/campaign-unsubscribe.ts`, `api/campaign-unsubscribe.test.ts`

**Ξεχωριστό αρχείο, όχι επέκταση του `api/unsubscribe.ts`** — εκείνο εξυπηρετεί τα αυτόματα email των leads και μένει ανέπαφο.

**Interfaces — Produces:** `export function parseCampaignUnsubscribe(query): { recipient: string; token: string } | null`

Συμπεριφορά, αντιγράφοντας το ύφος του `api/unsubscribe.ts`:
- `GET /api/campaign-unsubscribe?r=<uuid>&t=<uuid>` → σελίδα επιβεβαίωσης, **καμία μεταβολή** (οι mail scanners ανοίγουν αυτόματα τα λινκ).
- `POST` (από τη φόρμα) → βρίσκει τη γραμμή με `id = r and unsubscribe_token = t`, θέτει `unsubscribed_at = now()`, και καλεί `suppress_email(email_lower, 'unsubscribed', 'campaign:<campaign_id>')`.
- **Ποτέ** δεν αγγίζει `leads` ή `clients`.
- Άκυρο/άγνωστο → η ίδια γενική σελίδα σφάλματος, χωρίς να αποκαλύπτεται αν υπάρχει η γραμμή.
- Ελληνικά κείμενα· ίδιο οπτικό ύφος με το υπάρχον endpoint.

Tests: έγκυρο ζεύγος, μη-UUID, λείπει παράμετρος, πίνακας τιμών στο query string.

- [ ] **Steps**: failing test → υλοποίηση → `npx vitest run api/campaign-unsubscribe.test.ts` → `npx tsc --noEmit` → commit `feat(marketing): campaign-only unsubscribe endpoint`

---

### Task 5: Ο αποστολέας

**Files:** Create `supabase/functions/send-campaign/index.ts`, `render.ts`, `render.test.ts`; modify `supabase/functions/send-email/identities.ts` (**μόνο προσθήκη**) και `supabase/config.toml`.

**Interfaces — Produces (render.ts, καθαρές συναρτήσεις):**
- `renderCampaignEmail(args: { bodyMd: string; heroImageUrl: string | null; displayName: string | null; unsubscribeUrl: string }): { html: string; text: string }`
- `campaignTags(campaignId: string, recipientId: string): { name: string; value: string }[]`
- `unsubscribeHeaders(unsubscribeUrl: string): Record<string, string>` → `List-Unsubscribe: <url>` και `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

Στο `identities.ts` προστίθεται **μόνο**:
```ts
marketing: { from: 'IT DEV <news@itdev.gr>', replyTo: 'sales@itdev.gr' },
```
και το `'marketing'` στο union `Identity`. Καμία υπάρχουσα γραμμή δεν αλλάζει. Το reply-to **πρέπει** να είναι συγχρονισμένο κουτί, αλλιώς οι απαντήσεις δεν θα εντοπίζονται στη Φάση 2.

`index.ts` — αυθεντικοποίηση με νέο μυστικό `CAMPAIGN_DRAIN_SECRET` (**όχι** επαναχρησιμοποίηση του `EMAIL_DRAIN_SECRET`: πρέπει να μπορούμε να κόψουμε τις καμπάνιες χωρίς να πέσουν τα transactional), ίδιο `timingSafeEqual` μοτίβο. Λειτουργίες: `{drain:true}`, `{campaignId, test:true, to}`.

Αλγόριθμος του `drain()`:
1. Αν `email_marketing_settings.paused` → έξοδος.
2. Διάλεξε μία καμπάνια `status='sending'`, εντός `send_window` (ώρα Αθήνας) και `send_days`.
3. `slice = min(campaign_daily_budget(id), batch_slice)`. Αν `<= 0` → ήσυχη έξοδος (όχι σφάλμα στο heartbeat).
4. `claim_campaign_recipients(id, slice)`.
5. Κομμάτιασε ανά **100** → `POST https://api.resend.com/emails/batch` με header `Idempotency-Key: <campaign_id>:<sha των ids>`. Κάθε στοιχείο: `from`/`reply_to` από την ταυτότητα, `subject`, `html`, `text`, `tags`, `headers` (τα δύο List-Unsubscribe). Αντιστοίχισε `data[i].id → resend_id`, `status='sent'`, `sent_at=now()`.
6. Σε μη-2xx: **όλη** η ομάδα επιστρέφει σε `pending` με `error`. Σε `429` σταμάτα αμέσως την εκτέλεση.
7. `sleep 250ms` ανάμεσα στις ομάδες (≤4 req/s, αφήνοντας ≥6 στα transactional).
8. Φρένο: αν το bounce rate της καμπάνιας ξεπεράσει το `max_bounce_rate` ή τα παράπονα το `max_complaint_rate` → `status='paused'`, `autopause_reason`.
9. Αν δεν μένουν `pending` → `status='sent'`, `finished_at=now()`.
10. Ενημέρωσε το `email_campaign_heartbeat`.

Tests στο `render.test.ts`: το HTML περιέχει το λινκ απεγγραφής· τα tags έχουν ακριβώς `mkt`/`campaign`/`recipient`· τα headers έχουν και τα δύο κλειδιά· το `{{name}}` αντικαθίσταται και πέφτει σε ουδέτερο χαιρετισμό όταν λείπει.

- [ ] **Steps**: failing tests → υλοποίηση → `npx vitest run supabase/functions/send-campaign` → `npx tsc --noEmit` → commit `feat(marketing): campaign sender with pacing, batching and one-click unsubscribe`

---

### Task 6: Το webhook μαθαίνει τις καμπάνιες

**Files:** Modify `supabase/functions/resend-webhook/verify.ts`, `index.ts`; create/extend `verify.test.ts`

**ΚΡΙΣΙΜΟ:** ο υπάρχων κλάδος (`statusForResendEvent` → ενημέρωση `email_log`) μένει **byte-identical** και εκτελείται ως fallback. Ο νέος κλάδος μπαίνει **πριν** από αυτόν και τρέχει μόνο όταν το συμβάν ανήκει σε καμπάνια.

**Produces (καθαρές, testable):**
- `readTags(data: unknown): Record<string,string>` — δέχεται **και** τις δύο μορφές που έχει χρησιμοποιήσει το Resend: πίνακα `[{name,value}]` και αντικείμενο `{name: value}`.
- `campaignEventFor(eventType: string): { field: string | null; countField?: string } | null` — `email.delivered → delivered_at`, `email.bounced → bounced_at`, `email.complained → complained_at`. Τα `opened`/`clicked` επιστρέφουν `null` **σε αυτή τη φάση** (έρχονται στη Φάση 2).

Στο `index.ts`, μετά την επαλήθευση υπογραφής:
1. `const tags = readTags(evt.data)`. Αν `tags.mkt === '1' && tags.recipient` → ενημέρωσε `email_campaign_recipients` με `id = tags.recipient`: το αντίστοιχο timestamp, και για bounce το `bounce_type` από `evt.data.bounce?.type`. Για μόνιμο bounce ή παράπονο κάλεσε επίσης `suppress_email`.
2. Αλλιώς, αν βρεθεί γραμμή με `resend_id = evt.data.email_id` στο `email_campaign_recipients` → το ίδιο (εφεδρικό μονοπάτι).
3. Αλλιώς → **ακριβώς ο σημερινός κώδικας**, χωρίς καμία αλλαγή.

- [ ] **Steps**: tests για `readTags` και στις δύο μορφές + για το ότι ένα συμβάν χωρίς tags ακολουθεί το παλιό μονοπάτι → υλοποίηση → tests → commit `feat(marketing): webhook attributes campaign events without touching the transactional path`

---

### Task 7: Εφαρμογή και επαλήθευση στην παραγωγή (controller)

Εκτελείται από τον controller με το token του ιδιοκτήτη.

- [ ] Ενημέρωσε τα παράλληλα sessions για το εύρος 202609072xxxxx.
- [ ] Εφάρμοσε τα τρία migrations με τη σειρά· σβήσε το token αμέσως μετά.
- [ ] **Απόδειξη απομόνωσης** — ο σημαντικότερος έλεγχος: με 500 γραμμές δοκιμαστικής καμπάνιας σε `pending`, βάλε μια γραμμή στο `email_outbox` και επιβεβαίωσε ότι φεύγει στον επόμενο κύκλο των 2΄ και ότι το `email_pipeline_health()` παραμένει `ok`.
- [ ] Probe: `build_campaign_recipients` σε δοκιμαστική καμπάνια με λίστα που περιέχει (α) γνωστή bounced διεύθυνση, (β) διπλή εγγραφή, (γ) `noreply@itdev.gr` → πρέπει να γίνουν `suppressed` με τους σωστούς λόγους και να μείνει **μία** γραμμή ανά διεύθυνση.
- [ ] Probe: μη-admin δεν βλέπει καμία γραμμή από κανέναν νέο πίνακα.
- [ ] Deploy του `send-campaign` και δοκιμαστικό send-test **σε δική μας διεύθυνση**, με έλεγχο ότι το email έχει λινκ απεγγραφής και τα δύο headers.
- [ ] **Καμία πραγματική αποστολή σε πελάτη μέχρι να εγκρίνει ο ιδιοκτήτης.**

---

## Verification

1. `npx vitest run` και `npx tsc --noEmit` πράσινα.
2. **Απομόνωση**: `git diff --stat` δεν δείχνει αλλαγές σε `send-email/index.ts`, `send-email/templates.ts`, `api/unsubscribe.ts`, ούτε σε migration που ορίζει `email_outbox`, `enqueue_lead_email` ή `leads`/`clients` στήλες. Οι μόνες επιτρεπτές αλλαγές σε κοινά αρχεία: προσθήκη ταυτότητας στο `identities.ts`, νέος κλάδος στο `resend-webhook`, δήλωση συνάρτησης στο `config.toml`.
3. Το `email_pipeline_health()` παραμένει `ok` με γεμάτη ουρά καμπάνιας.
4. Το ημερήσιο πλαφόν δεν παραβιάζεται ακόμα κι αν ζητηθεί μεγαλύτερο `slice`.
5. Ίδιο `Idempotency-Key` δεν διπλοστέλνει.
6. Απεγγραφή → `unsubscribed_at` **και** εγγραφή στο `email_suppressions`, **χωρίς** αλλαγή στο `leads.email_opt_out`.
7. Συμβάν webhook χωρίς tags ενημερώνει το `email_log` όπως ακριβώς σήμερα.
