# Income/Expenses Full-Scale Audit & Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify end-to-end that every income (deal_payments) and expense mutation lands correctly in the Expenses page, the Report (`/accounting/report`), the P&L views and the Dashboard — on live prod data — and fix the defects found.

**Architecture:** Three phases. (1) Read-only data audit against prod via PostgREST (admin test login) — invariants, ledger reconciliation, RLS/security behavior. (2) Live E2E harness on prod using ONLY rows labeled `AUDIT-TEST` with guaranteed cleanup, plus UI staleness observation on a local dev server (which talks to prod Supabase). (3) Fixes: a shared financial-invalidation helper wired into all income/expense mutations, realtime refresh for the Report/Dashboard, and two token-gated DDL migrations.

**Tech Stack:** React 18 + @tanstack/react-query + supabase-js, Supabase (PostgREST/RLS/pg_cron), vitest (mocked supabase), python3 stdlib for REST harness scripts.

## Global Constraints

- **Prod is live.** Phase-1 tasks are strictly read-only. Phase-2 tasks may write ONLY rows whose `vendor`/`label`/`title` starts with `AUDIT-TEST`; every such task ends with verified cleanup (re-query returns 0 rows) and logs rollback statements to the scratchpad.
- Never modify real client/deal/expense rows. The only pre-existing rows that may be touched are the archived `DEMO-QA` deals (payments added there are deleted in the same task).
- **Cash-basis is intentional** (`accounting_ledger_v` files by `coalesce(paid_at::date, start_date)`). Do NOT "fix" attribution to period months — owner decision 2026-07-17.
- Fix tasks are implemented by an **opus implementer subagent** (standing model-split rule); this session plans and reviews. Commit per task, push directly to `main` (no PRs). Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never run the full vitest suite (some suites hit prod). Run only the test files named in each task. `npm run build` before every push.
- Admin REST login: `info@itdev.gr` / pw in memory (test account). Sales-role login for RLS checks: `testsales@itdev.gr` (same pw). Anon key comes from `.env.local` — never print keys/JWTs.
- DDL cannot be applied from this environment (no sbp_ token on disk). Task 10 produces migration files + asks the owner to supply a token or apply via the Supabase dashboard; it must NOT silently skip verification.
- Scratchpad for artifacts: `/private/tmp/claude-501/-Users-marios-Desktop-Cursor-itdevcrm/aadbe14c-a5b8-4cd9-b6b5-e971c56ec4cf/scratchpad/audit/`.

