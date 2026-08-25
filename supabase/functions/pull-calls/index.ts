// pull-calls — copies new per-call rows from the sales app's call_records
// (fed by the PBX box) into the CRM's call_log; the call_log AFTER INSERT
// trigger turns each one into an automatic comment on the right card
// (lead / deal / deal channel). Idempotent: on-conflict-do-nothing on
// yeastar_uid, cursor with a 15-minute overlap.
//
// Trigger: pg_cron every 2 minutes with `Bearer <CALL_PULL_SECRET>`.
import { createClient } from 'jsr:@supabase/supabase-js@^2.45';
import { timingSafeEqual } from '../_shared/timing.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PULL_SECRET = Deno.env.get('CALL_PULL_SECRET') ?? '';
const SALES_URL = Deno.env.get('SALES_SUPABASE_URL') ?? '';
const SALES_KEY = Deno.env.get('SALES_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(URL_, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!PULL_SECRET || !timingSafeEqual(bearer, PULL_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!SALES_URL || !SALES_KEY) return json({ error: 'SALES_* secrets not configured' }, 500);

  const { data: cfg } = await admin.from('call_pull_config').select('pulled_through').eq('id', true).single();
  if (!cfg) return json({ error: 'call_pull_config missing' }, 500);

  const since = new Date(Date.parse(cfg.pulled_through) - 15 * 60_000).toISOString();
  const sales = createClient(SALES_URL, SALES_KEY);
  const { data: records, error } = await sales
    .from('call_records')
    .select('yeastar_uid, extension, call_type, disposition, call_from, call_to, ring_seconds, talk_seconds, call_time, created_at')
    .gt('created_at', since)
    .in('call_type', ['Inbound', 'Outbound'])
    .not('yeastar_uid', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) return json({ error: error.message }, 500);

  let inserted = 0;
  let maxCreated = cfg.pulled_through;
  // Small sub-batches keep each statement (and its per-row routing trigger)
  // well under the statement timeout.
  const rows = records ?? [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => ({
      yeastar_uid: r.yeastar_uid,
      extension: r.extension,
      call_type: r.call_type,
      disposition: r.disposition,
      from_number: r.call_from,
      to_number: r.call_to,
      ring_seconds: r.ring_seconds ?? 0,
      talk_seconds: r.talk_seconds ?? 0,
      started_at: r.call_time,
    }));
    const { error: insErr, count } = await admin
      .from('call_log')
      .upsert(chunk, { onConflict: 'yeastar_uid', ignoreDuplicates: true, count: 'exact' });
    if (insErr) return json({ error: insErr.message, inserted }, 500);
    inserted += count ?? 0;
    const last = rows[Math.min(i + 99, rows.length - 1)];
    if (last?.created_at && last.created_at > maxCreated) maxCreated = last.created_at;
  }

  if (rows.length > 0) {
    await admin.from('call_pull_config').update({ pulled_through: maxCreated }).eq('id', true);
  }
  return json({ pulled: rows.length, inserted });
});
