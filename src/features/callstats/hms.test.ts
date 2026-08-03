import { describe, it, expect } from 'vitest';
import { hms } from './hms';

describe('hms', () => {
  it('formats sub-hour as M:SS', () => {
    expect(hms(0)).toBe('0:00');
    expect(hms(72)).toBe('1:12');
    expect(hms(605)).toBe('10:05');
  });
  it('formats hours as H:MM:SS', () => {
    expect(hms(3720)).toBe('1:02:00');
    expect(hms(4332)).toBe('1:12:12');
  });
  it('clamps negatives/NaN to 0:00', () => {
    expect(hms(-5)).toBe('0:00');
    expect(hms(Number.NaN)).toBe('0:00');
  });
});
