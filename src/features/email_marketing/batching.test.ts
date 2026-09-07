import { describe, it, expect } from 'vitest';
import { chunkRows } from './batching';

describe('chunkRows', () => {
  it('splits a 1,200-row import into 3 batches of at most 500', () => {
    const rows = Array.from({ length: 1200 }, (_, i) => i);
    const batches = chunkRows(rows, 500);
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b.length)).toEqual([500, 500, 200]);
    // Nothing lost or reordered across the split.
    expect(batches.flat()).toEqual(rows);
  });

  it('returns a single batch when the input is smaller than the batch size', () => {
    const rows = [1, 2, 3];
    expect(chunkRows(rows, 500)).toEqual([[1, 2, 3]]);
  });

  it('returns an empty array for an empty input', () => {
    expect(chunkRows([], 500)).toEqual([]);
  });

  it('handles an exact multiple of the batch size without a trailing empty batch', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const batches = chunkRows(rows, 500);
    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.length)).toEqual([500, 500]);
  });
});
