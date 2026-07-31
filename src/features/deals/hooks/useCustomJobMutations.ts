import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import {
  createCustomJob,
  updateJobBilling,
  endJob,
  addWebDevJob,
  type CreateCustomJobInput,
  type UpdateJobBillingInput,
  type AddWebsiteJobInput,
} from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { jobsBillingKey } from './useJobsBilling';
import { dealPaymentsKey } from './useDealPayments';
import { queryKeys } from '@/lib/queryKeys';

function invalidateBilling(qc: ReturnType<typeof useQueryClient>, dealId: string) {
  void qc.invalidateQueries({ queryKey: jobsBillingKey(dealId) });
  void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
  void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
  void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
}

/** Throw a labelled error when an RPC returns { ok: false }. */
function throwOnFailure(result: { ok: true; job_id: string } | { ok: false; errors: string[] }) {
  if (!result.ok) {
    const err = new Error(result.errors[0] ?? 'rpc_failed');
    (err as Error & { errors?: string[] }).errors = result.errors;
    throw err;
  }
  return result.job_id;
}

export function useCreateCustomJob(dealId: string) {
  const qc = useQueryClient();
  // `force` (override the one-web_dev-job-per-deal guardrail) and
  // `installmentSchedule` (custom plan) flow through via the input spread below.
  return useMutation<string, DefaultError, Omit<CreateCustomJobInput, 'dealId'>>({
    mutationFn: captureMutation('jobs', 'create_custom_job', async (input) => {
      const result = await createCustomJob({ ...input, dealId });
      return throwOnFailure(result);
    }),
    onSuccess: () => invalidateBilling(qc, dealId),
  });
}

export function useUpdateJobBilling(dealId: string) {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, UpdateJobBillingInput>({
    mutationFn: captureMutation('jobs', 'update_job_billing', async (input) => {
      const result = await updateJobBilling(input);
      return throwOnFailure(result);
    }),
    onSuccess: () => invalidateBilling(qc, dealId),
  });
}

export function useAddWebsiteJob(dealId: string) {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, Omit<AddWebsiteJobInput, 'dealId'>>({
    mutationFn: captureMutation('jobs', 'add_web_dev_job', async (input) => {
      const result = await addWebDevJob({ ...input, dealId });
      return throwOnFailure(result);
    }),
    onSuccess: () => {
      invalidateBilling(qc, dealId);
      void qc.invalidateQueries({ queryKey: queryKeys.dealServiceJobs(dealId, 'web_dev') });
    },
  });
}

export function useEndJob(dealId: string) {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, string>({
    mutationFn: captureMutation('jobs', 'end_job', async (jobId) => {
      const result = await endJob(jobId);
      return throwOnFailure(result);
    }),
    onSuccess: () => invalidateBilling(qc, dealId),
  });
}
