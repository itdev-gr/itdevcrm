import { describe, it, expect } from 'vitest';
import { gbpButtonState } from './gbpAccessButton';
import type { JobRow } from './hooks/useJobs';

// The matcher only reads service_type + client.email, so a minimal cast is enough.
function makeJob(serviceType: string, email: string | null): JobRow {
  return { service_type: serviceType, client: { email } } as unknown as JobRow;
}

describe('gbpButtonState', () => {
  it('hidden on non-local_seo jobs', () => {
    expect(gbpButtonState(makeJob('web_dev', 'a@b.gr'), null)).toBe('hidden');
  });
  it('no-email when local_seo but client has no email', () => {
    expect(gbpButtonState(makeJob('local_seo', null), null)).toBe('no-email');
    expect(gbpButtonState(makeJob('local_seo', '   '), null)).toBe('no-email');
  });
  it('idle when local_seo + email + never sent', () => {
    expect(gbpButtonState(makeJob('local_seo', 'a@b.gr'), null)).toBe('idle');
  });
  it('sent when local_seo + email + a last-sent timestamp', () => {
    expect(gbpButtonState(makeJob('local_seo', 'a@b.gr'), '2026-06-26T10:00:00Z')).toBe('sent');
  });
});
