import { supabase } from '@/lib/supabase';
import type { ImportedLeadRow } from '@/features/leads/leadImport';
import type { CreateDealParams } from '@/features/accounting/newDeal';
import type { CreateAnnouncementParams } from '@/features/announcements/announcement';

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

export type MarkPaidInFullResult =
  | { ok: true; deal_id: string; mode?: 'unlocked' | 'spawned' }
  | { ok: false; errors: string[] };

export async function markPaidInFull(dealId: string): Promise<MarkPaidInFullResult> {
  const { data, error } = await supabase.rpc('accounting_mark_paid_in_full', {
    target_deal_id: dealId,
  });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as MarkPaidInFullResult;
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
  | { ok: true; lead_id?: string; dropped_dead_end?: boolean }
  | { ok: false; errors: string[] };

// Admin-only. Release moves a held duplicate into `leads`; discard marks it
// discarded. Both go through the loose `rpcCall` (not in generated types).
export async function releaseLeadIntake(
  id: string,
  force = false,
): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('release_lead_intake', { p_id: id, p_force: force });
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

// Admin-only. Appends a held duplicate's info onto an existing pipeline lead
// (chosen by the admin) and marks the intake row merged. Loose `rpcCall` (not in
// generated types). Errors: not_authorized, not_found, already_<status>,
// target_not_a_match, target_lead_missing.
export async function mergeLeadIntake(
  id: string,
  targetLeadId: string,
): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('merge_lead_intake', {
    p_id: id,
    p_target_lead_id: targetLeadId,
  });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; dropped_dead_end?: boolean; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['merge_failed'] };
  return {
    ok: true,
    ...(r.lead_id ? { lead_id: r.lead_id } : {}),
    ...(r.dropped_dead_end ? { dropped_dead_end: true } : {}),
  };
}

// Returns the subset of the given lead ids that are dead-end / not-interested,
// so the intake merge picker can warn before merging into one (which discards
// the new submission). Loose `rpcCall` (not in generated types). Read-only.
export async function deadEndLeadIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await rpcCall('lead_dead_end_ids', { p_ids: ids });
  if (error) return [];
  return ((data as { id: string }[]) ?? []).map((row) => row.id);
}

// Returns the subset of the given lead ids that are in a COLD stage (dead_end /
// not_interested / no_answer / constant_na) — drives the Meta re-engage path.
export async function coldLeadIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await rpcCall('lead_cold_ids', { p_ids: ids });
  if (error) return [];
  return ((data as { id: string }[]) ?? []).map((row) => row.id);
}

// Admin-only. Re-engage a cold lead from a Meta intake duplicate: move it to
// Unique Lead, append the submission, resolve the intake row. Loose `rpcCall`.
// Errors: not_found, not_pending, not_a_match, not_cold.
export async function reengageLeadIntake(
  id: string,
  targetLeadId: string,
): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('reengage_lead_intake', {
    p_id: id,
    p_target_lead_id: targetLeadId,
  });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['reengage_failed'] };
  return r.lead_id ? { ok: true, lead_id: r.lead_id } : { ok: true };
}

export type BulkMergePreviewResult =
  | { ok: true; mergeable: number; dead_end: number }
  | { ok: false; errors: string[] };

// Admin-only. Counts pending single-lead-match rows split into mergeable vs dead-end.
export async function bulkMergeIntakePreview(): Promise<BulkMergePreviewResult> {
  const { data, error } = await rpcCall('bulk_merge_intake_preview', {});
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; mergeable?: number; dead_end?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['preview_failed'] };
  return { ok: true, mergeable: r.mergeable ?? 0, dead_end: r.dead_end ?? 0 };
}

export type BulkMergeResult =
  | { ok: true; merged: number; dropped: number; remaining: number }
  | { ok: false; errors: string[] };

