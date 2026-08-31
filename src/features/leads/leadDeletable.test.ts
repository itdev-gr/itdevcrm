import { describe, it, expect } from 'vitest';
import { isLeadDeletable } from './leadDeletable';

describe('isLeadDeletable', () => {
  it('allows an ordinary, non-converted lead', () => {
    expect(isLeadDeletable({ converted_at: null, stage: { code: 'new_lead' } })).toBe(true);
  });

  it('allows a lead with no stage', () => {
    expect(isLeadDeletable({ converted_at: null, stage: null })).toBe(true);
  });

  it('refuses a converted lead', () => {
    expect(isLeadDeletable({ converted_at: '2026-01-01T00:00:00Z', stage: { code: 'new_lead' } })).toBe(false);
  });

  it('refuses a won lead', () => {
    expect(isLeadDeletable({ converted_at: null, stage: { code: 'won' } })).toBe(false);
  });

  it('refuses a UD-board won lead even when not converted (partial conversion)', () => {
    expect(isLeadDeletable({ converted_at: null, stage: { code: 'ud_won' } })).toBe(false);
  });

  it('allows a UD-board working lead', () => {
    expect(isLeadDeletable({ converted_at: null, stage: { code: 'ud_new_lead' } })).toBe(true);
  });
});
