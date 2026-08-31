import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { formatConvertErrors } from './convertErrors';

const t = ((key: string, opts?: { service?: string; defaultValue?: string }) => {
  if (key === 'convert.errors.service_amount_required' && opts?.service) {
    return `Η υπηρεσία «${opts.service}» δεν έχει ποσό.`;
  }
  if (key === 'convert.errors.value_required') return 'Απαιτείται αξία.';
  return opts?.defaultValue ?? key;
}) as unknown as TFunction;

describe('formatConvertErrors', () => {
  it('translates plain error codes', () => {
    expect(formatConvertErrors(['value_required'], t)).toBe('Απαιτείται αξία.');
  });

  it('translates parameterized service_amount_required with a readable service name', () => {
    expect(formatConvertErrors(['service_amount_required:web_seo'], t)).toBe(
      'Η υπηρεσία «web seo» δεν έχει ποσό.',
    );
  });

  it('falls back to the raw code for unknown keys', () => {
    expect(formatConvertErrors(['mystery_error'], t)).toBe('mystery_error');
  });

  it('joins multiple errors with newlines', () => {
    expect(formatConvertErrors(['value_required', 'service_amount_required:ads'], t)).toBe(
      'Απαιτείται αξία.\nΗ υπηρεσία «ads» δεν έχει ποσό.',
    );
  });
});
