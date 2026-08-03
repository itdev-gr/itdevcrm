import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateFinancialReports, FINANCIAL_REPORT_KEYS } from './financialInvalidations';

describe('invalidateFinancialReports', () => {
  it('invalidates every financial report key exactly once', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateFinancialReports(qc);
    const called = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const key of FINANCIAL_REPORT_KEYS) {
      expect(called).toContain(JSON.stringify(key));
    }
    expect(spy).toHaveBeenCalledTimes(FINANCIAL_REPORT_KEYS.length);
  });
});
