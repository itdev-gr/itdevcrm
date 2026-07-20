import { describe, it, expect } from 'vitest';
import { resolveTaskOpenLinks } from './taskOpenLink';

describe('resolveTaskOpenLinks', () => {
  it('job-scoped task always opens its job', () => {
    expect(
      resolveTaskOpenLinks({ dealId: null, jobId: 'j1', sourceCode: '000042-WEBDEV', canOpenDeal: false, matchingJobs: [] }),
    ).toEqual([{ href: '/jobs/j1', labelKey: 'open_job', code: '000042-WEBDEV' }]);
  });

  it('deal-scoped task opens the deal when the viewer can', () => {
    expect(
      resolveTaskOpenLinks({ dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: true, matchingJobs: [] }),
    ).toEqual([{ href: '/deals/d1', labelKey: 'open_deal', code: '000042' }]);
  });

  it('deal-scoped task links to EVERY matching service job for technical viewers', () => {
    expect(
      resolveTaskOpenLinks({
        dealId: 'd1',
        jobId: null,
        sourceCode: '000042',
        canOpenDeal: false,
        matchingJobs: [
          { id: 'j1', code: '000042-WEBDEV' },
          { id: 'j2', code: '000042-WEBDEV-2' },
        ],
      }),
    ).toEqual([
      { href: '/jobs/j1', labelKey: 'open_job', code: '000042-WEBDEV' },
      { href: '/jobs/j2', labelKey: 'open_job', code: '000042-WEBDEV-2' },
    ]);
  });

  it('falls back to the source code when a matching job has no code', () => {
    expect(
      resolveTaskOpenLinks({
        dealId: 'd1',
        jobId: null,
        sourceCode: '000042',
        canOpenDeal: false,
        matchingJobs: [{ id: 'jw', code: null }],
      }),
    ).toEqual([{ href: '/jobs/jw', labelKey: 'open_job', code: '000042' }]);
  });

  it('returns [] when a technical viewer has no matching job', () => {
    expect(
      resolveTaskOpenLinks({ dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: false, matchingJobs: [] }),
    ).toEqual([]);
  });

  it('returns [] with no deal and no job', () => {
    expect(
      resolveTaskOpenLinks({ dealId: null, jobId: null, sourceCode: null, canOpenDeal: true, matchingJobs: [] }),
    ).toEqual([]);
  });
});
