import { describe, it, expect } from 'vitest';
import { importanceRank, importanceOf, IMPORTANCE_OPTIONS } from './importance';

describe('importance', () => {
  it('ranks urgent highest (lowest number) and low lowest', () => {
    expect(importanceRank('urgent')).toBeLessThan(importanceRank('high'));
    expect(importanceRank('high')).toBeLessThan(importanceRank('medium'));
    expect(importanceRank('medium')).toBeLessThan(importanceRank('low'));
  });

  it('sorts a mixed list urgent-first, low-last by rank', () => {
    const sorted = ['low', 'urgent', 'medium', 'high']
      .sort((a, b) => importanceRank(a as never) - importanceRank(b as never));
    expect(sorted).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('importanceOf reads the column and defaults unknown/null to low', () => {
    expect(importanceOf({ importance: 'urgent' })).toBe('urgent');
    expect(importanceOf({ importance: null })).toBe('low');
    expect(importanceOf({ importance: 'bogus' })).toBe('low');
  });

  it('offers the four options in ascending severity', () => {
    expect(IMPORTANCE_OPTIONS).toEqual(['low', 'medium', 'high', 'urgent']);
  });
});