// Admin-only. Merges one bounded batch of clear-cut duplicates (dead-end targets removed)
// and reports how many mergeable rows remain, so the caller can loop until done.
export async function bulkMergeIntake(): Promise<BulkMergeResult> {
  const { data, error } = await rpcCall('bulk_merge_intake', {});
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; merged?: number; dropped?: number; remaining?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['bulk_merge_failed'] };
  return { ok: true, merged: r.merged ?? 0, dropped: r.dropped ?? 0, remaining: r.remaining ?? 0 };
}

export type BulkReleasePreviewResult =
  | { ok: true; releasable: number }
  | { ok: false; errors: string[] };

// Admin-only. Counts clean (no-duplicate) pending rows that bulk-release would release.
export async function bulkReleaseIntakePreview(): Promise<BulkReleasePreviewResult> {
  const { data, error } = await rpcCall('bulk_release_intake_preview', {});
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; releasable?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['preview_failed'] };
  return { ok: true, releasable: r.releasable ?? 0 };
}

export type BulkReleaseResult =
  | { ok: true; released: number; remaining: number }
  | { ok: false; errors: string[] };

// Admin-only. Releases one bounded batch of clean pending rows to Unique Lead and reports
// how many remain, so the caller can loop until done.
export async function bulkReleaseIntake(): Promise<BulkReleaseResult> {
  const { data, error } = await rpcCall('bulk_release_intake', {});
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; released?: number; remaining?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['bulk_release_failed'] };
  return { ok: true, released: r.released ?? 0, remaining: r.remaining ?? 0 };
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

// --- Accounting: create deal (+ linked won lead) -----------------------------
export type AccountingCreateDealResult =
  | { ok: true; deal_id: string; code: string }
  | { ok: false; errors: string[] };

// Accounting creates a deal directly on the onboarding board. Not in the
// generated types → loose `rpcCall`. The RPC enforces the capability server-side.
export async function accountingCreateDeal(
  params: CreateDealParams,
): Promise<AccountingCreateDealResult> {
  const { data, error } = await rpcCall('accounting_create_deal', params);
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; deal_id?: string; code?: string; errors?: string[] };
  if (!r.ok || !r.deal_id) return { ok: false, errors: r.errors ?? ['create_failed'] };
  return { ok: true, deal_id: r.deal_id, code: r.code ?? '' };
}

// --- Announcements -----------------------------------------------------------
export type AnnouncementActionResult = { ok: true } | { ok: false; errors: string[] };
export type CreateAnnouncementResult =
  | { ok: true; announcement_id: string }
  | { ok: false; errors: string[] };
export type MyAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  created_at: string;
};

export async function createAnnouncement(
  params: CreateAnnouncementParams,
): Promise<CreateAnnouncementResult> {
  const { data, error } = await rpcCall('create_announcement', params);
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; announcement_id?: string; errors?: string[] };
  if (!r.ok || !r.announcement_id) return { ok: false, errors: r.errors ?? ['create_failed'] };
  return { ok: true, announcement_id: r.announcement_id };
}

export async function dismissAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const { data, error } = await rpcCall('dismiss_announcement', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  return r.ok ? { ok: true } : { ok: false, errors: r.errors ?? ['dismiss_failed'] };
}

export async function setAnnouncementActive(
  id: string,
  active: boolean,
): Promise<AnnouncementActionResult> {
  const { data, error } = await rpcCall('set_announcement_active', { p_id: id, p_active: active });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  return r.ok ? { ok: true } : { ok: false, errors: r.errors ?? ['update_failed'] };
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const { data, error } = await rpcCall('delete_announcement', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  return r.ok ? { ok: true } : { ok: false, errors: r.errors ?? ['delete_failed'] };
}

export async function getMyAnnouncements(): Promise<MyAnnouncementRow[]> {
  const { data, error } = await rpcCall('get_my_announcements', {});
  if (error) throw new Error(error.message);
  return (data as MyAnnouncementRow[] | null) ?? [];
}
