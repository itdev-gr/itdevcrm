import { describe, it, expect } from 'vitest';
import { mergeArchiveEntries } from './useResolvedArchive';

describe('mergeArchiveEntries', () => {
  const u = [{ id: 'u1', title: 'P', importance: 'low', completed_at: '2026-06-10T00:00:00Z' }];
  const a = [
    { id: 'a1', title: 'A', importance: 'high', resolved_at: '2026-06-12T00:00:00Z', deal_id: 'd1', job_id: null, source_code: 'D-1' },
    { id: 'a2', title: 'B', importance: 'low', resolved_at: '2026-06-08T00:00:00Z', deal_id: null, job_id: 'j1', source_code: 'J-1' },
  ];

  it('merges both kinds newest-first', () => {
    const out = mergeArchiveEntries(u as never, a as never, 10);
    expect(out.map((e) => e.id)).toEqual(['a1', 'u1', 'a2']);
  });

  it('builds links and keys per kind', () => {
    const out = mergeArchiveEntries(u as never, a as never, 10);
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId.u1).toMatchObject({ kind: 'user', key: 'user:u1', link: null });
    expect(byId.a1).toMatchObject({ kind: 'assigned', key: 'assigned:a1', link: '/deals/d1' });
    expect(byId.a2?.link).toBe('/jobs/j1');
  });

  it('respects the limit', () => {
    expect(mergeArchiveEntries(u as never, a as never, 1)).toHaveLength(1);
  });
});
