import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BillingType, JobDepartment } from '@/lib/rpc';

/** A non-archived job of the deal with its billing fields. */
export type JobBillingRow = {
  id: string;
  title: string | null;
  /** The board / department the job lives on (jobs.service_type). */
  department: JobDepartment | 'other' | string;
  billing_type: BillingType | string;
  amount_net: number | null;
  setup_fee: number | null;
  vat_rate: number | null;
  billing_active: boolean | null;
  billing_only: boolean | null;
  billing_group_id: string | null;
  status: string;
  is_custom: boolean | null;
  description: string | null;
};

/** A single billed line of a payment, scoped to one job. */
export type PaymentLine = {
  id: string;
  payment_id: string;
  job_id: string | null;
  label: string | null;
  amount_net: number;
  vat_rate: number;
  vat_amount: number;
  amount_gross: number;
};

/** A payment header from deal_payments_with_totals plus its lines. */
export type PaymentWithLines = {
  id: string;
  label: string | null;
  due_date: string | null;
  status: string;
  invoice_number: string | null;
  total_net: number;
  total_vat: number;
  total_gross: number;
  line_count: number;
  lines: PaymentLine[];
};

export type JobsBilling = {
  jobs: JobBillingRow[];
  payments: PaymentWithLines[];
};

export function jobsBillingKey(dealId: string) {
  return ['jobs-billing', dealId] as const;
}

// The new columns / view / table are not yet in the generated Supabase types,
// so these queries are intentionally untyped (cast through `unknown`).
const sb = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq?: (col: string, val: unknown) => unknown;
        order: (col: string, opts?: { ascending?: boolean }) => unknown;
      };
      in: (col: string, vals: unknown[]) => {
        order: (col: string, opts?: { ascending?: boolean }) => Promise<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export function useJobsBilling(dealId: string) {
  return useQuery({
    queryKey: jobsBillingKey(dealId),
    queryFn: async (): Promise<JobsBilling> => {
      // 1. Non-archived jobs of the deal with their billing fields.
      const jobsRes = await supabase
        .from('jobs')
        .select(
          'id, title, service_type, billing_type, amount_net, setup_fee, vat_rate, billing_active, billing_only, billing_group_id, status, is_custom, description',
        )
        .eq('deal_id', dealId)
        .eq('archived', false)
        .order('created_at', { ascending: true });
      if (jobsRes.error) throw new Error(jobsRes.error.message);

      const jobs: JobBillingRow[] = ((jobsRes.data ?? []) as unknown as Record<string, unknown>[]).map(
        (j) => ({
          id: j.id as string,
          title: (j.title as string | null) ?? null,
          department: (j.service_type as string) ?? 'other',
          billing_type: (j.billing_type as string) ?? 'one_time',
          amount_net: j.amount_net == null ? null : Number(j.amount_net),
          setup_fee: j.setup_fee == null ? null : Number(j.setup_fee),
          vat_rate: j.vat_rate == null ? null : Number(j.vat_rate),
          billing_active: (j.billing_active as boolean | null) ?? null,
          billing_only: (j.billing_only as boolean | null) ?? null,
          billing_group_id: (j.billing_group_id as string | null) ?? null,
          status: (j.status as string) ?? 'active',
          is_custom: (j.is_custom as boolean | null) ?? null,
          description: (j.description as string | null) ?? null,
        }),
      );

      // 2. Payment headers (with totals) for the deal.
      const headersRes = await sb
        .from('deal_payments_with_totals')
        .select(
          'id, label, due_date, status, invoice_number, total_net, total_vat, total_gross, line_count',
        )
        .eq('deal_id', dealId)
        .order('due_date', { ascending: true });
      const headers = headersRes as { data: unknown; error: { message: string } | null };
      if (headers.error) throw new Error(headers.error.message);
      const headerRows = (headers.data ?? []) as Record<string, unknown>[];

      // 3. Lines for those payments, grouped under their header.
      const paymentIds = headerRows.map((h) => h.id as string);
      let lineRows: Record<string, unknown>[] = [];
      if (paymentIds.length > 0) {
        const linesRes = await sb
          .from('deal_payment_lines')
          .select('id, payment_id, job_id, label, amount_net, vat_rate, vat_amount, amount_gross')
          .in('payment_id', paymentIds)
          .order('created_at', { ascending: true });
        if (linesRes.error) throw new Error(linesRes.error.message);
        lineRows = (linesRes.data ?? []) as Record<string, unknown>[];
      }

      const linesByPayment = new Map<string, PaymentLine[]>();
      for (const l of lineRows) {
        const line: PaymentLine = {
          id: l.id as string,
          payment_id: l.payment_id as string,
          job_id: (l.job_id as string | null) ?? null,
          label: (l.label as string | null) ?? null,
          amount_net: Number(l.amount_net ?? 0),
          vat_rate: Number(l.vat_rate ?? 0),
          vat_amount: Number(l.vat_amount ?? 0),
          amount_gross: Number(l.amount_gross ?? 0),
        };
        const arr = linesByPayment.get(line.payment_id) ?? [];
        arr.push(line);
        linesByPayment.set(line.payment_id, arr);
      }

      const payments: PaymentWithLines[] = headerRows.map((h) => ({
        id: h.id as string,
        label: (h.label as string | null) ?? null,
        due_date: (h.due_date as string | null) ?? null,
        status: (h.status as string) ?? 'pending',
        invoice_number: (h.invoice_number as string | null) ?? null,
        total_net: Number(h.total_net ?? 0),
        total_vat: Number(h.total_vat ?? 0),
        total_gross: Number(h.total_gross ?? 0),
        line_count: Number(h.line_count ?? 0),
        lines: linesByPayment.get(h.id as string) ?? [],
      }));

      return { jobs, payments };
    },
    enabled: !!dealId,
  });
}
