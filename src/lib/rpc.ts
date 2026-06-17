import { supabase } from '@/lib/supabase';

export type LockDealResult = { ok: true; deal_id: string } | { ok: false; errors: string[] };

export async function lockDeal(dealId: string): Promise<LockDealResult> {
  const { data, error } = await supabase.rpc('lock_deal', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as LockDealResult;
}

export type CompleteAccountingResult =
  | { ok: true; deal_id: string }
  | { ok: false; errors: string[] };

export async function completeAccounting(dealId: string): Promise<CompleteAccountingResult> {
  const { data, error } = await supabase.rpc('complete_accounting', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as CompleteAccountingResult;
}

export type BlockClientResult = { ok: true; block_id: string } | { ok: false; errors: string[] };
export type UnblockClientResult = { ok: true; block_id: string } | { ok: false; errors: string[] };

export async function blockClient(clientId: string, reason: string): Promise<BlockClientResult> {
  const { data, error } = await supabase.rpc('block_client', {
    target_client_id: clientId,
    reason_text: reason,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as BlockClientResult;
}

export async function unblockClient(clientId: string): Promise<UnblockClientResult> {
  const { data, error } = await supabase.rpc('unblock_client', { target_client_id: clientId });
  if (error) return { ok: false, errors: [error.message] };
  return data as UnblockClientResult;
}

export type ConvertLeadResult =
  | { ok: true; lead_id: string; client_id: string; deal_id: string }
  | { ok: false; errors: string[] };

export async function convertLeadToClient(leadId: string): Promise<ConvertLeadResult> {
  const { data, error } = await supabase.rpc('convert_lead_to_client', {
    target_lead_id: leadId,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as ConvertLeadResult;
}

// --- Custom jobs & billing ---------------------------------------------------
// These RPCs all return { ok: true, job_id } or { ok: false, errors }.
// They are not yet in the generated Supabase types, so call through a loose
// signature (same pattern as useDistributeUnassigned / useEmailHealth).

const rpcCall = supabase.rpc as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type JobBillingResult = { ok: true; job_id: string } | { ok: false; errors: string[] };

export type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';
export type JobDepartment =
  | 'web_seo'
  | 'local_seo'
  | 'web_dev'
  | 'social_media'
  | 'ai_seo'
  | 'hosting'
  | 'ads';

export type CreateCustomJobInput = {
  dealId: string;
  title: string;
  description?: string | null;
  /** Ignored server-side when billingOnly is true. */
  department: JobDepartment;
  billingType: BillingType;
  amountNet: number;
  vatRate: number;
  setupFee?: number;
  billingOnly?: boolean;
};

export async function createCustomJob(input: CreateCustomJobInput): Promise<JobBillingResult> {
  const { data, error } = await rpcCall('create_custom_job', {
    p_deal_id: input.dealId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_department: input.department,
    p_billing_type: input.billingType,
    p_amount_net: input.amountNet,
    p_vat_rate: input.vatRate,
    p_setup_fee: input.setupFee ?? 0,
    p_billing_only: input.billingOnly ?? false,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as JobBillingResult;
}

export type UpdateJobBillingInput = {
  jobId: string;
  title?: string | null;
  description?: string | null;
  amountNet?: number | null;
  vatRate?: number | null;
  billingType?: BillingType | null;
  billingGroupId?: string | null;
  clearGroup?: boolean;
};

export async function updateJobBilling(input: UpdateJobBillingInput): Promise<JobBillingResult> {
  const { data, error } = await rpcCall('update_job_billing', {
    p_job_id: input.jobId,
    p_title: input.title ?? null,
    p_description: input.description ?? null,
    p_amount_net: input.amountNet ?? null,
    p_vat_rate: input.vatRate ?? null,
    p_billing_type: input.billingType ?? null,
    p_billing_group_id: input.billingGroupId ?? null,
    p_clear_group: input.clearGroup ?? false,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as JobBillingResult;
}

export async function endJob(jobId: string): Promise<JobBillingResult> {
  const { data, error } = await rpcCall('end_job', { p_job_id: jobId });
  if (error) return { ok: false, errors: [error.message] };
  return data as JobBillingResult;
}
