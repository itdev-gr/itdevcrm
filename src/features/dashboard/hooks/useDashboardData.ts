import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/fetchAllPages';

export type DashboardLead = {
  id: string;
  created_at: string;
  owner_user_id: string | null;
  source: string;
  estimated_one_time_value: number | null;
  estimated_monthly_value: number | null;
  stage: { terminal_outcome: string | null } | null;
};

/** Leads created inside the window — the conversion cohort. */
export function useDashboardLeads(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['dashboard-leads', range.from, range.to] as const,
    queryFn: async (): Promise<DashboardLead[]> => {
      // Paged drain: the cohort is already >3k leads on the default preset —
      // an unranged select silently truncates at PostgREST's 1000-row page.
      const rows = await fetchAllPages(() =>
        supabase
          .from('leads')
          .select(
            'id, created_at, owner_user_id, source, estimated_one_time_value, estimated_monthly_value, stage:pipeline_stages(terminal_outcome)',
          )
          .eq('archived', false)
          .gte('created_at', `${range.from}T00:00:00Z`)
          .lte('created_at', `${range.to}T23:59:59Z`)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
      );
      return rows as unknown as DashboardLead[];
    },
  });
}

export type DashboardDeal = {
  won_by_user_id: string | null;
  one_time_value: number | null;
  recurring_monthly_value: number | null;
  invoiced_date: string | null;
  actual_close_date: string | null;
  accounting_stage: { code: string } | null;
};

/**
 * ACTIVE deals = the wins. Excludes archived; the page also drops closed (churned)
 * deals via accounting_stage.code === 'closed'. Won-date = invoiced_date ?? actual_close_date.
 */
export function useDashboardDeals() {
  return useQuery({
    queryKey: ['dashboard-deals'] as const,
    queryFn: async (): Promise<DashboardDeal[]> => {
      const rows = await fetchAllPages(() =>
        supabase
          .from('deals')
          .select(
            'id, won_by_user_id, one_time_value, recurring_monthly_value, invoiced_date, actual_close_date, accounting_stage:accounting_stage_id ( code )',
          )
          .eq('archived', false)
          .order('id', { ascending: true }),
      );
      return rows as unknown as DashboardDeal[];
    },
  });
}

export type MonthlyPLRow = {
  period: string; // YYYY-MM
  total_income_gross: number | null;
  total_expense_gross: number | null;
  net_profit_gross: number | null;
};

/** Per-month income/expense/profit straight from the accounting view. */
export function useMonthlyPL(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['dashboard-monthly-pl', range.from, range.to] as const,
    queryFn: async (): Promise<MonthlyPLRow[]> => {
      const { data, error } = await supabase
        .from('accounting_pl_summary_v')
        .select('period, total_income_gross, total_expense_gross, net_profit_gross')
        .gte('period', range.from.slice(0, 7))
        .lte('period', range.to.slice(0, 7))
        .order('period');
      if (error) throw new Error(error.message);
      return (data ?? []) as MonthlyPLRow[];
    },
  });
}

export type RecurringCollectedRow = { month: string; gross: number };

/** Paid recurring revenue bucketed by the month the period started. */
export function useRecurringCollected(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['dashboard-recurring-collected', range.from, range.to] as const,
    queryFn: async (): Promise<RecurringCollectedRow[]> => {
      const { data, error } = await supabase
        .from('deal_payments')
        .select('amount_gross, start_date, billing_type, status')
        .eq('status', 'paid')
        .neq('billing_type', 'one_time')
        .gte('start_date', range.from)
        .lte('start_date', range.to);
      if (error) throw new Error(error.message);
      const byMonth = new Map<string, number>();
      for (const r of (data ?? []) as { amount_gross: number | null; start_date: string }[]) {
        const key = r.start_date.slice(0, 7);
        byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.amount_gross ?? 0));
      }
      return [...byMonth.entries()]
        .map(([month, gross]) => ({ month, gross }))
        .sort((a, b) => a.month.localeCompare(b.month));
    },
  });
}
