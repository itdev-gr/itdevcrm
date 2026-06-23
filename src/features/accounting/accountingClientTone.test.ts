import { describe, it, expect } from 'vitest';
import { clientTone, monthlyRevenue, yearlyRevenue } from './accountingClientTone';
import type { AccountingClientRow } from './hooks/useAccountingClients';

type Job = AccountingClientRow['jobs'][number];
const job = (over: Partial<Job> = {}): Job => ({
  id: 'j', service_type: 'local_seo', billing_type: 'recurring_monthly',
  amount_net: 100, status: 'active', archived: false, ...over,
});

function client(over: Partial<AccountingClientRow> = {}): AccountingClientRow {
  return {
    id: 'c1', code: null, name: 'ACME', contact_first_name: null, contact_last_name: null,
    email: null, phone: null, website: null, industry: null, country: null, address: null,
    vat_number: null, status: 'active', assigned_owner_id: null, created_at: '2026-01-01',
    start_date: null, client_blocks: [], deals: [], jobs: [],
    ...over,
  };
}

describe('clientTone', () => {
  it('is blocked when an open client_block exists', () => {
    expect(clientTone(client({ client_blocks: [{ unblocked_at: null, reason: 'x' }] }))).toBe('blocked');
  });

  it('is blocked when status=blocked (On-Hold), even with active jobs', () => {
    expect(clientTone(client({ status: 'blocked', jobs: [job()] }))).toBe('blocked');
  });

  it('is active when the client has active jobs even if status=done (the fix)', () => {
    expect(clientTone(client({ status: 'done', jobs: [job()] }))).toBe('active');
  });

  it('is done only when status=done and there are no active jobs', () => {
    expect(clientTone(client({ status: 'done', jobs: [] }))).toBe('done');
    expect(clientTone(client({ status: 'done', jobs: [job({ status: 'done' })] }))).toBe('done');
    expect(clientTone(client({ status: 'done', jobs: [job({ archived: true })] }))).toBe('done');
  });

  it('is pending when there are no active jobs and status is not done/blocked', () => {
    expect(clientTone(client({ status: 'active', jobs: [] }))).toBe('pending');
    expect(clientTone(client({ status: 'new', jobs: [] }))).toBe('pending');
  });

  it('is active when status=active with active jobs', () => {
    expect(clientTone(client({ status: 'active', jobs: [job()] }))).toBe('active');
  });
});

describe('revenue', () => {
  it('sums recurring monthly and yearly active jobs in separate buckets', () => {
    const c = client({ jobs: [
      job({ id: 'a', billing_type: 'recurring_monthly', amount_net: 100 }),
      job({ id: 'b', billing_type: 'recurring_yearly', amount_net: 240 }),
      job({ id: 'c', billing_type: 'one_time', amount_net: 999 }),
      job({ id: 'd', billing_type: 'recurring_monthly', amount_net: 50, archived: true }),
    ] });
    expect(monthlyRevenue(c)).toBe(100);
    expect(yearlyRevenue(c)).toBe(240);
  });
});
