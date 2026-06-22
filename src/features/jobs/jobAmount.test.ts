import { describe, it, expect } from 'vitest';
import { jobAmountLabel } from './jobAmount';

describe('jobAmountLabel', () => {
  it('formats by billing cadence from amount_net', () => {
    expect(jobAmountLabel('recurring_monthly', 50)).toBe('€50/mo');
    expect(jobAmountLabel('recurring_yearly', 120)).toBe('€120/yr');
    expect(jobAmountLabel('one_time', 300)).toBe('€300');
  });

  it('uses Greek suffixes when lang=el', () => {
    expect(jobAmountLabel('recurring_monthly', 50, 'el')).toBe('€50/μήνα');
    expect(jobAmountLabel('recurring_yearly', 120, 'el')).toBe('€120/έτος');
  });

  it('returns — for zero/empty/string amounts', () => {
    expect(jobAmountLabel('recurring_monthly', 0)).toBe('—');
    expect(jobAmountLabel('one_time', null)).toBe('—');
    expect(jobAmountLabel('recurring_monthly', '75')).toBe('€75/mo');
  });
});
