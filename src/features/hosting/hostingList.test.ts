// src/features/hosting/hostingList.test.ts
import { describe, it, expect } from 'vitest';
import { filterAndSortHosting, hostingDomain, hostingStatus } from './hostingList';
import type { JobRow } from '@/features/jobs/hooks/useJobs';

const mk = (o: Partial<JobRow>): JobRow =>
  ({
    id: 'j', code: '000001-HOSTING', service_type: 'hosting', period_due_date: null,
    stage: { id: 's', code: 'active', board: 'hosting', display_names: {} },
    client: { id: 'c', name: 'Acme', contact_first_name: null, contact_last_name: null, industry: null },
    details: {}, parent_job_id: null,
    ...o,
  }) as unknown as JobRow;

describe('hostingList', () => {
  it('derives status from the stage code', () => {
    expect(hostingStatus(mk({ stage: { id: 's', code: 'active', board: 'hosting', display_names: {} } }))).toBe('active');
    expect(hostingStatus(mk({ stage: { id: 's', code: 'closed', board: 'hosting', display_names: {} } }))).toBe('done');
  });

  it('picks the domain from details then client website', () => {
    expect(hostingDomain(mk({ details: { live_url: 'a.gr' } }))).toBe('a.gr');
    expect(hostingDomain(mk({ details: { hosting: 'b.gr' } }))).toBe('b.gr');
    expect(hostingDomain(mk({ details: {}, client: { id: 'c', name: 'X', website: 'c.gr' } as NonNullable<JobRow['client']> }))).toBe('c.gr');
    expect(hostingDomain(mk({ details: {} }))).toBe('');
  });

  it('filters by status and search, sorts by renewal due (nulls last)', () => {
    const jobs = [
      mk({ id: 'a', client: { id: '1', name: 'Beta' } as NonNullable<JobRow['client']>, period_due_date: '2026-09-01' }),
      mk({ id: 'b', client: { id: '2', name: 'Alpha' } as NonNullable<JobRow['client']>, period_due_date: '2026-08-01' }),
      mk({ id: 'c', client: { id: '3', name: 'Gamma' } as NonNullable<JobRow['client']>, period_due_date: null }),
      mk({ id: 'd', client: { id: '4', name: 'Done Co' } as NonNullable<JobRow['client']>,
          stage: { id: 's', code: 'closed', board: 'hosting', display_names: {} }, period_due_date: '2026-01-01' }),
    ];
    const active = filterAndSortHosting(jobs, { status: 'active', search: '' });
    expect(active.map((j) => j.id)).toEqual(['b', 'a', 'c']); // due asc, null last; the 'done' job excluded
    expect(filterAndSortHosting(jobs, { status: 'done', search: '' }).map((j) => j.id)).toEqual(['d']);
    expect(filterAndSortHosting(jobs, { status: 'all', search: 'alpha' }).map((j) => j.id)).toEqual(['b']);
  });
});
