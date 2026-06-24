import { describe, it, expect } from 'vitest';
import { filterBillingJobs } from './filterBillingJobs';

describe('filterBillingJobs', () => {
  it('keeps top-level jobs and drops AI SEO work-card children', () => {
    const rows = [
      { id: 'p', parent_job_id: null },
      { id: 'w', parent_job_id: 'p' },
      { id: 'l', parent_job_id: 'p' },
      { id: 'x', parent_job_id: null },
    ];
    expect(filterBillingJobs(rows).map((r) => r.id)).toEqual(['p', 'x']);
  });
});
