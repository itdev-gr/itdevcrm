import { describe, it, expect } from 'vitest';
import { stageCompletesJob } from './stageCompletion';

describe('stageCompletesJob', () => {
  it('is true for a terminal stage whose outcome is completed', () => {
    expect(stageCompletesJob({ is_terminal: true, terminal_outcome: 'completed' })).toBe(true);
  });

  it('is false for a terminal stage with a non-completed outcome (e.g. cancelled)', () => {
    expect(stageCompletesJob({ is_terminal: true, terminal_outcome: 'cancelled' })).toBe(false);
  });

  it('is false for a non-terminal stage', () => {
    expect(stageCompletesJob({ is_terminal: false, terminal_outcome: 'completed' })).toBe(false);
  });

  it('is false for a missing/undefined stage', () => {
    expect(stageCompletesJob(undefined)).toBe(false);
    expect(stageCompletesJob(null)).toBe(false);
  });
});
