import type { AccountingClientRow } from './hooks/useAccountingClients';

export type Tone = 'active' | 'pending' | 'blocked' | 'done';

export function isBlocked(c: AccountingClientRow): boolean {
  return (c.client_blocks ?? []).some((b) => b.unblocked_at == null);
}

export function activeJobs(c: AccountingClientRow) {
  return (c.jobs ?? []).filter((j) => !j.archived && j.status === 'active');
}

export function monthlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_monthly')
    .reduce((sum, j) => sum + (Number(j.amount_net) || 0), 0);
}

export function yearlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_yearly')
    .reduce((sum, j) => sum + (Number(j.amount_net) || 0), 0);
}

/**
 * Status tone shown in the table and used by the status filter chips.
 *
 * "Done" only renders when the client has NO active jobs — a client with
 * active (non-archived) work or billing is never shown as Done, even if its
 * `status` was set to 'done'. Order: blocked > active-jobs > done > pending.
 */
export function clientTone(c: AccountingClientRow): Tone {
  if (isBlocked(c) || c.status === 'blocked') return 'blocked';
  if (activeJobs(c).length > 0) return 'active';
  if (c.status === 'done') return 'done';
  return 'pending';
}
