import { supabase } from '@/lib/supabase';
import type { ImportedLeadRow } from '@/features/leads/leadImport';

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

// `.bind(supabase)` is required: supabase-js's `rpc()` is a prototype method
// whose body is `return this.rest.rpc(...)`. Capturing `supabase.rpc` into a
// bare const detaches `this`, so calls crash with
// "Cannot read properties of undefined (reading 'rest')".
const rpcCall = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type DeleteLeadsResult =
  | { ok: true; deletedCount: number; skipped: string[] }
  | { ok: false; errors: string[] };

// Admin-only permanent delete via the `delete_leads` RPC. Not in the generated
// types, so it goes through the loose `rpcCall` above. The RPC enforces the admin
// check + the won/converted guard and returns which ids it skipped.
export async function deleteLeads(ids: string[]): Promise<DeleteLeadsResult> {
  if (ids.length === 0) return { ok: true, deletedCount: 0, skipped: [] };
  const { data, error } = await rpcCall('delete_leads', { p_ids: ids });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as {
    ok: boolean;
    deleted_count?: number;
    skipped?: string[];
    errors?: string[];
  };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['delete_failed'] };
  return { ok: true, deletedCount: r.deleted_count ?? 0, skipped: r.skipped ?? [] };
}

export type DeleteJobsResult =
  | { ok: true; deletedCount: number }
  | { ok: false; errors: string[] };

// Admin-only permanent delete via the `delete_jobs` RPC. Mirrors deleteLeads and
// goes through the loose `rpcCall`. The RPC enforces the admin check server-side.
export async function deleteJobs(ids: string[]): Promise<DeleteJobsResult> {
  if (ids.length === 0) return { ok: true, deletedCount: 0 };
  const { data, error } = await rpcCall('delete_jobs', { p_ids: ids });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; deleted_count?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['delete_failed'] };
  return { ok: true, deletedCount: r.deleted_count ?? 0 };
}

// Count of billing lines (invoice + payment) referencing a job, for the
// delete-confirmation warning. Returns 0 on error or for non-admins.
export async function jobBillingRefCount(jobId: string): Promise<number> {
  const { data, error } = await rpcCall('job_billing_ref_count', { p_job_id: jobId });
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

export type JobBillingResult = { ok: true; job_id: string } | { ok: false; errors: string[] };

export type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';
/** Installment plan for one-time web_dev jobs (see features/deals/installmentSplit). */
export type InstallmentPlan = 'none' | '50_50' | '50_25_25';
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
  /** Only honored for web_dev one-time jobs; defaults to 'none'. */
  installmentPlan?: InstallmentPlan;
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
    p_installment_plan: input.installmentPlan ?? 'none',
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
  /** Only honored for web_dev one-time jobs; null leaves it unchanged. */
  installmentPlan?: InstallmentPlan | null;
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
    p_installment_plan: input.installmentPlan ?? null,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as JobBillingResult;
}

export async function endJob(jobId: string): Promise<JobBillingResult> {
  const { data, error } = await rpcCall('end_job', { p_job_id: jobId });
  if (error) return { ok: false, errors: [error.message] };
  return data as JobBillingResult;
}

// --- Deal close ---------------------------------------------------------------
export type CloseDealJob = { job_id: string; target_stage_id: string };
export type CloseDealResult =
  | { ok: true; deal_id: string; closed_jobs: number }
  | { ok: false; errors: string[] };

// Mark the chosen jobs done + move them to a terminal lane, then move the deal to
// accounting "Closed". Not in the generated types → loose `rpcCall`.
export async function closeDeal(
  dealId: string,
  jobs: CloseDealJob[],
): Promise<CloseDealResult> {
  const { data, error } = await rpcCall('close_deal', { p_deal_id: dealId, p_jobs: jobs });
  if (error) return { ok: false, errors: [error.message] };
  return data as CloseDealResult;
}

// --- Lead intake (duplicate review) ------------------------------------------
export type LeadIntakeActionResult =
  | { ok: true; lead_id?: string }
  | { ok: false; errors: string[] };

// Admin-only. Release moves a held duplicate into `leads`; discard marks it
// discarded. Both go through the loose `rpcCall` (not in generated types).
export async function releaseLeadIntake(id: string): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('release_lead_intake', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['release_failed'] };
  return r.lead_id ? { ok: true, lead_id: r.lead_id } : { ok: true };
}

export async function discardLeadIntake(id: string): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('discard_lead_intake', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['discard_failed'] };
  return { ok: true };
}

export type ImportLeadsResult =
  | { ok: true; imported: number; flagged: number }
  | { ok: false; errors: string[] };

// Admin-only bulk import of parsed CSV/Excel rows into the intake queue. Each row is
// duplicate-checked server-side. Goes through the loose `rpcCall` (not in generated
// types). `rows` is the output of features/leads/leadImport.
export async function importLeadsToIntake(
  rows: ImportedLeadRow[],
): Promise<ImportLeadsResult> {
  if (rows.length === 0) return { ok: true, imported: 0, flagged: 0 };
  const { data, error } = await rpcCall('import_leads_to_intake', { p_rows: rows });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; imported?: number; flagged?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['import_failed'] };
  return { ok: true, imported: r.imported ?? 0, flagged: r.flagged ?? 0 };
}
