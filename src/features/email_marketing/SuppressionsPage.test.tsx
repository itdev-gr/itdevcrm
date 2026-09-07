import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { SuppressionRow, SuppressionsResult } from './hooks/useSuppressions';

const { unsuppressMutateAsync } = vi.hoisted(() => ({
  unsuppressMutateAsync: vi.fn(),
}));

function makeRow(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return {
    email_lower: 'bounced@example.com',
    reason: 'hard_bounce',
    source: 'resend-webhook',
    bounce_count: 3,
    first_seen_at: '2026-06-01T00:00:00Z',
    last_seen_at: '2026-08-20T00:00:00Z',
    note: null,
    ...overrides,
  };
}

let result: SuppressionsResult = { rows: [makeRow()], count: 1 };

vi.mock('./hooks/useSuppressions', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useSuppressions')>('./hooks/useSuppressions');
  return {
    ...actual,
    useSuppressions: () => ({ data: result, isLoading: false, error: null }),
    useUnsuppressEmail: () => ({ mutateAsync: unsuppressMutateAsync, isPending: false }),
  };
});

import { SuppressionsPage } from './SuppressionsPage';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('SuppressionsPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    result = { rows: [makeRow()], count: 1 };
  });

  // --- Removal requires confirmation ---------------------------------------

  it('does not fire unsuppress_email on the first click — only the confirm dialog opens', () => {
    render(wrap(<SuppressionsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση' }));

    expect(unsuppressMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Αφαίρεση του «bounced@example.com» από τη λίστα αποκλεισμού;')).toBeInTheDocument();
  });

  it('fires unsuppress_email only after the confirm dialog is confirmed', async () => {
    unsuppressMutateAsync.mockResolvedValueOnce(true);
    render(wrap(<SuppressionsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση' }));
    const buttons = screen.getAllByRole('button', { name: 'Αφαίρεση' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(unsuppressMutateAsync).toHaveBeenCalledWith('bounced@example.com'));
  });

  it('warns specifically that the person asked to stop when the reason is "unsubscribed"', () => {
    result = { rows: [makeRow({ reason: 'unsubscribed' })], count: 1 };
    render(wrap(<SuppressionsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση' }));

    expect(screen.getByText(/ζητήσει ρητά να μην λαμβάνει άλλα email/)).toBeInTheDocument();
  });

  // --- Reason translations, including an unknown reason --------------------

  it('maps every known suppression reason to a Greek label', () => {
    const reasons: SuppressionRow['reason'][] = [
      'hard_bounce',
      'soft_bounce',
      'complaint',
      'manual',
      'invalid',
      'unsubscribed',
    ];
    result = {
      rows: reasons.map((reason, i) => makeRow({ email_lower: `addr${i}@example.com`, reason })),
      count: reasons.length,
    };
    render(wrap(<SuppressionsPage />));

    // getAllByText, not getByText: the same label also appears once as an
    // <option> in the reason filter dropdown, so each is expected twice.
    for (const label of [
      'Μόνιμο bounce (η διεύθυνση δεν υπάρχει)',
      'Προσωρινό bounce (π.χ. γεμάτο inbox)',
      'Καταγγελία ανεπιθύμητης αλληλογραφίας',
      'Αφαιρέθηκε χειροκίνητα',
      'Μη έγκυρη διεύθυνση email',
      'Ζήτησε να μην λαμβάνει άλλα email',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('still renders an unknown reason, inside an explicit "unknown reason" sentence', () => {
    result = { rows: [makeRow({ reason: 'quarantined' as SuppressionRow['reason'] })], count: 1 };
    render(wrap(<SuppressionsPage />));

    expect(screen.getByText('Άγνωστος λόγος (quarantined)')).toBeInTheDocument();
  });
});
