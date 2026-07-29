# Franchise Import Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the ClickUp Franchise list import (218 tasks → CRM leads) with budget/region as real lead fields, other info in Sales Note, ClickUp comments on each lead, and `created_at` backdated to the ClickUp creation date — including retrofitting the 59 leads imported 07-29.

**Architecture:** Two code tasks (schema+types, form+CSV export) ship first. Operational tasks then run in the MAIN session with the owner's `sbp_` Management-API token: apply migration, parse the owner's CSV and diff against prod, retrofit the 59, import comments (idempotent, rerunnable), fetch the ~159 missing tasks from the ClickUp API (`pk_` token; fallback MCP after the 07-30 12:15 reset) and insert, then verify. Spec: `docs/superpowers/specs/2026-07-29-franchise-import-completion-design.md`.

**Tech Stack:** SQL migration, React/TS (LeadForm), Python via Bash for one-shot data scripts, Supabase Management API `/database/query` for all prod DML.

## Global Constraints

- NEVER run the full vitest suite (hits PROD). Only targeted files: `npx vitest run <file>`.
- `npm run build` must be green after each code task (stricter than `tsc --noEmit`).
- **GATE before any prod write (Tasks 3+):** owner has confirmed the spec's 4 decisions (data source, SALES INFO=additional_notes, fields on all leads, retrofit the 59). Asked 07-29 while owner AFK — defaults chosen; re-confirm.
- No automated emails may ever go to `source='franchise'` leads (`enqueue_lead_email` guard — verify 0 enqueued after every insert wave).
- Every destructive/bulk prod write gets a backup table (RLS on, zero policies) + rollback SQL documented here.
- All prod SQL via Mgmt API: `curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" -d @payload.json`. Owner rotates the `sbp_` token after the session.
- PostgREST-style bulk inserts need identical keys per object (PGRST102) — the scripts below use SQL `jsonb_array_elements` with explicit column lists instead.
- Commit per task, push directly to `main`. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Scratchpad for artifacts: the session scratchpad dir (`$SP` below); scripts embedded here in full.

---

### Task 1: Schema — `leads.budget` + `leads.region`

**Files:**
- Create: `supabase/migrations/20260729130000_leads_budget_region.sql`
- Modify: `src/types/supabase.ts` (leads Row/Insert/Update — hand-add two fields; do NOT regen the whole file)

**Interfaces:**
- Produces: nullable text columns `leads.budget`, `leads.region`; TS type `leads.Row.budget: string | null`, `leads.Row.region: string | null` (same in Insert/Update as optional).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260729130000_leads_budget_region.sql`:

```sql
-- Franchise leads carry investment budget + region as first-class fields
-- (spec docs/superpowers/specs/2026-07-29-franchise-import-completion-design.md).
-- Plain nullable columns: row-level RLS policies are unaffected.
alter table public.leads
  add column if not exists budget text,
  add column if not exists region text;
```

- [ ] **Step 2: Hand-add the columns to the generated types**

In `src/types/supabase.ts`, inside `leads: { Row: {...} }` add (alphabetical position — after `business_profile_url`):

```ts
          budget: string | null
```

and after `phone_normalized`:

```ts
          region: string | null
```

In the `Insert` and `Update` blocks for `leads`, add the same two as optional: `budget?: string | null` and `region?: string | null` (same alphabetical spots).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: green (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729130000_leads_budget_region.sql src/types/supabase.ts
git commit -m "feat(leads): budget + region columns (franchise fields)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: LeadForm fields + i18n + CSV export

**Files:**
- Modify: `src/features/leads/LeadForm.tsx` (state ~line 78, payload ~line 120, inputs near the notes textareas ~line 177)
- Modify: `src/features/leads/leadsCsv.ts` (+ its test `src/features/leads/leadsCsv.test.ts`)
- Modify: `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json` (`form.budget`, `form.region`)

**Interfaces:**
- Consumes: `leads.budget` / `leads.region` types from Task 1.
- Produces: editable Budget/Region inputs on every lead form; two extra CSV export columns.

- [ ] **Step 1: Write the failing CSV test**

In `src/features/leads/leadsCsv.test.ts`, find the existing header/row assertions and extend the fixture lead with `budget: '30.000€', region: 'Θεσσαλονίκη'`, asserting the new columns appear (match the file's existing style — core matchers only, jest-dom is broken):

```ts
it('exports budget and region columns', () => {
  const rows = leadsToCsvRows([{ ...baseLead, budget: '30.000€', region: 'Θεσσαλονίκη' } as never]);
  expect(rows[0]).toContain('Budget');
  expect(rows[0]).toContain('Region');
  expect(rows[1]).toContain('30.000€');
  expect(rows[1]).toContain('Θεσσαλονίκη');
});
```

(Adapt names to the file's actual exported function — read the test file first; the assertion intent is binding, the helper name is not.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run src/features/leads/leadsCsv.test.ts`

- [ ] **Step 3: Implement**

`leadsCsv.ts`: add `Budget`/`Region` to the header array and `lead.budget ?? ''` / `lead.region ?? ''` to the row builder, in matching positions.

