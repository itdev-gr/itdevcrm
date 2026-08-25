// deno-lint-ignore-file no-explicit-any
// Read-only data tools for the accounting assistant. EVERY query runs on the
// caller's JWT client, so RLS decides what each user can see — the assistant
// can never read more than the person asking. Totals are computed here in
// code; the LLM only narrates them (house rule: no invented figures).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@^2.45';

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'search_entity',
      description:
        'Βρίσκει πελάτη/deal/lead από όνομα ή κωδικό (π.χ. "ΦΟΥΡΝΑΡΗ" ή "000066"). Επιστρέφει entity_type + id + κωδικό. Χρησιμοποίησέ το ΠΡΩΤΑ όταν ο χρήστης αναφέρει πελάτη με όνομα.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: 'Όνομα ή κωδικός' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'client_360',
      description:
        'Πλήρης εικόνα πελάτη: στοιχεία, κατάσταση/μπλοκ, deal + στάδιο λογιστηρίου, πληρωμές (σύνολα & πρόσφατες), επόμενη οφειλή, συνδρομές/jobs, συμβόλαια, πρόσφατα emails, ανοιχτά tasks, alerts.',
      parameters: {
        type: 'object',
        properties: { client_id: { type: 'string', description: 'UUID του πελάτη (από search_entity)' } },
        required: ['client_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clients_by_service',
      description:
        'Μετράει και λιστάρει τους πελάτες ανά υπηρεσία, ΜΑΖΙ με πλήρη κατανομή κατάστασης (ενεργοί/μπλοκαρισμένοι/νέοι/ολοκληρωμένοι) υπολογισμένη σε ΟΛΟΥΣ τους πελάτες. Χωρίς service_type: πλήθος + καταστάσεις για ΚΑΘΕ υπηρεσία. Με service_type: πλήθος, καταστάσεις + λίστα. ΠΑΝΤΑ αυτό για «πόσοι πελάτες έχουν Χ» ή «είναι όλοι ενεργοί;» — ΠΟΤΕ το search_entity.',
      parameters: {
        type: 'object',
        properties: {
          service_type: {
            type: 'string',
            enum: ['local_seo', 'web_seo', 'ai_seo', 'web_dev', 'hosting', 'domains', 'ads', 'social_media', 'maintenance', 'franchise'],
            description: 'Προαιρετικό: η υπηρεσία (local_seo = Τοπικό SEO κ.ο.κ.)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'payments_due',
      description:
        'Ληξιπρόθεσμες + επερχόμενες οφειλές όλων των πελατών μέσα στις επόμενες Χ μέρες, με σύνολα.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Ορίζοντας ημερών (default 7)' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'integrity_alerts',
      description: 'Τα ανοιχτά integrity alerts του λογιστηρίου (προβλήματα δεδομένων/χρεώσεων).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ledger_summary',
      description:
        'Σύνοψη εσόδων/εξόδων/κέρδους ανά μήνα για ένα διάστημα (ίσως μη διαθέσιμη για μη-admin — τα έξοδα είναι admin-only).',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'client_activity',
      description: 'Πρόσφατο ιστορικό ενεργειών (activity log) ενός πελάτη.',
      parameters: {
        type: 'object',
        properties: { client_id: { type: 'string' } },
        required: ['client_id'],
      },
    },
  },
];

const eur = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

export function paymentTotals(payments: any[]): Record<string, unknown> {
  const by = (s: string) => payments.filter((p) => p.status === s);
  const sum = (rows: any[]) => eur(rows.reduce((t, p) => t + Number(p.amount_gross ?? 0), 0));
  return {
    paid_count: by('paid').length,
    paid_total_gross: sum(by('paid')),
    pending_count: by('pending').length,
    pending_total_gross: sum(by('pending')),
    overdue_count: by('overdue').length,
    overdue_total_gross: sum(by('overdue')),
  };
}

export async function runTool(
  caller: SupabaseClient,
  name: string,
  args: any,
): Promise<unknown> {
  switch (name) {
    case 'search_entity': {
      const { data, error } = await caller.rpc('global_search', { q: String(args.q ?? ''), max_rows: 8 });
      if (error) return { error: error.message };
      return { results: data ?? [] };
    }

    case 'client_360': {
      const clientId = String(args.client_id ?? '');
      const [client, deals, jobs, contracts, emails, tasks] = await Promise.all([
        caller.from('clients')
          .select('id, name, code, status, email, phone, vat_number, country, industry, start_date, archived, client_blocks(reason, blocked_at, unblocked_at)')
          .eq('id', clientId).maybeSingle(),
        caller.from('deals')
          .select('id, code, title, archived, payment_method, cash_charge_vat, one_time_value, recurring_monthly_value, invoiced_date, accounting_completed_at, suppress_payment_reminders, accounting_stage:pipeline_stages!deals_accounting_stage_id_fkey(code)')
          .eq('client_id', clientId).order('created_at', { ascending: false }).limit(3),
        caller.from('jobs')
          .select('code, service_type, billing_type, amount_net, monthly_amount, status, billing_active, is_blocked, blocked_reason, period_due_date, archived')
          .eq('client_id', clientId).eq('archived', false),
        caller.from('contracts')
          .select('contract_number, title, status, sent_at')
          .eq('client_id', clientId).limit(5),
        caller.from('email_messages')
          .select('sent_at, direction, from_email, subject, snippet')
          .eq('client_id', clientId).order('sent_at', { ascending: false }).limit(10),
        caller.from('assigned_tasks')
          .select('title, importance, status, created_at')
          .eq('client_id', clientId).neq('status', 'closed').limit(10),
      ]);
      if (client.error) return { error: client.error.message };
      if (!client.data) return { error: 'client_not_found' };

      const activeDeal = (deals.data ?? []).find((d: any) => !d.archived) ?? (deals.data ?? [])[0] ?? null;
      let payments: any[] = [];
      let nextDue: string | null = null;
      if (activeDeal) {
        const [pays, due] = await Promise.all([
          caller.from('deal_payments')
            .select('service_type, billing_type, label, amount_net, amount_gross, vat_rate, status, start_date, end_date, paid_at, invoice_number')
            .eq('deal_id', activeDeal.id).order('start_date', { ascending: false }).limit(30),
          caller.rpc('deal_next_due', { p_deal_id: activeDeal.id }),
        ]);
        payments = pays.data ?? [];
        nextDue = (due.data as string | null) ?? null;
      }

      let clientAlerts: any[] = [];
      const alerts = await caller.rpc('accounting_integrity_alerts');
      if (!alerts.error && Array.isArray(alerts.data)) {
        const code = (client.data as any).code;
        clientAlerts = alerts.data.filter((a: any) => a.subject_code === code).slice(0, 10);
      }

      return {
        client: client.data,
        deal: activeDeal,
        next_due: nextDue,
        payment_totals: paymentTotals(payments),
        payments,
        jobs: jobs.data ?? [],
        contracts: contracts.data ?? [],
        recent_emails: emails.data ?? [],
        open_tasks: tasks.data ?? [],
        alerts: clientAlerts,
      };
    }

    case 'clients_by_service': {
      const svc = args.service_type ? String(args.service_type) : null;
      let q = caller.from('jobs')
        .select('service_type, client_id, is_blocked, billing_active, client:clients(name, code, status)')
        .eq('archived', false)
        .limit(3000);
      if (svc) q = q.eq('service_type', svc);
      const { data, error } = await q;
      if (error) return { error: error.message };
      const rows = (data ?? []) as any[];

      const statusCountsOf = (entries: any[]) => {
        const seen = new Map<string, string>();
        for (const r of entries) {
          if (!seen.has(r.client_id)) seen.set(r.client_id, r.client?.status ?? 'unknown');
        }
        const out: Record<string, number> = {};
        for (const s of seen.values()) out[s] = (out[s] ?? 0) + 1;
        return out;
      };

      if (!svc) {
        const perService = new Map<string, any[]>();
        for (const r of rows) {
          if (!perService.has(r.service_type)) perService.set(r.service_type, []);
          perService.get(r.service_type)!.push(r);
        }
        return {
          counts: [...perService.entries()]
            .map(([service_type, entries]) => ({
              service_type,
              clients: new Set(entries.map((e) => e.client_id)).size,
              // Complete per-status breakdown over ALL clients of the service.
              status_counts: statusCountsOf(entries),
            }))
            .sort((a, b) => b.clients - a.clients),
        };
      }

      const byClient = new Map<string, any>();
      for (const r of rows) {
        if (!byClient.has(r.client_id)) {
          byClient.set(r.client_id, {
            name: r.client?.name ?? null,
            code: r.client?.code ?? null,
            status: r.client?.status ?? null,
            blocked_job: !!r.is_blocked,
          });
        } else if (r.is_blocked) {
          byClient.get(r.client_id).blocked_job = true;
        }
      }
      const clients = [...byClient.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'el'));
      return {
        service_type: svc,
        // Totals + status breakdown are COMPLETE; only the name list truncates.
        total_clients: clients.length,
        status_counts: statusCountsOf(rows),
        clients_with_blocked_job: clients.filter((c) => c.blocked_job).length,
        clients: clients.slice(0, 100),
        list_truncated: clients.length > 100,
      };
    }

    case 'payments_due': {
      const days = Math.min(Math.max(Number(args.days ?? 7), 1), 90);
      const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await caller.from('deal_payments')
        .select('amount_gross, status, start_date, end_date, service_type, deal:deals(code, client:clients(name, code, status))')
        .in('status', ['pending', 'overdue'])
        .lte('start_date', until)
        .order('start_date', { ascending: true })
        .limit(60);
      if (error) return { error: error.message };
      const rows = (data ?? []).map((p: any) => ({
        client: p.deal?.client?.name ?? null,
        client_code: p.deal?.client?.code ?? null,
        client_status: p.deal?.client?.status ?? null,
        service_type: p.service_type,
        amount_gross: eur(p.amount_gross),
        status: p.status,
        due_date: p.start_date,
      }));
      return {
        horizon_days: days,
        count: rows.length,
        total_gross: eur(rows.reduce((t: number, r: any) => t + r.amount_gross, 0)),
        rows,
      };
    }

    case 'integrity_alerts': {
      const { data, error } = await caller.rpc('accounting_integrity_alerts');
      if (error) return { error: error.message };
      const alerts = (data ?? []) as any[];
      return {
        count: alerts.length,
        by_severity: {
          red: alerts.filter((a) => a.severity === 'red').length,
          amber: alerts.filter((a) => a.severity === 'amber').length,
          grey: alerts.filter((a) => a.severity === 'grey').length,
        },
        alerts: alerts.slice(0, 40),
      };
    }

    case 'ledger_summary': {
      const { data, error } = await caller.from('accounting_pl_summary_v')
        .select('*')
        .gte('period', String(args.from ?? '').slice(0, 7))
        .lte('period', String(args.to ?? '').slice(0, 7))
        .order('period');
      if (error) return { error: error.message, note: 'Πιθανόν δεν έχεις πρόσβαση (τα έξοδα/P&L είναι admin-only).' };
      if (!data || data.length === 0) return { note: 'Κανένα δεδομένο για το διάστημα — ή δεν έχεις πρόσβαση (admin-only).' };
      return { periods: data };
    }

    case 'client_activity': {
      const { data, error } = await caller.from('activity_log')
        .select('created_at, entity_type, action, user_id')
        .eq('client_id', String(args.client_id ?? ''))
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return { error: error.message };
      return { events: data ?? [] };
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}
