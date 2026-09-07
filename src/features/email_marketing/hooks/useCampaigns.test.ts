import { vi, beforeEach, describe, it, expect } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { fetchAllCampaignRecipients } from './useCampaigns';

// Same thenable-builder stand-in idiom as useSuppressions.test.tsx: every
// chain method returns the SAME object, and the object itself is thenable.
type Builder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => unknown) => unknown;
};

function makeBuilder(): Builder {
  const b = {} as Builder;
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.range = vi.fn(() => b);
  return b;
}

function makeRow(id: string) {
  return { id, email_lower: `${id}@example.com`, status: 'sent' };
}

describe('fetchAllCampaignRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- N-1 regression: the drain used to advance its offset by the fixed
  // EXPORT_BATCH_SIZE (1000) instead of by what the server actually
  // returned. That only worked by coincidence when the real page size
  // equalled the stride — the hosted project's own "Max rows" setting is a
  // SEPARATE config from this repo's supabase/config.toml, so a lower real
  // cap silently reintroduced C-1: every page under-fills, the fixed stride
  // skips the remainder, and the export is short again with no error. ---

  it('collects every row when the server returns fewer rows per page than the requested stride', async () => {
    const total = 1000;
    const actualPageSize = 400; // smaller than the 1000-row stride the drain requests
    const allRows = Array.from({ length: total }, (_, i) => makeRow(`r${i}`));
    const rangeCalls: Array<[number, number]> = [];

    const builder = makeBuilder();
    builder.range = vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to]);
      return builder;
    });
    builder.then = (resolve) => {
      const [start] = rangeCalls[rangeCalls.length - 1]!;
      const data = allRows.slice(start, start + actualPageSize);
      return Promise.resolve({ data, error: null, count: total }).then(resolve);
    };
    from.mockReturnValue(builder);

    const result = await fetchAllCampaignRecipients('camp-1', undefined);

    expect(result).toHaveLength(total);
    expect(result.map((r) => r.id)).toEqual(allRows.map((r) => r.id));
    // Confirms the drain actually needed more round trips than
    // ceil(1000/1000)=1 — i.e. it genuinely exercised the
    // smaller-than-stride path, not just a lucky single page.
    expect(rangeCalls.length).toBe(Math.ceil(total / actualPageSize));
    // Fix-pass, N-1: each request's `from` must equal the ACTUAL rows
    // collected so far, not a multiple of the fixed 1000-row stride.
    expect(rangeCalls.map(([start]) => start)).toEqual([0, 400, 800]);
  });

  it('throws instead of silently returning a short file when the drain collects fewer rows than the server-reported count', async () => {
    // A filtered export mid-send: rows leave the filter between requests,
    // count keeps reporting the original total, but a page comes back
    // empty — the old code's safety-valve `break` returned early with no
    // error, and a plausible-looking partial CSV downloaded.
    const builder = makeBuilder();
    builder.then = (resolve) => Promise.resolve({ data: [], error: null, count: 1000 }).then(resolve);
    from.mockReturnValue(builder);

    await expect(fetchAllCampaignRecipients('camp-1', 'sent')).rejects.toThrow('export_incomplete');
  });

  it('does not throw when every row is accounted for in a single page', async () => {
    const builder = makeBuilder();
    builder.then = (resolve) =>
      Promise.resolve({ data: [makeRow('r1'), makeRow('r2')], error: null, count: 2 }).then(resolve);
    from.mockReturnValue(builder);

    const result = await fetchAllCampaignRecipients('camp-1', undefined);
    expect(result).toHaveLength(2);
  });
});
