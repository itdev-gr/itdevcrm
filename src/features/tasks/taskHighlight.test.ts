import { describe, it, expect } from 'vitest';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from './taskHighlight';

const now = Date.parse('2026-06-26T12:00:00Z');
const cutoffMs = now - HIGHLIGHT_WINDOW_DAYS * 86_400_000;
const recent = '2026-06-25T12:00:00Z'; // 1 day ago
const old = '2026-05-01T12:00:00Z'; // > 14 days ago

describe('isTaskHighlighted', () => {
  it('unopened + recent → highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: recent, opened: false, cutoffMs })).toBe(true);
  });
  it('opened + recent → not highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: recent, opened: true, cutoffMs })).toBe(false);
  });
  it('unopened + old → not highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: old, opened: false, cutoffMs })).toBe(false);
  });
  it('null/invalid createdAt → not highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: null, opened: false, cutoffMs })).toBe(false);
    expect(isTaskHighlighted({ createdAtIso: 'nonsense', opened: false, cutoffMs })).toBe(false);
  });
});