`LeadForm.tsx`: alongside the notes state:

```ts
  const [budget, setBudget] = useState(lead.budget ?? '');
  const [region, setRegion] = useState(lead.region ?? '');
```

in the save payload: `budget: budget.trim() || null, region: region.trim() || null,`; and two labeled `<Input>`s in the same grid section as the other short fields (follow the file's existing Label+Input idiom):

```tsx
            <div>
              <Label htmlFor="budget">{t('form.budget')}</Label>
              <Input id="budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="region">{t('form.region')}</Label>
              <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
```

i18n: en `"budget": "Budget", "region": "Region"`; el `"budget": "Budget", "region": "Περιοχή"` under `form`.

- [ ] **Step 4: Run test + build**

Run: `npx vitest run src/features/leads/leadsCsv.test.ts` → PASS; `npm run build` → green.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/LeadForm.tsx src/features/leads/leadsCsv.ts src/features/leads/leadsCsv.test.ts src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): budget/region on lead form + CSV export

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 (main session, GATE applies): Apply migration + push

- [ ] Push Tasks 1–2 commits to `main`.
- [ ] Apply `20260729130000_leads_budget_region.sql` via Mgmt API (payload = the file's SQL). Verify: `select column_name from information_schema.columns where table_name='leads' and column_name in ('budget','region')` → 2 rows.

---

### Task 4 (main session): Parse CSV + diff against prod

**Produces:** `$SP/franchise_tasks.json` (all 218: id, name, link, created_iso, comments[]), `$SP/missing_ids.json`, a dup report for the owner.

- [ ] **Step 1: Parse the CSV**

```python
import csv, json, datetime, re
SP = '<session scratchpad>'
rows = list(csv.DictReader(open('/Users/marios/Downloads/901518303391w2xasgd.csv')))
def iso(ms): return datetime.datetime.fromtimestamp(int(ms)/1000, datetime.timezone.utc).isoformat()
def parse_cdate(s):  # "5/6/2026, 7:18:09 PM GMT+3" (also GMT+2)
    m = re.match(r'(\d+)/(\d+)/(\d+), (\d+):(\d+):(\d+) (AM|PM) GMT([+-]\d+)', s)
    mo, d, y, h, mi, sec, ap, off = m.groups()
    h = int(h) % 12 + (12 if ap == 'PM' else 0)
    dt = datetime.datetime(int(y), int(mo), int(d), h, int(mi), int(sec),
        tzinfo=datetime.timezone(datetime.timedelta(hours=int(off))))
    return dt.isoformat()
tasks = []
for r in rows:
    cm = json.loads(r['Comments'] or '[]')
    tasks.append({'id': r['Task ID'], 'name': r['Task Name'].strip(), 'link': r['Task Link'],
        'created_iso': iso(r['Date Created']),
        'comments': [{'text': c['text'].strip(), 'by': c['by'], 'date_iso': parse_cdate(c['date'])}
                     for c in cm if c.get('text', '').strip()]})
json.dump(tasks, open(f'{SP}/franchise_tasks.json', 'w'), ensure_ascii=False)
print(len(tasks), 'tasks;', sum(1 for t in tasks if t['comments']), 'with comments')
```

Expected: `218 tasks; 46 with comments` (±0).

- [ ] **Step 2: Diff against prod** — Mgmt API query `select id, source_data->>'id' as cu_id, created_at from public.leads where source='franchise'`; write `$SP/imported_map.json` (cu_id → lead id) and `$SP/missing_ids.json` (218 − imported − the known dup-skip: Πόπη Αρβύθη's task id, recorded in the 07-29 session). Expected: imported=59, missing≈158.
- [ ] **Step 3:** Report counts + the dup list to the owner in the running summary (no DB writes in this task).

---

### Task 5 (main session): Retrofit the 59

**Consumes:** `imported_map.json`. All writes via Mgmt API.

- [ ] **Step 1: Backup**

```sql
create table public.leads_franchise_retrofit_backup_20260729 as
  select id, notes, additional_notes, budget, region, created_at
  from public.leads where source = 'franchise';
alter table public.leads_franchise_retrofit_backup_20260729 enable row level security;
```

- [ ] **Step 2: Dry-run the notes split.** Fetch `id, notes, source_data->>'date_created' as cu_ms` for the 59; in Python split `notes` lines: line starting `Κεφάλαιο επένδυσης` → `budget` (text after `:`), starting `Περιοχή` → `region`, ALL remaining non-empty lines → `additional_notes` (joined `\n`). `created_at` = `cu_ms` (epoch ms → ISO; fallback = CSV `created_iso` by task id). Print 3 full before/after samples and STOP for eyeball check.
- [ ] **Step 3: Apply.** One SQL per batch of 50 via `jsonb_array_elements`:

```sql
update public.leads l set
  budget = r->>'budget', region = r->>'region',
  additional_notes = r->>'additional_notes', notes = null,
  created_at = (r->>'created_at')::timestamptz
from jsonb_array_elements('<json batch>'::jsonb) r
where l.id = (r->>'id')::uuid and l.source = 'franchise';
```

(escape `'` in the JSON payload by doubling; Greek text passes through)

- [ ] **Step 4: Verify** — `select count(*) from leads where source='franchise' and (budget is not null or region is not null)`; `select count(*) ... and created_at::date = current_date` → expect 0 (all backdated); spot-check 3 rows.

**ROLLBACK:**

```sql
update public.leads l set notes = b.notes, additional_notes = b.additional_notes,
  budget = b.budget, region = b.region, created_at = b.created_at
from public.leads_franchise_retrofit_backup_20260729 b where l.id = b.id;
```

---

### Task 6 (main session): Comments import (idempotent — rerun after Task 7)

**Consumes:** `franchise_tasks.json`, `imported_map.json` (refreshed each run).

- [ ] **Step 1: Author map** — `select p.id, u.email from profiles p join auth.users u on u.id = p.id` via Mgmt API (adapt if profiles carries email directly — check first with `select column_name from information_schema.columns where table_name='profiles'`). Fallback author = the admin profile (info@itdev.gr); unmatched `by` → fallback id + body prefix `[ClickUp: <by>] `.
- [ ] **Step 2: Insert** — for every task with comments whose lead exists, batch:

```sql
insert into public.comments (parent_type, parent_id, author_id, body, created_at)
select 'lead', (r->>'parent_id')::uuid, (r->>'author_id')::uuid, r->>'body', (r->>'created_at')::timestamptz
from jsonb_array_elements('<json batch>'::jsonb) r
where not exists (
  select 1 from public.comments c
  where c.parent_type = 'lead' and c.parent_id = (r->>'parent_id')::uuid
    and c.body = r->>'body' and c.created_at = (r->>'created_at')::timestamptz);
```

- [ ] **Step 3: Verify** — inserted count vs CSV comment count for present leads; open 1 lead in the UI (owner or screenshot later) — author name + backdated time render.

---

### Task 7 (main session, blocked on `pk_` token or MCP reset 07-30 ~12:15): Fetch + insert the ~159

- [ ] **Step 1: Fetch.** With `pk_` token:
`GET https://api.clickup.com/api/v2/list/901522219546/task?include_closed=true&subtasks=false&page=N` (N=0,1,2; header `Authorization: <pk_>`) → all tasks WITH `custom_fields`. Keep only ids in `missing_ids.json`. (MCP fallback: memory `franchise-clickup-import` recipe — batch `clickup_get_task` via haiku subagents, write incrementally every ~10.)
- [ ] **Step 2: Transform** (same recipe as 07-29 + new fields). Per task:
  - email: custom field named `Email` (else regex `[^@\s]+@[^@\s]+\.[^@\s]+` over fields; fallback Phone 2 / task-name-as-email per the 07-29 recipe)
  - phone: first of `Phone`/`Phone 2`/`Secondary Phone` values with ≥10 digits
  - `budget` ← field `Κεφάλαιο επένδυσης`; `region` ← field `Περιοχή` (dropdowns: resolve option name via `type_config.options` by `orderindex`/id; replace `_` with space)
  - `additional_notes` ← lines `Πότε θέλει να ξεκινήσει: …`, `Εμπειρία: …`, `ClickUp: <link>`
  - `notes` = null; `created_at` = task `date_created` (ms); stage: `Franchise Status` → stage_id map derived from the 59 in prod (`select distinct source_data->'status'->>'status', stage_id …` — adapt to the actual raw shape; unmapped/absent → the new_lead stage id observed on the 59); `source='franchise'`; `owner_user_id` null; `source_data` = full raw task JSON. Log any custom-field name not in the known list — do not silently drop.
- [ ] **Step 3: Dedupe check** — against `leads.email` / `leads.phone_normalized` (normalize: digits only, keep last 10) over ALL leads. Matches → `$SP/franchise_dup_report.json`, EXCLUDED from insert, reported to owner.
- [ ] **Step 4: Insert** batches of 50 via `jsonb_array_elements` with explicit column list `(title, email, phone, budget, region, additional_notes, notes, created_at, stage_id, source, source_data, owner_user_id)`; then rerun Task 6 for the new leads' comments.
- [ ] **Step 5: Guard check** — `select count(*) from email_outbox o join leads l on l.email = o.to_email where l.source='franchise'` → 0 new rows since import start.

**ROLLBACK (inserted wave):** `delete from public.leads where source='franchise' and id not in (select id from public.leads_franchise_retrofit_backup_20260729);` (backup table holds exactly the pre-existing 59) + `delete from public.comments where parent_type='lead' and parent_id in (<that same set>)` for their comments.

---

### Task 8 (main session): Final verify + memory

- [ ] Franchise lead count = 218 − dup-skips (Πόπη + Task 7 report); 0 with `created_at::date = current_date`; stage distribution eyeballed vs ClickUp statuses; budget/region fill-rate reported.
- [ ] Spot-check 3 leads end-to-end in prod data (fields split correctly, comments attributed + backdated).
- [ ] Update memory `franchise-clickup-import` (complete; final counts; backup table names) + `MEMORY.md` hook line; append ledger entries per task.
- [ ] Remind owner: rotate the `sbp_` token (and revoke the `pk_` token if one was shared).
