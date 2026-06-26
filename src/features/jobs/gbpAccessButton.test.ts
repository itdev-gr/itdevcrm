import { describe, it, expect } from 'vitest';
import { gbpButtonState } from './gbpAccessButton';
import type { JobRow } from './hooks/useJobs';

function job(partial: Partial<JobRow> & { client?: JobRow['client'] }): JobRow {
  return partial as unknown as JobRow;
}

const local = (email: string | null) =>
  job({ service_type: 'local_seo', client: { id: 'c', name: 'X', email } as JobRow['client'] });

describe('gbpButtonState', () => {
  it('hidden on non-local_seo jobs', () => {
    expect(gbpButtonState(job({ service_type: 'web_dev' }), null)).toBe('hidden');
  });
  it('no-email when local_seo but client has no email', () => {
    expect(gbpButtonState(local(null), null)).toBe('no-email');
    expect(gbpButtonState(local('   '), null)).toBe('no-email');
  });
  it('idle when local_seo + email + never sent', () => {
    expect(gbpButtonState(local('a@b.gr'), null)).toBe('idle');
  });
  it('sent when local_seo + email + a last-sent timestamp', () => {
    expect(gbpButtonState(local('a@b.gr'), '2026-06-26T10:00:00Z')).toBe('sent');
  });
});
