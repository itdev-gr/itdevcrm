import { describe, it, expect } from 'vitest';
import { filterAndSortLeads, UNASSIGNED, type LeadLike } from './leadsTableFilter';

const L = (over: Partial<LeadLike>): LeadLike => ({
  id: 'x', code: 'L-0001', source: 'manual', title: 'T', contact_first_name: null,
  contact_last_name: null, email: null, phone: null, website: null, industry: null,
  company_name: null, owner_user_id: null, stage_id: null, ...over,
});

describe('filterAndSortLeads', () => {
  const rows = [
    L({ id: 'a', code: 'L-0003', title: 'Alpha', email: 'a@x.gr', company_name: 'Acme', owner_user_id: 'u1', stage_id: 's1' }),
    L({ id: 'b', code: 'L-0001', title: 'Beta', email: 'b@y.gr', company_name: 'Bolt', owner_user_id: null, stage_id: 's2' }),
    L({ id: 'c', code: 'L-0002', title: 'Gamma', contact_first_name: 'Acme', email: 'c@z.gr', owner_user_id: 'u2', stage_id: 's1' }),
  ];

  it('defaults to sorting by code ascending', () => {
    const out = filterAndSortLeads(rows, {});
    expect(out.map((r) => r.code)).toEqual(['L-0001', 'L-0002', 'L-0003']);
  });

  it('search matches title/name/email/company case-insensitively', () => {
    const out = filterAndSortLeads(rows, { search: 'acme' });
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'c']); // company "Acme" and name "Acme"
  });

  it('filters by statusId and by ownerId', () => {
    expect(filterAndSortLeads(rows, { statusId: 's1' }).map((r) => r.id).sort()).toEqual(['a', 'c']);
    expect(filterAndSortLeads(rows, { ownerId: 'u1' }).map((r) => r.id)).toEqual(['a']);
  });

  it('ownerId UNASSIGNED keeps only leads with no owner', () => {
    expect(filterAndSortLeads(rows, { ownerId: UNASSIGNED }).map((r) => r.id)).toEqual(['b']);
  });

  it('sorts by owner using the provided label resolver, descending', () => {
    const ownerLabel = (id: string | null) => ({ u1: 'Zoe', u2: 'Anna' }[id ?? ''] ?? '');
    const out = filterAndSortLeads(rows.filter((r) => r.owner_user_id), { sort: { key: 'owner', dir: 'desc' }, ownerLabel });
    expect(out.map((r) => r.id)).toEqual(['a', 'c']); // Zoe(a) before Anna(c) when desc
  });
});
