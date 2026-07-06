import { describe, it, expect } from 'vitest';
import { noteFrom } from './DealNotesArea';
import type { DealJob } from './hooks/useDealJobs';

const jobs: DealJob[] = [
  { id: 'j1', service_type: 'ads', details: { ads_notes: 'budget €300/mo, GR targeting' } },
  { id: 'j2', service_type: 'web_dev', details: { webdev_notes: 'wp site' } },
];

describe('noteFrom (ads)', () => {
  it('picks the ads note from an ads job', () => {
    expect(noteFrom(jobs, ['ads'], 'ads_notes')).toEqual({
      present: true,
      value: 'budget €300/mo, GR targeting',
    });
  });

  it('reports absent when the deal has no ads job', () => {
    expect(noteFrom([jobs[1]!], ['ads'], 'ads_notes')).toEqual({ present: false, value: '' });
  });

  it('is present-but-empty when the ads job has no note yet', () => {
    expect(noteFrom([{ id: 'j3', service_type: 'ads', details: null }], ['ads'], 'ads_notes')).toEqual({
      present: true,
      value: '',
    });
  });
});
