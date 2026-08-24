// push-break-stats — pushes per-user daily break totals into the sales app's
// DB (project cthjxcftxwxbjpqmfiko) so its Activity Dashboard can show them.
// Aggregates break_sessions for one Athens day, matches CRM users to sales
// profiles by email (the same join key sync-google-workspace uses over there),
// and calls the sales upsert_break_activity RPC per user.
//
// Trigger: nightly pg_cron (22:30 UTC) POSTs `{}` with a
// `Bearer <BREAK_PUSH_SECRET>` header → pushes YESTERDAY (Athens).
// Manual runs may pass {date:"YYYY-MM-DD"} (or ?date=) to (re)push any day.
// Auth + client shape mirror webdev-weekly-report/index.ts.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { timingSafeEqual } from '../_shared/timing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUSH_SECRET = Deno.env.get('BREAK_PUSH_SECRET') ?? '';
const SALES_URL = Deno.env.get('SALES_SUPABASE_URL') ?? '';
const SALES_KEY = Deno.env.get('SALES_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(URL_, SERVICE_KEY);

function athensDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  if (!PUSH_SECRET || !timingSafeEqual(bearer, PUSH_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SALES_URL || !SALES_KEY) {
    return json({ error: 'SALES_SUPABASE_URL / SALES_SERVICE_ROLE_KEY not configured' }, 500);
  }

  let date = new URL(req.url).searchParams.get('date');
  try {
    const body = await req.json();
    if (!date && typeof body?.date === 'string') date = body.date;
  } catch { /* empty body is fine */ }
  if (!date) date = athensDate(-1); // the just-finished Athens day
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: `bad date: ${date}` }, 400);

  // Per-user totals for that Athens day. Only CLOSED sessions count — the
  // nightly close_dangling_breaks cron runs before this does.
  const { data: totals, error: aggErr } = await admin.rpc('admin_break_totals_for_day', { p_date: date });
  if (aggErr) return json({ error: `aggregate failed: ${aggErr.message}` }, 500);

  const rows = (totals ?? []) as { email: string | null; break_seconds: number; break_count: number }[];
  if (rows.length === 0) return json({ date, pushed: 0, skipped: [] });

  const sales = createClient(SALES_URL, SALES_KEY);
  const { data: salesProfiles, error: profErr } = await sales.from('profiles').select('id, email');
  if (profErr) return json({ error: `sales profiles failed: ${profErr.message}` }, 500);
  const emailToId = new Map<string, string>();
  for (const p of salesProfiles ?? []) {
    if (p.email) emailToId.set(String(p.email).toLowerCase(), p.id);
  }

  let pushed = 0;
  const skipped: string[] = [];
  for (const r of rows) {
    const salesId = r.email ? emailToId.get(r.email.toLowerCase()) : undefined;
    if (!salesId) {
      skipped.push(r.email ?? '(no email)');
      continue;
    }
    const { error } = await sales.rpc('upsert_break_activity', {
      p_user_id: salesId,
      p_date: date,
      p_break_seconds: r.break_seconds,
      p_break_count: r.break_count,
    });
    if (error) return json({ error: `upsert for ${r.email} failed: ${error.message}`, date, pushed, skipped }, 500);
    pushed++;
  }

  console.log(`push-break-stats ${date}: pushed=${pushed} skipped=${skipped.join(',') || '-'}`);
  return json({ date, pushed, skipped });
});
