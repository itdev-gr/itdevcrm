// my-commission — current-month earnings for the logged-in salesperson, read
// live from the sales app's DB (project cthjxcftxwxbjpqmfiko) and matched by
// email, exactly mirroring useSalesData's monthly aggregation over there
// (filter month/year columns; commission + setup_fee = total_earnings), plus
// the month's bonuses. Feeds the CommissionWidget in the CRM topbar.
//
// Auth: the caller's own JWT (anon client + getUser — invite_user pattern).
// Secrets: SALES_SUPABASE_URL / SALES_SERVICE_ROLE_KEY (shared with
// push-break-stats / push-won-sale).
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // baggage + sentry-trace: the CRM's Sentry instrumentation attaches them to
  // every fetch — without them the browser preflight fails and the widget
  // silently hides (2026-08-24).
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SALES_URL = Deno.env.get('SALES_SUPABASE_URL') ?? '';
const SALES_KEY = Deno.env.get('SALES_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SALES_URL || !SALES_KEY) return json({ error: 'SALES_* secrets not configured' }, 500);

  const caller = createClient(URL_, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData } = await caller.auth.getUser();
  const email = userData?.user?.email;
  if (!email) return json({ error: 'unauthorized' }, 401);

  const sales = createClient(SALES_URL, SALES_KEY);
  const { data: profile } = await sales
    .from('profiles').select('id, role').ilike('email', email).maybeSingle();
  if (!profile) return json({ found: false });

  // Current month/year in Athens time — the columns the sales app filters on.
  const athens = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' })
    .format(new Date()); // YYYY-MM-DD
  const [yearStr, monthStr] = athens.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  const { data: rows, error } = await sales
    .from('sales')
    .select('amount, commission, setup_fee, total_earnings, packages_sold')
    .eq('user_id', profile.id)
    .eq('month', month)
    .eq('year', year);
  if (error) return json({ error: error.message }, 500);

  const sum = (k: 'amount' | 'commission' | 'setup_fee' | 'total_earnings' | 'packages_sold') =>
    (rows ?? []).reduce((t, r) => t + Number(r[k] ?? 0), 0);

  const monthStart = `${yearStr}-${monthStr}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const { data: bonusRows } = await sales
    .from('bonuses')
    .select('amount')
    .eq('user_id', profile.id)
    .gte('period_start', monthStart)
    .lt('period_start', nextMonth);
  const bonuses = (bonusRows ?? []).reduce((t, r) => t + Number(r.amount ?? 0), 0);

  return json({
    found: true,
    role: profile.role,
    month,
    year,
    sales_amount: sum('amount'),
    packages: sum('packages_sold'),
    commission: sum('commission'),
    setup_fees: sum('setup_fee'),
    total_earnings: sum('total_earnings'),
    bonuses,
  });
});
