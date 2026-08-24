// push-won-sale — drains won_push_outbox: every won lead's deal becomes one
// row in the sales app's `sales` table (project cthjxcftxwxbjpqmfiko), so
// salespeople no longer enter closed deals manually on /tracking.
//
// Mapping (owner decision 2026-08-24):
//   - packages from the CRM: package_type = the deal's services_planned
//     package names (service_packages.display_names.el, fallback service_type),
//     packages_sold = number of service items.
//   - amount = one_time_value + recurring_monthly_value, taken AS-IS: CRM
//     deal values are stored NET of VAT (the current seed_deal_payments
//     treats them as amount_net and adds VAT on top), so no VAT math here.
//     (Fixed 2026-08-24: an earlier version divided by 1.24 based on the
//     June-era billing convention — deal 006314 arrived as 161.29 instead
//     of 200.)
//   - commission 23% flat (parity with the manual form), setup_fee 0 — the
//     whole value goes through `amount` so nothing is credited at 100%.
//   - credit goes to the lead's owner (fallback: won_by_user_id), matched to
//     the sales app by profile email.
//   - idempotency: upsert on sales.crm_deal_id (unique index there).
//
// Trigger: outbox pulse trigger + */10min pg_cron POST {drain:true} with a
// `Bearer <WON_PUSH_SECRET>` header. Auth + client shape mirror
// webdev-weekly-report/index.ts.
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
const PUSH_SECRET = Deno.env.get('WON_PUSH_SECRET') ?? '';
const SALES_URL = Deno.env.get('SALES_SUPABASE_URL') ?? '';
const SALES_KEY = Deno.env.get('SALES_SERVICE_ROLE_KEY') ?? '';

const COMMISSION_RATE = 0.23; // parity with SalesEntryForm.tsx in the sales app
const MAX_ATTEMPTS = 8;

const admin = createClient(URL_, SERVICE_KEY);

/** ISO week + ISO year, computed from the plain date string (no TZ drift). */
function isoWeek(dateStr: string): { week: number; year: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const isoYear = dt.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { week, year: isoYear };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!PUSH_SECRET || !timingSafeEqual(bearer, PUSH_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!SALES_URL || !SALES_KEY) return json({ error: 'SALES_* secrets not configured' }, 500);

  const { data: queue, error: qErr } = await admin
    .from('won_push_outbox')
    .select('id, lead_id, deal_id, attempts')
    .in('status', ['queued', 'error'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(20);
  if (qErr) return json({ error: qErr.message }, 500);
  if (!queue || queue.length === 0) return json({ processed: 0, failed: 0 });

  const sales = createClient(SALES_URL, SALES_KEY);
  const { data: salesProfiles, error: spErr } = await sales.from('profiles').select('id, email');
  if (spErr) return json({ error: `sales profiles: ${spErr.message}` }, 500);
  const emailToSalesId = new Map<string, string>();
  for (const p of salesProfiles ?? []) if (p.email) emailToSalesId.set(String(p.email).toLowerCase(), p.id);

  let processed = 0, failed = 0;
  for (const item of queue) {
    const fail = async (msg: string) => {
      failed++;
      await admin.from('won_push_outbox')
        .update({ status: 'error', attempts: item.attempts + 1, last_error: msg.slice(0, 500) })
        .eq('id', item.id);
      console.error(`outbox ${item.id}: ${msg}`);
    };

    try {
      const { data: deal } = await admin
        .from('deals')
        .select('id, code, client_id, one_time_value, recurring_monthly_value, services_planned, actual_close_date')
        .eq('id', item.deal_id)
        .single();
      if (!deal) { await fail('deal not found'); continue; }

      const { data: lead } = await admin
        .from('leads')
        .select('owner_user_id, won_by_user_id, company_name')
        .eq('id', item.lead_id)
        .single();
      const crmUserId = lead?.owner_user_id ?? lead?.won_by_user_id;
      if (!crmUserId) { await fail('lead has no owner or won_by user'); continue; }

      const { data: crmProfile } = await admin
        .from('profiles').select('email').eq('user_id', crmUserId).single();
      const salesUserId = crmProfile?.email ? emailToSalesId.get(crmProfile.email.toLowerCase()) : undefined;
      if (!salesUserId) { await fail(`no sales-app profile for ${crmProfile?.email ?? crmUserId}`); continue; }

      const { data: client } = await admin
        .from('clients').select('name').eq('id', deal.client_id).single();

      // Deal values are already NET of VAT — pass them through unchanged.
      const amount = Math.round(
        (Number(deal.one_time_value ?? 0) + Number(deal.recurring_monthly_value ?? 0)) * 100,
      ) / 100;

      // Packages straight from the CRM deal.
      const services = Array.isArray(deal.services_planned) ? deal.services_planned : [];
      const packagesSold = Math.max(1, services.length);
      const packageIds = services.map((s: any) => s?.package_id).filter(Boolean);
      const nameById = new Map<string, string>();
      if (packageIds.length > 0) {
        const { data: pkgs } = await admin
          .from('service_packages').select('id, display_names').in('id', packageIds);
        for (const p of pkgs ?? []) {
          nameById.set(p.id, (p.display_names as any)?.el ?? (p.display_names as any)?.en ?? '');
        }
      }
      const labels = services.map((s: any) =>
        (s?.package_id && nameById.get(s.package_id)) || s?.service_type || 'service');
      const packageType = (labels.length ? [...new Set(labels)].join(' + ') : 'crm').slice(0, 200);

      const date = deal.actual_close_date
        ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
      const [, mStr] = date.split('-');
      const { week, year } = isoWeek(date);

      const commission = Math.round(amount * COMMISSION_RATE * 100) / 100;
      const { error: upErr } = await sales.from('sales').upsert({
        crm_deal_id: deal.id,
        user_id: salesUserId,
        packages_sold: packagesSold,
        package_type: packageType,
        package_value: Math.round((amount / packagesSold) * 100) / 100,
        setup_fee: 0,
        amount,
        commission,
        total_earnings: commission,
        date,
        week,
        month: Number(mStr),
        year,
        client_name: (lead?.company_name ?? client?.name ?? '').slice(0, 200) || null,
        source: 'crm',
      }, { onConflict: 'crm_deal_id' });
      if (upErr) { await fail(`sales upsert: ${upErr.message}`); continue; }

      processed++;
      await admin.from('won_push_outbox')
        .update({ status: 'sent', attempts: item.attempts + 1, sent_at: new Date().toISOString(), last_error: null })
        .eq('id', item.id);
    } catch (e) {
      await fail(e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`push-won-sale: processed=${processed} failed=${failed}`);
  return json({ processed, failed });
});
