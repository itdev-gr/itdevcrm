import { describe, it, expect } from 'vitest';
import { planLeadShuffle, type ShuffleLead } from './leadShuffle';

const pool = ['r1', 'r2', 'r3'];

function counts(assignments: { newOwnerId: string }[]) {
  const m = new Map<string, number>();
  for (const a of assignments) m.set(a.newOwnerId, (m.get(a.newOwnerId) ?? 0) + 1);
  return m;
}

function cyclicLeads(n: number): ShuffleLead[] {
  return Array.from({ length: n }, (_, i) => ({ id: `l${i}`, ownerId: pool[i % 3] }));
}

describe('planLeadShuffle', () => {
  it('throws when fewer than two reps are in the pool', () => {
    expect(() => planLeadShuffle([{ id: 'l1', ownerId: null }], ['r1'])).toThrow(
      'shuffle_needs_two_reps',
    );
  });

  it('returns an assignment for every lead, exactly once', () => {
    const out = planLeadShuffle(cyclicLeads(3), pool);
    expect(out.map((a) => a.leadId).sort()).toEqual(['l0', 'l1', 'l2']);
  });

  it('never returns a lead to its current owner', () => {
    const leads = cyclicLeads(30);
    const ownerOf = new Map(leads.map((l) => [l.id, l.ownerId]));
    for (const a of planLeadShuffle(leads, pool)) {
      expect(a.newOwnerId).not.toBe(ownerOf.get(a.leadId));
    }
  });

  it('distributes evenly when the count divides the pool size', () => {
    const c = counts(planLeadShuffle(cyclicLeads(30), pool));
    expect([...c.values()].sort((a, b) => a - b)).toEqual([10, 10, 10]);
  });

  it('keeps the per-rep spread within one when there is a remainder', () => {
    const vals = [...counts(planLeadShuffle(cyclicLeads(31), pool)).values()];
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
  });

  it('handles leads that currently have no owner', () => {
    const leads: ShuffleLead[] = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, ownerId: null }));
    const c = counts(planLeadShuffle(leads, pool));
    expect([...c.values()].sort((a, b) => a - b)).toEqual([2, 2, 2]);
  });

  it('still guarantees no-self even when one rep owns every lead in the stage', () => {
    const leads: ShuffleLead[] = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, ownerId: 'r1' }));
    for (const a of planLeadShuffle(leads, pool)) {
      expect(a.newOwnerId).not.toBe('r1');
    }
  });

  it('is deterministic for the same input', () => {
    const leads = cyclicLeads(17);
    expect(planLeadShuffle(leads, pool)).toEqual(planLeadShuffle(leads, pool));
  });
});
