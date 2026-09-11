import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { SuppressionRow, SuppressionsResult, SuppressionsParams } from './hooks/useSuppressions';

const { unsuppressMutateAsync, addManualMutateAsync, useSuppressionsSpy } = vi.hoisted(() => ({
  unsuppressMutateAsync: vi.fn(),
  addManualMutateAsync: vi.fn(),
  // Records every params object SuppressionsPage calls useSuppressions with,
  // so a test can assert the page's own search/page state logic (the
  // debounce and the page-reset-on-search-change effect) without needing a
  // real network round-trip — the actual ilike/range query construction is
  // covered separately in hooks/useSuppressions.test.tsx against a mocked
  // supabase client.
  useSuppressionsSpy: vi.fn(),
}));

function makeRow(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return {
    email_lower: 'bounced@example.com',
    reason: 'hard_bounce',
    stream: 'marketing',
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
    useSuppressions: (params: SuppressionsParams) => {
      useSuppressionsSpy(params);
      return { data: result, isLoading: false, error: null };
    },
    useUnsuppressEmail: () => ({ mutateAsync: unsuppressMutateAsync, isPending: false }),
    useAdminSuppressEmail: () => ({ mutateAsync: addManualMutateAsync, isPending: false }),
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

  it('fires unsuppress_email only after the dialog is confirmed WITH a reason', async () => {
    unsuppressMutateAsync.mockResolvedValueOnce(true);
    render(wrap(<SuppressionsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Αφαίρεση' }));
    const confirmButton = () => {
      const buttons = screen.getAllByRole('button', { name: 'Αφαίρεση' });
      return buttons[buttons.length - 1]!;
    };

    // Taking someone off the list re-opens them to email, so the why is
    // mandatory: the confirm button stays disabled until a note is typed.
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(unsuppressMutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Γιατί (υποχρεωτικό)'), {
      target: { value: 'μου το ζήτησε ο ίδιος' },
    });
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(unsuppressMutateAsync).toHaveBeenCalledWith({
        email: 'bounced@example.com',
        note: 'μου το ζήτησε ο ίδιος',
      }),
    );
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

  // --- Search/paging reach the hook with the right (debounced, reset) state.
  // The actual server-side ilike/range query construction is a separate,
  // hook-level concern — see hooks/useSuppressions.test.tsx.

  describe('search debounce and page reset', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounces typed search input before it reaches the hook, and resets the page to 0 once it lands', async () => {
      // Enough total rows that "Επόμενη" (Next) is enabled from page 0.
      result = { rows: [makeRow()], count: 120 };
      render(wrap(<SuppressionsPage />));

      // Move off page 0 first, so the reset below is actually observable.
      fireEvent.click(screen.getByRole('button', { name: 'Επόμενη' }));
      expect(useSuppressionsSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: '', reason: undefined, page: 1 }),
      );

      const searchInput = screen.getByPlaceholderText('Αναζήτηση διεύθυνσης email…');
      fireEvent.change(searchInput, { target: { value: 'bounced' } });

      // Not yet — the search is debounced, so the hook must still see the
      // old (empty) term and the page the user was already on.
      expect(useSuppressionsSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: '', page: 1 }),
      );

      vi.advanceTimersByTime(300);

      // vi.waitFor (not @testing-library/react's own async utilities) —
      // same reasoning as StepSchedule.test.tsx: the debounced `setSearch`
      // fires outside any React event handler, so the resulting re-render
      // (and the page-reset effect it triggers) needs a poll, and RTL's own
      // utilities poll via a real setTimeout, which never fires under
      // vi.useFakeTimers().
      await vi.waitFor(() =>
        expect(useSuppressionsSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'bounced', reason: undefined, page: 0 }),
        ),
      );
    });
  });
});
