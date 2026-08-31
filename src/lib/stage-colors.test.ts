import { describe, it, expect } from 'vitest';
import { stageAccent } from './stage-colors';

describe('stageAccent', () => {
  it('resolves classic codes directly', () => {
    expect(stageAccent('new_lead').dot).toBe('bg-sky-500');
  });

  it('resolves UD-board codes through the ud_ prefix onto the same palette', () => {
    expect(stageAccent('ud_new_lead')).toEqual(stageAccent('new_lead'));
    expect(stageAccent('ud_scheduled')).toEqual(stageAccent('scheduled'));
  });

  it('has a dedicated Parking accent', () => {
    expect(stageAccent('ud_parking').dot).toBe('bg-slate-400');
  });

  it('falls back per column index for unknown codes', () => {
    expect(stageAccent('nonexistent_code', 3)).toBeDefined();
  });
});