**Known suspects from the static map (verify, don't assume):**
- S1 `useUpdateDealPayment`/`useAddDealPayment`/`useDeleteDealPayment` (`src/features/deals/hooks/useDealPayments.ts`) and `useMarkPaidInFull`/`useCompleteAccounting` (`src/features/accounting/hooks/`) never invalidate `['accounting-ledger']`, `['accounting-pl-summary']`, `['accounting-mrr']`, `['dashboard-monthly-pl']`, `['dashboard-recurring-collected']` → stale income Report.
- S2 Dashboard reads private `dashboard-*` keys that nothing invalidates and mounts no realtime.
- S3 `20260717120000_revert_ledger_collection_month.sql` recreated `accounting_ledger_v` possibly WITHOUT `security_invoker=true` → non-admin roles may read all financials through the view.
- S4 `expenses` table may be missing from the `supabase_realtime` publication → `useExpensesRealtime` receives nothing.
- S5 Only 4/63 expenses are `paid` (all autopay); Report's expense arm counts `status='paid'` only → owner may believe expenses are reported while 56 pending rows are invisible. Product question, not auto-fixed.

---

### Task 1: REST harness helper + read-only expense invariants

**Files:**
- Create: `<scratchpad>/audit/rest.py`
- Create: `<scratchpad>/audit/t1_expense_invariants.py`

**Interfaces:**
- Produces: `rest.py` exposing `login(email='info@itdev.gr') -> token`, `req(path, method='GET', body=None, token=None)`, `fetch_all(path_base, token)` (1000-row paging). All later tasks import these.

- [ ] **Step 1: Write the shared REST helper**

```python
# <scratchpad>/audit/rest.py
import json, urllib.request

ENV = {}
for line in open('/Users/marios/Desktop/Cursor/itdevcrm/.env.local'):
    if '=' in line and not line.startswith('#'):
        k, v = line.strip().split('=', 1); ENV[k] = v.strip().strip('"')
URL = ENV['VITE_SUPABASE_URL'].rstrip('/')
ANON = ENV.get('VITE_SUPABASE_ANON_KEY') or ENV.get('VITE_SUPABASE_PUBLISHABLE_KEY')

def req(path, method='GET', body=None, token=None, extra=None):
    h = {'apikey': ANON, 'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    if extra: h.update(extra)
    r = urllib.request.Request(URL + path, method=method,
                               data=json.dumps(body).encode() if body is not None else None, headers=h)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode() or 'null')

def login(email='info@itdev.gr', password='123456789'):
    return req('/auth/v1/token?grant_type=password', 'POST',
               {'email': email, 'password': password})['access_token']

def fetch_all(base, token):
    out, off = [], 0
    while True:
        rows = req(f'{base}&limit=1000&offset={off}', token=token)
        out.extend(rows)
        if len(rows) < 1000: return out
        off += 1000
```

- [ ] **Step 2: Write the expense-invariant script**

```python
# <scratchpad>/audit/t1_expense_invariants.py
import json, collections, datetime
from rest import login, fetch_all, req

tok = login()
rows = fetch_all('/rest/v1/expenses?select=*&order=created_at', tok)
cats = {c['id']: c for c in req('/rest/v1/expense_categories?select=id,key,archived', token=tok)}
F = {}  # findings

def f(x): return float(x or 0)
bad = lambda name, items: F.__setitem__(name, items)

# I1 generated-column arithmetic (vat/gross vs net*rate)
bad('vat_arith', [r['id'] for r in rows
    if abs(round(f(r['amount_net']) * f(r['vat_rate']) / 100, 2) - f(r['vat_amount'])) > 0.011
    or abs(round(f(r['amount_net']) + f(r['amount_net']) * f(r['vat_rate']) / 100, 2) - f(r['amount_gross'])) > 0.011])
# I2 paid rows must have paid_at AND payment_method
bad('paid_missing_fields', [r['id'] for r in rows if r['status'] == 'paid'
    and (not r['paid_at'] or not r['payment_method'])])
# I3 pending rows must NOT have paid_at
bad('pending_with_paid_at', [r['id'] for r in rows if r['status'] == 'pending' and r['paid_at']])
# I4 recurring rows need start+end dates; one_time needs start_date
bad('recurring_missing_dates', [r['id'] for r in rows
    if r['billing_type'] != 'one_time' and (not r['start_date'] or not r['end_date'])])
# I5 chain integrity: parent_expense_id points to existing row, same chain has no duplicate period start
ids = {r['id'] for r in rows}
bad('orphan_parent', [r['id'] for r in rows if r['parent_expense_id'] and r['parent_expense_id'] not in ids])
chain = collections.defaultdict(list)
for r in rows:
    chain[r['parent_expense_id'] or r['id']].append(r)
bad('dup_period_in_chain', [k for k, v in chain.items()
    if len({x['start_date'] for x in v}) < len(v)])
# I6 autopay chain-level consistency: all rows of a chain share the same autopay flag
bad('autopay_flag_mixed', [k for k, v in chain.items() if len({bool(x['autopay']) for x in v}) > 1])
# I7 autopay-settled rows: paid_at == start_date and paid_by is null (System)
bad('autopay_settle_wrong_stamp', [r['id'] for r in rows if r['autopay'] and r['status'] == 'paid'
    and (str(r['paid_at'])[:10] != str(r['start_date']) or r['paid_by'] is not None)])
# I8 spawner freshness: every autopay/recurring chain whose newest end_date <= today+7 must have a successor or be ended
today = datetime.date.today().isoformat()
horizon = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
stale = []
for k, v in chain.items():
    tip = max(v, key=lambda x: x['start_date'] or '')
    if tip['billing_type'] != 'one_time' and tip['end_date'] and tip['end_date'] <= today:
        stale.append({'chain': k, 'tip_end': tip['end_date']})
bad('spawner_stale_chains', stale)
# I9 category refs valid / not archived
bad('bad_category', [r['id'] for r in rows if r['category_id'] not in cats or cats[r['category_id']]['archived']])
# I10 headline counts for the report
F['counts'] = dict(collections.Counter((r['status'], r['billing_type'], bool(r['autopay'])) for r in rows))
F['total_rows'] = len(rows)

print(json.dumps({k: v for k, v in F.items()}, indent=1, default=str, ensure_ascii=False))
json.dump(F, open(__file__.replace('.py', '.findings.json'), 'w'), default=str)
```

*(If any column name errors 400, list the real columns with `req('/rest/v1/expenses?select=*&limit=1', token=tok)` and adapt — the table is defined in `supabase/migrations/20260601000002_expenses.sql`.)*

- [ ] **Step 3: Run it**

Run: `cd <scratchpad>/audit && python3 t1_expense_invariants.py`
Expected: JSON where every `I*` list is `[]`. Non-empty lists are findings — record them; do NOT fix data in this task.

---

### Task 2: Ledger ⇄ source reconciliation + P&L view cross-check

**Files:**
- Create: `<scratchpad>/audit/t2_ledger_recon.py`

**Interfaces:**
- Consumes: `rest.py` from Task 1.

- [ ] **Step 1: Write the reconciliation script**

```python
# <scratchpad>/audit/t2_ledger_recon.py
import json, collections
from rest import login, fetch_all

tok = login()
led = fetch_all('/rest/v1/accounting_ledger_v?select=direction,period,status,amount_net,amount_gross,source_table,source_id&order=source_id', tok)
pays = fetch_all('/rest/v1/deal_payments?select=id,amount_net,amount_gross,status,paid_at,start_date&order=id', tok)
exps = fetch_all('/rest/v1/expenses?select=id,amount_net,amount_gross,status,paid_at,start_date&order=id', tok)
plv  = fetch_all('/rest/v1/accounting_pl_summary_v?select=*&order=period', tok)

def f(x): return float(x or 0)
def month(r): return (str(r['paid_at'])[:7] if r['paid_at'] else str(r['start_date'])[:7])

# R1 row-level completeness: every deal_payment appears exactly once as direction=in, every expense as out
in_ids  = collections.Counter(r['source_id'] for r in led if r['direction'] == 'in')
out_ids = collections.Counter(r['source_id'] for r in led if r['direction'] == 'out')
print('R1 missing_in :', [p['id'] for p in pays if p['id'] not in in_ids][:10],
      '| dupes:', [i for i, n in in_ids.items() if n > 1][:5])
print('R1 missing_out:', [e['id'] for e in exps if e['id'] not in out_ids][:10],
      '| dupes:', [i for i, n in out_ids.items() if n > 1][:5])

# R2 monthly paid sums: ledger(in,paid) == deal_payments(paid) by collection month; same for expenses
def sums(rows, statuskey='status'):
    d = collections.defaultdict(float)
    for r in rows:
        if r[statuskey] == 'paid': d[month(r)] += f(r['amount_gross'])
    return d
lin = collections.defaultdict(float); lout = collections.defaultdict(float)
for r in led:
    if r['status'] == 'paid':
        (lin if r['direction'] == 'in' else lout)[r['period']] += f(r['amount_gross'])
for name, a, b in [('income', lin, sums(pays)), ('expense', lout, sums(exps))]:
    diff = {m: round(a.get(m, 0) - b.get(m, 0), 2) for m in set(a) | set(b)
            if abs(a.get(m, 0) - b.get(m, 0)) > 0.01}
    print(f'R2 {name} month diffs (ledger - source):', diff or 'NONE')

# R3 P&L view == ledger aggregation per month (gross income/expense/profit)
lv = {p['period']: p for p in plv}
r3 = {}
for m in set(lin) | set(lout) | set(lv):
    v = lv.get(m, {})
    exp_led, inc_led = round(lout.get(m, 0), 2), round(lin.get(m, 0), 2)
    if abs(f(v.get('total_income_gross')) - inc_led) > 0.01 or abs(f(v.get('total_expense_gross')) - exp_led) > 0.01:
        r3[m] = {'view_in': f(v.get('total_income_gross')), 'led_in': inc_led,
                 'view_out': f(v.get('total_expense_gross')), 'led_out': exp_led}
print('R3 PL-view vs ledger diffs:', json.dumps(r3) if r3 else 'NONE')

# R4 archived/test pollution: DEMO-QA (archived) payments present in ledger?
demo = fetch_all("/rest/v1/deals?select=id,code,title,archived&title=like.DEMO-QA*", tok)
if demo:
    ids = {d['id'] for d in demo}
    dp = fetch_all(f"/rest/v1/deal_payments?select=id,deal_id&deal_id=in.({','.join(ids)})", tok)
    polluting = [p['id'] for p in dp if p['id'] in in_ids]
    print('R4 archived DEMO-QA payment rows visible in ledger:', polluting or 'NONE',
          '(ledger has no archived filter — any non-empty result is a finding)')
else:
    print('R4 no DEMO-QA deals found')
```

- [ ] **Step 2: Run it**

Run: `cd <scratchpad>/audit && python3 t2_ledger_recon.py`
Expected: `R1` missing/dupes empty, `R2` diffs NONE, `R3` NONE. `R4` documents whether the ledger view filters archived deals (it does not, per the view SQL in `20260717120000_revert_ledger_collection_month.sql` — confirm empirically and record as finding if DEMO-QA rows appear).

---

### Task 3: RLS / security behavior of the financial views and RPCs

**Files:**
- Create: `<scratchpad>/audit/t3_security.py`

**Interfaces:**
- Consumes: `rest.py`. Sales test account `testsales@itdev.gr` (pw `123456789`).

- [ ] **Step 1: Write the security probe**

```python
# <scratchpad>/audit/t3_security.py
import urllib.error, json
from rest import login, req

adm = login()
sales = login('testsales@itdev.gr')

def probe(label, path, token, expect):
    try:
        r = req(path, token=token)
        n = len(r) if isinstance(r, list) else 'obj'
        print(f'{label}: rows={n}  (expected {expect})', '<<< FINDING' if (n != 0 and expect == '0 rows/denied') else '')
    except urllib.error.HTTPError as e:
        print(f'{label}: HTTP {e.code} (expected {expect})')

# S3 check: security_invoker on accounting_ledger_v.
# If the view runs as INVOKER, testsales (own-leads-only role, no accounting perms)
# must get 0 rows / permission error. Rows > 0 = cross-client financial leak (CRITICAL).
probe('sales -> accounting_ledger_v', '/rest/v1/accounting_ledger_v?select=period,amount_gross&limit=5', sales, '0 rows/denied')
probe('sales -> accounting_pl_summary_v', '/rest/v1/accounting_pl_summary_v?select=*&limit=5', sales, '0 rows/denied')
probe('sales -> expenses', '/rest/v1/expenses?select=id&limit=5', sales, '0 rows/denied')
probe('sales -> deal_payments', '/rest/v1/deal_payments?select=id&limit=5', sales, '0 rows/denied')
probe('admin -> accounting_ledger_v', '/rest/v1/accounting_ledger_v?select=period&limit=1', adm, '>=1 row')

# RPC guards: set_expense_autopay must reject non-admin; run_daily_expenses must not be
# callable by authenticated at all (cron-only).
for who, tokn in [('sales', sales), ('admin-no-side-effect', None)]:
    pass  # run_daily_expenses is checked only for EXPOSURE, never actually run by admin
try:
    req('/rest/v1/rpc/set_expense_autopay', 'POST',
        {'p_expense_id': '00000000-0000-0000-0000-000000000000', 'p_enabled': True}, token=sales)
    print('sales -> set_expense_autopay: SUCCEEDED <<< FINDING (guard missing)')
except urllib.error.HTTPError as e:
    print(f'sales -> set_expense_autopay: HTTP {e.code} body={e.read().decode()[:100]} (403/400 with admin-guard msg = OK)')
try:
    req('/rest/v1/rpc/run_daily_expenses', 'POST', {}, token=sales)
    print('sales -> run_daily_expenses: SUCCEEDED <<< FINDING (cron fn exposed + side effects!)')
except urllib.error.HTTPError as e:
    print(f'sales -> run_daily_expenses: HTTP {e.code} (404/403 = OK, not exposed)')
```

- [ ] **Step 2: Run it**

Run: `cd <scratchpad>/audit && python3 t3_security.py`
Expected: every `sales ->` probe denied/0 rows; admin sees rows. Any `<<< FINDING` line is a security defect: if `accounting_ledger_v` leaks to sales, Task 10's `security_invoker` migration becomes **CRITICAL priority** and the owner is told immediately (do not wait for the final report).

---

### Task 4: Live expense lifecycle E2E (create → edit → mark-paid → report → delete)

**Files:**
- Create: `<scratchpad>/audit/t4_expense_lifecycle.py`

**Interfaces:**
- Consumes: `rest.py`. Writes ONLY rows with `vendor='AUDIT-TEST lifecycle'`.

- [ ] **Step 1: Write the lifecycle harness**

```python
# <scratchpad>/audit/t4_expense_lifecycle.py
import json, datetime, urllib.error
from rest import login, req

tok = login()
today = datetime.date.today().isoformat()
cat = req('/rest/v1/expense_categories?select=id,key&archived=eq.false&limit=1', token=tok)[0]
made = []
try:
    # 1 CREATE one_time pending
    e = req('/rest/v1/expenses?select=id,amount_net,vat_amount,amount_gross,status', 'POST',
            {'vendor': 'AUDIT-TEST lifecycle', 'category_id': cat['id'], 'billing_type': 'one_time',
             'amount_net': 100, 'vat_rate': 24, 'start_date': today, 'status': 'pending'},
            token=tok, extra={'Prefer': 'return=representation'})[0]
    made.append(e['id'])
    assert float(e['vat_amount']) == 24.0 and float(e['amount_gross']) == 124.0, e
    # pending row must NOT appear as paid in ledger
    led = req(f"/rest/v1/accounting_ledger_v?source_id=eq.{e['id']}", token=tok)
    assert len(led) == 1 and led[0]['status'] == 'pending' and led[0]['direction'] == 'out', led
    print('create+ledger(pending) OK')
    # 2 EDIT net 100 -> 150; generated cols + ledger must follow
    req(f"/rest/v1/expenses?id=eq.{e['id']}", 'PATCH', {'amount_net': 150}, token=tok)
    led = req(f"/rest/v1/accounting_ledger_v?source_id=eq.{e['id']}", token=tok)[0]
    assert float(led['amount_net']) == 150 and float(led['amount_gross']) == 186.0, led
    print('edit propagates to ledger OK')
    # 3 MARK PAID (mirrors useMarkExpensePaid payload) -> ledger flips to paid, period = today's month
    req(f"/rest/v1/expenses?id=eq.{e['id']}", 'PATCH',
        {'status': 'paid', 'paid_at': today, 'payment_method': 'bank'}, token=tok)
    led = req(f"/rest/v1/accounting_ledger_v?source_id=eq.{e['id']}", token=tok)[0]
    assert led['status'] == 'paid' and led['period'] == today[:7], led
    # 4 P&L month total moved by exactly +186.00 gross expense
    pl = req(f"/rest/v1/accounting_pl_summary_v?period=eq.{today[:7]}", token=tok)
    print('mark-paid OK; PL row for month exists:', bool(pl))
finally:
    # 5 CLEANUP — unconditional
    for i in made:
        req(f'/rest/v1/expenses?id=eq.{i}', 'DELETE', token=tok)
    left = req("/rest/v1/expenses?select=id&vendor=like.AUDIT-TEST*", token=tok)
    print('cleanup residue (must be []):', left)
    assert left == []
```

- [ ] **Step 2: Snapshot the P&L month BEFORE and AFTER inside the script**

Extend step 3→4 in the script: read `accounting_pl_summary_v?period=eq.<month>` before mark-paid and after, assert `total_expense_gross` delta == `186.00 ± 0.01`. (Add the two reads around the PATCH; keep the assert.)

- [ ] **Step 3: Run it**

Run: `cd <scratchpad>/audit && python3 t4_expense_lifecycle.py`
Expected: all `OK` lines, cleanup residue `[]`. Any assert failure = data-layer bug; capture the JSON and stop this task (do not delete the evidence row until it is documented in the findings file — then clean up).

- [ ] **Step 4: UI staleness observation (dev server against prod)**

Start: `cd /Users/marios/Desktop/Cursor/itdevcrm && npm run dev` (background).
With playwright MCP: navigate `http://localhost:5173`, log in as `info@itdev.gr`/`123456789`, open `/accounting/expenses`; note the summary-bar Gross total. Re-run `t4_expense_lifecycle.py` up to the CREATE step only (comment the rest, keep cleanup disabled temporarily): the new AUDIT-TEST row was inserted from OUTSIDE the app. Expected per S4: the open page does NOT show the new row/total until manual refresh (realtime dead). Reload the page → row visible. Then re-enable cleanup and run it. Record observed behavior (live-update vs refresh-only) in the findings file. Kill the dev server.

---

### Task 5: Autopay chain E2E via `set_expense_autopay`

**Files:**
- Create: `<scratchpad>/audit/t5_autopay.py`

**Interfaces:**
- Consumes: `rest.py`. Writes ONLY `vendor='AUDIT-TEST autopay'` rows.

- [ ] **Step 1: Write the autopay harness**

```python
# <scratchpad>/audit/t5_autopay.py
import datetime, urllib.error, json
from rest import login, req

tok = login()
today = datetime.date.today()
m_start = (today - datetime.timedelta(days=30)).isoformat()
m_end = today.isoformat()
cat = req('/rest/v1/expense_categories?select=id&archived=eq.false&limit=1', token=tok)[0]
made = []
try:
    # recurring chain, period already due (start 30d ago), NO method yet, autopay off
    e = req('/rest/v1/expenses?select=id', 'POST',
            {'vendor': 'AUDIT-TEST autopay', 'category_id': cat['id'],
             'billing_type': 'recurring_monthly', 'amount_net': 10, 'vat_rate': 24,
             'start_date': m_start, 'end_date': m_end, 'status': 'pending'},
            token=tok, extra={'Prefer': 'return=representation'})[0]
    made.append(e['id'])
    # A1 enabling WITHOUT a method on a method-less tip must be rejected
    try:
        req('/rest/v1/rpc/set_expense_autopay', 'POST',
            {'p_expense_id': e['id'], 'p_enabled': True}, token=tok)
        print('A1 enable w/o method accepted <<< FINDING (spec: tip must have method)')
    except urllib.error.HTTPError as err:
        print('A1 enable w/o method rejected OK:', err.read().decode()[:80])
    # A2 enable WITH method -> due pending row settles instantly: paid, paid_at=start_date, paid_by null
    req('/rest/v1/rpc/set_expense_autopay', 'POST',
        {'p_expense_id': e['id'], 'p_enabled': True, 'p_payment_method': 'bank'}, token=tok)
    r = req(f"/rest/v1/expenses?id=eq.{e['id']}&select=status,paid_at,paid_by,autopay,payment_method", token=tok)[0]
    assert r['status'] == 'paid' and str(r['paid_at'])[:10] == m_start and r['paid_by'] is None and r['autopay'], r
    print('A2 instant settle OK (paid_at=start_date, paid_by=System)')
    # A3 ledger files it under the START month (cash basis: paid_at=start_date)
    led = req(f"/rest/v1/accounting_ledger_v?source_id=eq.{e['id']}&select=period,status", token=tok)[0]
    assert led['status'] == 'paid' and led['period'] == m_start[:7], led
    print('A3 ledger period OK:', led['period'])
    # A4 disable never un-pays
    req('/rest/v1/rpc/set_expense_autopay', 'POST',
        {'p_expense_id': e['id'], 'p_enabled': False}, token=tok)
    r = req(f"/rest/v1/expenses?id=eq.{e['id']}&select=status,autopay", token=tok)[0]
    assert r['status'] == 'paid' and not r['autopay'], r
    print('A4 disable keeps paid OK')
finally:
    for i in made:
        req(f'/rest/v1/expenses?id=eq.{i}', 'DELETE', token=tok)
    left = req("/rest/v1/expenses?select=id&vendor=like.AUDIT-TEST*", token=tok)
    print('cleanup residue (must be []):', left)
    assert left == []
```

- [ ] **Step 2: Run it**

Run: `cd <scratchpad>/audit && python3 t5_autopay.py`
Expected: A1 rejected, A2–A4 OK, residue `[]`. Note: the RPC may auto-spawn a successor row for the settled period (spawner window) — if `AUDIT-TEST*` cleanup finds 2 rows, that's the successor; delete both and record that the spawner ran (not a bug).

---

### Task 6: Income staleness repro + archived-deal ledger pollution

**Files:**
- Create: `<scratchpad>/audit/t6_income_staleness.py`

**Interfaces:**
- Consumes: `rest.py`. Writes ONLY a payment labeled `AUDIT-TEST income` on an ARCHIVED `DEMO-QA` deal, deleted at the end.

- [ ] **Step 1: Write the income-side harness**

```python
# <scratchpad>/audit/t6_income_staleness.py
import datetime, json
from rest import login, req

tok = login()
today = datetime.date.today().isoformat()
deal = req("/rest/v1/deals?select=id,code,title&title=like.DEMO-QA*&archived=eq.true&limit=1", token=tok)
assert deal, 'no archived DEMO-QA deal available — STOP and ask the owner before touching anything else'
deal = deal[0]
made = []
try:
    p = req('/rest/v1/deal_payments?select=id', 'POST',
            {'deal_id': deal['id'], 'billing_type': 'one_time', 'label': 'AUDIT-TEST income',
             'amount_net': 1, 'vat_rate': 24, 'start_date': today, 'status': 'pending'},
            token=tok, extra={'Prefer': 'return=representation'})[0]
    made.append(p['id'])
    # (the add-payment line fix d9d0a0f applies to the UI hook, not REST — a line row is NOT expected here)
    # L1 pending payment visible in ledger as pending 'in'
    led = req(f"/rest/v1/accounting_ledger_v?source_id=eq.{p['id']}&select=direction,status,period", token=tok)
    print('L1 ledger row for archived-deal payment:', led,
          '<<< FINDING if non-empty: archived deals pollute the income report')
    # L2 mark paid -> flips in ledger (data layer is instant; the UI gap is what Task 7 fixes)
    req(f"/rest/v1/deal_payments?id=eq.{p['id']}", 'PATCH', {'status': 'paid', 'paid_at': today}, token=tok)
    led = req(f"/rest/v1/accounting_ledger_v?source_id=eq.{p['id']}&select=status,period", token=tok)
    print('L2 after mark-paid:', led)
finally:
    for i in made:
        req(f'/rest/v1/deal_payments?id=eq.{i}', 'DELETE', token=tok)
    print('cleanup residue (must be []):',
          req("/rest/v1/deal_payments?select=id&label=eq.AUDIT-TEST income", token=tok))
```

- [ ] **Step 2: Run it, then UI staleness observation**

Run: `cd <scratchpad>/audit && python3 t6_income_staleness.py`
Then start `npm run dev`, log in as admin with playwright MCP, open `/accounting/report` for the current month, note the Income total. Re-run the script through the mark-paid step (cleanup commented). Expected per S1: the open Report does NOT change (no invalidation, no realtime); a manual reload shows the +1.24 €. Record observed behavior, restore cleanup, run it, kill the dev server.
**Decision point:** L1 non-empty (it will be, per the view SQL) = confirmed finding "ledger includes archived deals" → goes to the owner in the final report with a proposed `where d.archived = false` view change (DDL, Task 10 note) — NOT auto-applied.

---

### Task 7 (FIX): shared financial invalidation helper, wired into income mutations

**Files:**
- Create: `src/lib/financialInvalidations.ts`
- Create: `src/lib/financialInvalidations.test.ts`
- Modify: `src/features/deals/hooks/useDealPayments.ts` (all 3 mutations' `onSuccess`)
- Modify: `src/features/accounting/hooks/useMarkPaidInFull.ts`
- Modify: `src/features/accounting/hooks/useCompleteAccounting.ts`
- Test: extend `src/features/deals/hooks/useDealPayments.test.tsx`

**Interfaces:**
- Produces: `invalidateFinancialReports(qc: QueryClient): void` — invalidates exactly `['accounting-ledger']`, `['accounting-pl-summary']`, `['accounting-mrr']`, `['dashboard-monthly-pl']`, `['dashboard-recurring-collected']` (prefix match, so date-suffixed keys are caught).
- Consumes: existing hooks named above; Task 8 reuses the same helper.

- [ ] **Step 1: Write the failing helper test**

```typescript
// src/lib/financialInvalidations.test.ts
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateFinancialReports, FINANCIAL_REPORT_KEYS } from './financialInvalidations';

describe('invalidateFinancialReports', () => {
  it('invalidates every financial report key exactly once', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateFinancialReports(qc);
    const called = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const key of FINANCIAL_REPORT_KEYS) {
      expect(called).toContain(JSON.stringify(key));
    }
    expect(spy).toHaveBeenCalledTimes(FINANCIAL_REPORT_KEYS.length);
  });
});
```

- [ ] **Step 2: Run it — must fail (module not found)**

Run: `npx vitest run src/lib/financialInvalidations.test.ts`
Expected: FAIL — cannot resolve `./financialInvalidations`.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/financialInvalidations.ts
import type { QueryClient } from '@tanstack/react-query';

// Every surface that renders money aggregated from deal_payments/expenses.
// Mutating either table without invalidating these leaves the Report,
// P&L cards and Dashboard trend stale until a manual reload.
export const FINANCIAL_REPORT_KEYS = [
  ['accounting-ledger'],
  ['accounting-pl-summary'],
  ['accounting-mrr'],
  ['dashboard-monthly-pl'],
  ['dashboard-recurring-collected'],
] as const;

export function invalidateFinancialReports(qc: QueryClient): void {
  for (const queryKey of FINANCIAL_REPORT_KEYS) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
}
```

- [ ] **Step 4: Test green, then wire the income hooks**

Run: `npx vitest run src/lib/financialInvalidations.test.ts` → PASS.
In `src/features/deals/hooks/useDealPayments.ts` add `import { invalidateFinancialReports } from '@/lib/financialInvalidations';` and append `invalidateFinancialReports(qc);` as the last line of the `onSuccess` of `useUpdateDealPayment`, `useAddDealPayment`, `useDeleteDealPayment`. Same one-line addition in the `onSuccess` of `src/features/accounting/hooks/useMarkPaidInFull.ts` and `src/features/accounting/hooks/useCompleteAccounting.ts` (import path identical; both files already receive/construct a `qc` via `useQueryClient()` — reuse it).

- [ ] **Step 5: Extend the payment-hook tests to assert the new invalidations**

In `src/features/deals/hooks/useDealPayments.test.tsx`, inside the existing successful-add test, after `await` of the mutation add:

```typescript
const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
expect(invalidated).toContain(JSON.stringify(['accounting-ledger']));
expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
```

where `invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')` is created on the QueryClient the test already constructs. Mirror the same two assertions in one update-mutation test.

- [ ] **Step 6: Run the touched test files + build**

Run: `npx vitest run src/lib/financialInvalidations.test.ts src/features/deals/hooks/useDealPayments.test.tsx src/features/accounting/hooks/useMarkPaidInFull.test.tsx && npm run build`
Expected: all PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/financialInvalidations.ts src/lib/financialInvalidations.test.ts src/features/deals/hooks/useDealPayments.ts src/features/deals/hooks/useDealPayments.test.tsx src/features/accounting/hooks/useMarkPaidInFull.ts src/features/accounting/hooks/useCompleteAccounting.ts
git commit -m "fix(report): income mutations now refresh ledger/P&L/MRR/dashboard queries"
git push origin main
```

---

### Task 8 (FIX): expense mutations + prepay also refresh the dashboard

**Files:**
- Modify: `src/features/accounting_report/hooks/useCreateExpense.ts`, `useUpdateExpense.ts`, `useDeleteExpense.ts`, `useMarkExpensePaid.ts`, `useSetExpenseAutopay.ts` (replace their hand-rolled ledger/PL invalidation pairs with the helper — keep their `['expenses']`/`['expense',id]` lines)
- Modify: `src/features/deals/PrepayDialog.tsx` (append helper call after its existing invalidations)
- Test: existing hook tests in `src/features/accounting_report/hooks/`

**Interfaces:**
- Consumes: `invalidateFinancialReports(qc)` from Task 7 (exact signature above).

- [ ] **Step 1: Swap in the helper in each expense hook**

In each of the 5 hooks: add the import, and in `onSuccess` replace the two lines invalidating `['accounting-ledger']` and `['accounting-pl-summary']` with `invalidateFinancialReports(qc);` (keep `['expenses']` and `['expense', id]` invalidations as-is). In `PrepayDialog.tsx` add `invalidateFinancialReports(queryClient);` after its existing invalidation block (it already covers ledger/PL — the helper adds MRR-dashboard keys; duplicate invalidation of the same key is harmless).

- [ ] **Step 2: Add one invalidation assertion per hook test**

Each of the 5 hook tests already constructs a QueryClient. Add in the success-path test:

```typescript
const invalidated = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
expect(invalidated).toContain(JSON.stringify(['dashboard-monthly-pl']));
```

(spy as in Task 7 Step 5.)

- [ ] **Step 3: Run tests + build, commit**

Run: `npx vitest run src/features/accounting_report/hooks && npm run build`
Expected: PASS (this directory's tests are all mocked — safe).

```bash
git add src/features/accounting_report/hooks src/features/deals/PrepayDialog.tsx
git commit -m "fix(report): expense mutations refresh dashboard P&L keys via shared helper"
git push origin main
```

---

### Task 9 (FIX): Report/Dashboard live-refresh on deal_payments changes

**Files:**
- Create: `src/features/accounting_report/hooks/useDealPaymentsRealtime.ts`
- Create: `src/features/accounting_report/hooks/useDealPaymentsRealtime.test.tsx`
- Modify: `src/features/accounting_report/ReportPage.tsx` (mount the hook next to `useExpensesRealtime()`)
- Modify: `src/features/dashboard/DashboardPage.tsx` (mount the hook)

**Interfaces:**
- Consumes: `invalidateFinancialReports` from Task 7. Mirrors the shape of `src/features/accounting_report/hooks/useExpensesRealtime.ts` (read it first and copy its channel/subscribe/unsubscribe structure exactly).

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/accounting_report/hooks/useDealPaymentsRealtime.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const onMock = vi.fn().mockReturnThis();
const subscribeMock = vi.fn().mockReturnThis();
const removeChannelMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => ({ on: onMock, subscribe: subscribeMock })),
    removeChannel: removeChannelMock,
  },
}));
import { useDealPaymentsRealtime } from './useDealPaymentsRealtime';

describe('useDealPaymentsRealtime', () => {
  it('subscribes to deal_payments postgres_changes and cleans up on unmount', () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(() => useDealPaymentsRealtime(), { wrapper });
    expect(onMock).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'deal_payments' }),
      expect.any(Function),
    );
    expect(subscribeMock).toHaveBeenCalled();
    unmount();
    expect(removeChannelMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to fail, implement mirroring `useExpensesRealtime.ts`**

Run: `npx vitest run src/features/accounting_report/hooks/useDealPaymentsRealtime.test.tsx` → FAIL (module missing).

```typescript
// src/features/accounting_report/hooks/useDealPaymentsRealtime.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';

// deal_payments is already in the realtime publication (the accounting kanban
// listens to it); the Report/Dashboard just never subscribed.
export function useDealPaymentsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('deal-payments-report')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deal_payments' }, () => {
        invalidateFinancialReports(qc);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
```

Adjust to match `useExpensesRealtime.ts` structure exactly if it differs (channel naming, cleanup idiom) — that file is the house pattern.

- [ ] **Step 3: Mount in ReportPage + DashboardPage, test, build, commit**

Add `useDealPaymentsRealtime();` beside `useExpensesRealtime();` in `ReportPage.tsx`, and in `DashboardPage.tsx`'s component body (import path `@/features/accounting_report/hooks/useDealPaymentsRealtime`).
Run: `npx vitest run src/features/accounting_report/hooks/useDealPaymentsRealtime.test.tsx && npm run build` → PASS.

```bash
git add src/features/accounting_report/hooks/useDealPaymentsRealtime.ts src/features/accounting_report/hooks/useDealPaymentsRealtime.test.tsx src/features/accounting_report/ReportPage.tsx src/features/dashboard/DashboardPage.tsx
git commit -m "feat(report): live refresh of Report/Dashboard on deal_payments changes"
git push origin main
```

- [ ] **Step 4: Live verification (repeat Task 6 UI observation on the deployed fix)**

After Vercel deploys, repeat Task 6 Step 2 (Report open, REST mark-paid on the AUDIT-TEST payment): the Income total must now update WITHOUT reload. If `deal_payments` turns out not to be in the realtime publication (no event arrives), record it — the publication add joins Task 10's DDL batch.

---

### Task 10 (DDL, token-gated): security_invoker + realtime publication migration

**Files:**
- Create: `supabase/migrations/20260803120000_ledger_security_invoker_and_realtime.sql`

**Interfaces:**
- Consumes: Task 3's verdict (leak or not) and Task 9 Step 4's verdict (publication or not). This migration file is ALWAYS committed; applying it to prod requires the owner's sbp_ token or the dashboard SQL editor.

- [ ] **Step 1: Write the migration**

```sql
-- 20260803120000_ledger_security_invoker_and_realtime.sql
-- 1) Restore security_invoker on the financial views. The 2026-07-17 revert
--    recreated accounting_ledger_v without it; a view without security_invoker
--    runs as its owner and bypasses RLS for any role with SELECT on the view.
alter view public.accounting_ledger_v set (security_invoker = true);
alter view public.accounting_pl_summary_v set (security_invoker = true);

-- 2) Let useExpensesRealtime actually receive events (expenses was never in
--    the publication; the hook has been dead since 2026-06).
alter publication supabase_realtime add table public.expenses;

