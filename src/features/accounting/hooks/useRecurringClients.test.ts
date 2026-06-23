import { describe, it, expect } from 'vitest';
import { buildRecurringRows } from './useRecurringClients';

const TODAY = '2026-06-23';

type Rec = Parameters<typeof buildRecurringRows>[0][number];

function client(over: Partial<Rec> = {}): Rec {
  return {
    id: 'c1', name: 'ACME', contact_first_name: null, contact_last_name: null,
    email: null, phone: null, industry: null, status: 'active',
    jobs: [
      { id: 'j1', service_type: 'local_seo', billing_type: 'recurring_monthly', amount_net: 100, status: 'active', archived: false },
    ],
    client_blocks: [],
    deals: [{ id: 'd1', archived: false, deal_payments: [] }],
    ...over,
  } as Rec;
}

describe('buildRecurringRows', () => {
  it('excludes clients without an active recurring job', () => {
    const rows = buildRecurringRows(
      [client({ jobs: [{ id: 'j', service_type: 'web_dev', billing_type: 'one_time', amount_net: 50, status: 'active', archived: false }] })],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it('sums monthly and yearly amounts in separate buckets', () => {
    const rows = buildRecurringRows(
      [client({ jobs: [
        { id: 'a', service_type: 'local_seo', billing_type: 'recurring_monthly', amount_net: 100, status: 'active', archived: false },
        { id: 'b', service_type: 'hosting', billing_type: 'recurring_yearly', amount_net: 120, status: 'active', archived: false },
      ] })],
      TODAY,
    );
    expect(rows[0]!.monthly_total).toBe(100);
    expect(rows[0]!.yearly_total).toBe(120);
    expect(rows[0]!.active_services.sort()).toEqual(['hosting', 'local_seo']);
  });

  it('marks a client blocked when status=blocked (On-Hold)', () => {
    expect(buildRecurringRows([client({ status: 'blocked' })], TODAY)[0]!.is_blocked).toBe(true);
  });

  it('marks a client blocked when an open client_blocks row exists', () => {
    const rows = buildRecurringRows([client({ client_blocks: [{ id: 'b', unblocked_at: null }] })], TODAY);
    expect(rows[0]!.is_blocked).toBe(true);
  });

  it('is not blocked when status=active and no open block', () => {
    expect(buildRecurringRows([client()], TODAY)[0]!.is_blocked).toBe(false);
  });

  it('flags overdue and sets earliest_due from a past-due pending payment', () => {
    const rows = buildRecurringRows(
      [client({ deals: [{ id: 'd1', archived: false, deal_payments: [
        { status: 'pending', end_date: '2026-06-01', billing_type: 'recurring_monthly' },
      ] }] })],
      TODAY,
    );
    expect(rows[0]!.has_overdue_payment).toBe(true);
    expect(rows[0]!.earliest_due).toBe('2026-06-01');
    expect(rows[0]!.renewal_due).toBeNull();
  });

  it('shows renewal_due (latest paid period end) when no pending row exists', () => {
    const rows = buildRecurringRows(
      [client({ deals: [{ id: 'd1', archived: false, deal_payments: [
        { status: 'paid', end_date: '2026-06-30', billing_type: 'recurring_monthly' },
        { status: 'paid', end_date: '2026-05-31', billing_type: 'recurring_monthly' },
      ] }] })],
      TODAY,
    );
    expect(rows[0]!.earliest_due).toBeNull();
    expect(rows[0]!.has_overdue_payment).toBe(false);
    expect(rows[0]!.renewal_due).toBe('2026-06-30');
  });
});
