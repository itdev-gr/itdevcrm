import { describe, it, expect } from 'vitest';
import { groupClientFlow, type ClientFlowRow } from './clientFlow';

const row = (over: Partial<ClientFlowRow>): ClientFlowRow => ({
  kind: 'new_deal',
  client_id: 'c1',
  client_name: 'Alpha',
  deal_id: null,
  deal_code: null,
  event_date: '2026-09-05',
  ...over,
});

describe('groupClientFlow', () => {
  it('splits rows by kind', () => {
    const g = groupClientFlow([
      row({ kind: 'new_deal', deal_id: 'd1', deal_code: '007001' }),
      row({ kind: 'stopped_client', client_id: 'c2', client_name: 'Beta' }),
      row({ kind: 'renewal_client', client_id: 'c3', client_name: 'Gamma' }),
      row({ kind: 'renewal_client', client_id: 'c4', client_name: 'Delta' }),
    ]);
    expect(g.newDeals).toHaveLength(1);
    expect(g.stopped).toHaveLength(1);
    expect(g.renewals).toHaveLength(2);
  });

  it('sorts each group by client name (Greek-aware)', () => {
    const g = groupClientFlow([
      row({ kind: 'stopped_client', client_id: 'c1', client_name: 'Ωμέγα ΕΠΕ' }),
      row({ kind: 'stopped_client', client_id: 'c2', client_name: 'Άλφα ΑΕ' }),
      row({ kind: 'stopped_client', client_id: 'c3', client_name: 'Μέση ΟΕ' }),
    ]);
    expect(g.stopped.map((r) => r.client_name)).toEqual(['Άλφα ΑΕ', 'Μέση ΟΕ', 'Ωμέγα ΕΠΕ']);
  });

  it('returns empty groups for no rows', () => {
    const g = groupClientFlow([]);
    expect(g.newDeals).toEqual([]);
    expect(g.stopped).toEqual([]);
    expect(g.renewals).toEqual([]);
  });
});
