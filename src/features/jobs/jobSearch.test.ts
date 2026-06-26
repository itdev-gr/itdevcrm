import { describe, it, expect } from 'vitest';
import { matchesJobSearch, boardFocusJobId } from './jobSearch';
import type { JobRow } from './hooks/useJobs';

// The matcher only reads a handful of fields, so a partial object is enough.
function job(partial: Partial<JobRow> & { details?: Record<string, unknown> | null }): JobRow {
  return partial as unknown as JobRow;
}

const full = job({
  title: 'GBP optimisation',
  code: '000013-LOCALSEO',
  deal: { id: 'd1', code: '000013', title: null },
  client: {
    id: 'c1', name: 'Ortho House',
    code: 'CL-000013',
    contact_first_name: 'Maria', contact_last_name: 'Papadopoulou',
    industry: null,
    email: 'hello@orthohouse.gr',
    phone: '210 123 4567',
    phone_normalized: '2101234567',
    website: 'https://orthohouse.gr',
  },
  details: { profile_url: 'https://maps.google.com/orthohouse', business_profile: 'Ortho House Athens' },
});

describe('matchesJobSearch', () => {
  it('empty / whitespace query matches every job', () => {
    expect(matchesJobSearch(full, '')).toBe(true);
    expect(matchesJobSearch(full, '   ')).toBe(true);
  });

  it('matches the job title', () => {
    expect(matchesJobSearch(full, 'optimis')).toBe(true);
  });

  it('matches the job code (JOB ID)', () => {
    expect(matchesJobSearch(full, '000013-localseo')).toBe(true);
  });

  it('matches the deal/account code (clientID)', () => {
    expect(matchesJobSearch(full, '000013')).toBe(true);
  });

  it('matches the client name', () => {
    expect(matchesJobSearch(full, 'ortho house')).toBe(true);
  });

  it('matches the client email', () => {
    expect(matchesJobSearch(full, 'orthohouse.gr')).toBe(true);
  });

  it('matches the client phone', () => {
    expect(matchesJobSearch(full, '2101234567')).toBe(true);
  });

  it('matches the details.profile_url', () => {
    expect(matchesJobSearch(full, 'maps.google.com/orthohouse')).toBe(true);
  });

  it('matches the details.business_profile', () => {
    expect(matchesJobSearch(full, 'athens')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesJobSearch(full, 'ORTHO HOUSE')).toBe(true);
  });

  it('returns false for a non-matching query', () => {
    expect(matchesJobSearch(full, 'zzz-no-such-thing')).toBe(false);
  });

  it('does not throw when client/deal/details are null', () => {
    const bare = job({ title: 'bare', code: null, deal: null, client: null, details: null });
    expect(matchesJobSearch(bare, 'bare')).toBe(true);
    expect(matchesJobSearch(bare, 'ortho')).toBe(false);
  });

  it('does not false-positive across field boundaries', () => {
    // "house2101" would only match if name+phone were concatenated without a separator.
    expect(matchesJobSearch(full, 'house2101')).toBe(false);
  });

  it('matches the client code (Client ID)', () => {
    expect(matchesJobSearch(full, 'cl-000013')).toBe(true);
  });

  it('matches the contact first/last name', () => {
    expect(matchesJobSearch(full, 'maria papad')).toBe(true);
  });

  it('matches the client website', () => {
    expect(matchesJobSearch(full, 'orthohouse.gr')).toBe(true);
  });

  it('matches a digits-only phone query via phone_normalized', () => {
    // client.phone is stored with spaces; the digits-only query must still match.
    expect(matchesJobSearch(full, '2101234567')).toBe(true);
  });
});

describe('boardFocusJobId', () => {
  const a = job({ id: 'job-a' });
  const b = job({ id: 'job-b' });

  it('returns the single job id when searching and exactly one matches', () => {
    expect(boardFocusJobId([a], 'something')).toBe('job-a');
  });

  it('returns null when the search box is empty (no auto-focus)', () => {
    expect(boardFocusJobId([a], '')).toBeNull();
    expect(boardFocusJobId([a], '   ')).toBeNull();
  });

  it('returns null when more than one job matches', () => {
    expect(boardFocusJobId([a, b], 'x')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(boardFocusJobId([], 'x')).toBeNull();
  });
});