-- ROLLBACK:
-- alter view public.accounting_ledger_v set (security_invoker = false);
-- alter view public.accounting_pl_summary_v set (security_invoker = false);
-- alter publication supabase_realtime drop table public.expenses;
```

If Task 3 found NO leak, keep statement 1 anyway (idempotent hardening) but note in the commit message that the live view was already invoker. If Task 9 found deal_payments missing from the publication, add `alter publication supabase_realtime add table public.deal_payments;` here too.

- [ ] **Step 2: Commit the file, then ask the owner to apply**

```bash
git add supabase/migrations/20260803120000_ledger_security_invoker_and_realtime.sql
git commit -m "fix(security): restore security_invoker on ledger views; expenses realtime"
git push origin main
```

Present the owner two options: paste an sbp_ token in chat (rotated afterwards, standing rule) so the session applies it via the Management API, or run the file in the Supabase dashboard SQL editor. **Do not proceed to Task 11 until it is applied or the owner defers.**

- [ ] **Step 3: Post-apply verification**

Re-run `t3_security.py` — the sales probes must now be denied AND `admin -> accounting_ledger_v` must still return rows (an invoker view also needs the underlying-table RLS to admit admins; if admin sees 0 rows after the flip, STOP, apply the migration's ROLLBACK block for the views, and report — the views' grants need redesign, not a blind flip).
Re-run Task 4 Step 4 (expense insert with the page open): with the publication fix the row must appear WITHOUT reload.

---

### Task 11: Post-fix verification sweep + findings report

**Files:**
- Create: `<scratchpad>/audit/final_report.md` (source for the user-facing summary)

- [ ] **Step 1: Re-run the full read-only battery**

Run: `cd <scratchpad>/audit && python3 t1_expense_invariants.py && python3 t2_ledger_recon.py && python3 t3_security.py`
Expected: identical-or-better results than phase 1; zero `AUDIT-TEST` residue anywhere:
`python3 -c "from rest import login, req; t=login(); print(req('/rest/v1/expenses?select=id&vendor=like.AUDIT-TEST*', token=t), req('/rest/v1/deal_payments?select=id&label=like.AUDIT-TEST*', token=t))"` → `[] []`.

- [ ] **Step 2: Write the findings report**

Structure: (a) what was verified green (each invariant/reconciliation with numbers), (b) bugs found+fixed (commit hashes), (c) findings needing an OWNER DECISION — expected at minimum: S5 (56 pending expenses invisible to the cash-basis report — options: mark historical ones paid, or an "include pending" toggle on ExpenseBreakdown), archived-deal ledger pollution (Task 6 L1) with proposed `where not d.archived` view change, and anything Task 3 surfaced. No fixes for these without explicit approval.

- [ ] **Step 3: Update memories**

Update `project_ledger_cash_basis.md` / `project_expenses_autopay.md` with fixed items + new facts (helper file name, realtime hook, security_invoker state); add a `project` memory for the audit if open decisions remain. Update `MEMORY.md` index accordingly.

---

## Self-Review (done at write time)

- **Spec coverage:** "τρέχεις τα πάντα" → invariants (T1), reconciliation (T2), security (T3), expense lifecycle incl. UI update behavior (T4), autopay (T5), income update path (T6); "αν όλα γίνονται σωστά update" → staleness fixes T7–T9 + live verification T9.4/T10.3; report correctness → T2/T4/T11.
- **Placeholder scan:** all steps carry runnable code/commands; the only conditional content (Task 10 statement additions) is gated on explicit earlier-task verdicts, with exact SQL given for both branches.
- **Type consistency:** `invalidateFinancialReports(qc: QueryClient)` + `FINANCIAL_REPORT_KEYS` used identically in T7/T8/T9; REST helper signatures consistent across T1–T6 scripts.
