import { describe, it, expect } from 'vitest';
import { resolveTaskOpenLink } from './taskOpenLink';

describe('resolveTaskOpenLink', () => {
  it('job-scoped task → open the job', () => {
    expect(
      resolveTaskOpenLink({ dealId: null, jobId: 'j1', sourceCode: '000042-WEBDEV', canOpenDeal: false, matchingJob: null }),
    ).toEqual({ href: '/jobs/j1', labelKey: 'open_job', code: '000042-WEBDEV' });
  });

  it('deal-scoped + can open deal → open the deal', () => {
    expect(
      resolveTaskOpenLink({ dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: true, matchingJob: null }),
    ).toEqual({ href: '/deals/d1', labelKey: 'open_deal', code: '000042' });
  });

  it('deal-scoped + cannot open deal + matching job → open the matching JOB (with its code)', () => {
    expect(
      resolveTaskOpenLink({
        dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: false,
        matchingJob: { id: 'jw', code: '000042-WEBDEV' },
      }),
    ).toEqual({ href: '/jobs/jw', labelKey: 'open_job', code: '000042-WEBDEV' });
  });

  it('deal-scoped + cannot open deal + no matching job → no link', () => {
    expect(
      resolveTaskOpenLink({ dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: false, matchingJob: null }),
    ).toBeNull();
  });

  it('falls back to sourceCode when the matching job has no code', () => {
    expect(
      resolveTaskOpenLink({
        dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: false,
        matchingJob: { id: 'jw', code: null },
      }),
    ).toEqual({ href: '/jobs/jw', labelKey: 'open_job', code: '000042' });
  });

  it('no deal and no job → no link', () => {
    expect(
      resolveTaskOpenLink({ dealId: null, jobId: null, sourceCode: null, canOpenDeal: true, matchingJob: null }),
    ).toBeNull();
  });
});
