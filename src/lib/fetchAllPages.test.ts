import { describe, it, expect } from 'vitest';
import { fetchAllPages, PAGE_SIZE } from './fetchAllPages';

type Row = { id: number };

function fakeQuery(pages: Row[][]) {
  let call = 0;
  const ranges: Array<[number, number]> = [];
  const build = () => {
    const q = {
      range: (from: number, to: number) => {
        ranges.push([from, to]);
        const data = pages[call] ?? [];
        call += 1;
        return Object.assign(Promise.resolve({ data, error: null }), q);
      },
    };
    return q as never;
  };
  return { build, ranges };
}

describe('fetchAllPages', () => {
  it('returns a single short page directly', async () => {
    const { build, ranges } = fakeQuery([[{ id: 1 }, { id: 2 }]]);
    const rows = await fetchAllPages<Row>(build);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(ranges).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it('drains multiple pages until a short page arrives', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
    const { build, ranges } = fakeQuery([full, full, [{ id: 999999 }]]);
    const rows = await fetchAllPages<Row>(build);
    expect(rows).toHaveLength(PAGE_SIZE * 2 + 1);
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    ]);
  });

  it('stops cleanly on an exactly-full final page followed by an empty one', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
    const { build } = fakeQuery([full, []]);
    const rows = await fetchAllPages<Row>(build);
    expect(rows).toHaveLength(PAGE_SIZE);
  });

  it('throws on a query error', async () => {
    const q = {
      range: () => Object.assign(Promise.resolve({ data: null, error: { message: 'boom' } }), {}),
    };
    await expect(fetchAllPages(() => q as never)).rejects.toThrow('boom');
  });
});
