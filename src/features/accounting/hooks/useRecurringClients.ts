import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type RecurringClientRow = {
  client_id: string;
  client_name: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  status: string;
  active_services: string[];
  /** Sum of recurring_monthly job amounts. */
  monthly_total: number;
  /** Sum of recurring_yearly job amounts (annual figures). */
  yearly_total: number;
  has_overdue_payment: boolean;
  is_blocked: boolean;
  earliest_due: string | null;
  deal_id: string | null;
};

type ClientRecord = {
  id: string;
  name: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  status: string;
  jobs: Array<{
    id: string;
    service_type: string;
    billing_type: string;
    amount_net: number | string | null;
    status: string;
    archived: boolean;
  }>;
  client_blocks: Array<{ id: string; unblocked_at: string | null }>;
  deals: Array<{
    id: string;
    archived: boolean;
    deal_payments: Array<{ status: string; end_date: string | null; billing_type: string }>;
  }>;
};

export function useRecurringClients() {
  return useQuery({
    queryKey: queryKeys.recurringClients(),
    queryFn: async (): Promise<RecurringClientRow[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select(
          'id, name, contact_first_name, contact_last_name, email, phone, industry, status, jobs(id, service_type, billing_type, amount_net, status, archived), client_blocks(id, unblocked_at), deals(id, archived, deal_payments(status, end_date, billing_type))',
        )
        .eq('archived', false);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as ClientRecord[];
      const today = new Date().toISOString().slice(0, 10);

      return rows
        .map((c) => {
          const activeJobs = (c.jobs ?? []).filter(
            (j) =>
              !j.archived &&
              j.status === 'active' &&
              j.billing_type !== 'one_time',
          );
          if (activeJobs.length === 0) return null;

          // Amount lives in jobs.amount_net (yearly jobs hold the ANNUAL price there).
          // Keep the two billing cadences in separate buckets so nothing gets counted
          // as 12x its real monthly value.
          const monthlyTotal = activeJobs.reduce(
            (sum, j) =>
              sum + (j.billing_type === 'recurring_monthly' ? Number(j.amount_net) || 0 : 0),
            0,
          );
          const yearlyTotal = activeJobs.reduce(
            (sum, j) =>
              sum + (j.billing_type === 'recurring_yearly' ? Number(j.amount_net) || 0 : 0),
            0,
          );
          const services = Array.from(new Set(activeJobs.map((j) => j.service_type)));

          const isBlocked = (c.client_blocks ?? []).some((b) => b.unblocked_at === null);

          const liveDeals = (c.deals ?? []).filter((d) => !d.archived);
          const dealId = liveDeals[0]?.id ?? null;
          const recurringPayments = liveDeals
            .flatMap((d) => d.deal_payments ?? [])
            .filter(
              (p) =>
                // The daily cron flips lapsed rows to 'overdue'; pending rows
                // can still lapse between cron runs.
                (p.status === 'pending' || p.status === 'overdue') &&
                p.billing_type !== 'one_time' &&
                p.end_date !== null,
            );
          const hasOverdue = recurringPayments.some(
            (p) => p.status === 'overdue' || (p.end_date ?? '9999') <= today,
          );
          const earliestDue = recurringPayments
            .map((p) => p.end_date)
            .filter((d): d is string => !!d)
            .sort()[0] ?? null;

          return {
            client_id: c.id,
            client_name: c.name,
            contact_first_name: c.contact_first_name,
            contact_last_name: c.contact_last_name,
            email: c.email,
            phone: c.phone,
            industry: c.industry,
            status: c.status,
            active_services: services,
            monthly_total: monthlyTotal,
            yearly_total: yearlyTotal,
            has_overdue_payment: hasOverdue,
            is_blocked: isBlocked,
            earliest_due: earliestDue,
            deal_id: dealId,
          };
        })
        .filter((r): r is RecurringClientRow => r !== null)
        .sort((a, b) => a.client_name.localeCompare(b.client_name));
    },
  });
}
