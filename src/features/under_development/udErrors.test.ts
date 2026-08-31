import { describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import { udErrorMessage } from './udErrors';

describe('udErrorMessage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  const t = () => i18n.getFixedT(null, 'sales');

  it('maps known RPC codes to translated copy', () => {
    expect(udErrorMessage(t(), 'already_completed')).toBe('This task was already completed.');
    expect(udErrorMessage(t(), 'not_current_task')).toMatch(/refresh the page/i);
    expect(udErrorMessage(t(), 'permission_denied')).toMatch(/permission/i);
    expect(udErrorMessage(t(), 'cadence_task_delete_blocked')).toBe(
      "Automation tasks can't be deleted while open — complete them with an outcome instead.",
    );
  });
  it('passes unknown messages through unchanged', () => {
    expect(udErrorMessage(t(), 'TypeError: fetch failed')).toBe('TypeError: fetch failed');
  });
  it('Greek copy', async () => {
    await i18n.changeLanguage('el');
    expect(udErrorMessage(i18n.getFixedT(null, 'sales'), 'already_completed')).toMatch(
      /ολοκληρωθεί/,
    );
  });
});
