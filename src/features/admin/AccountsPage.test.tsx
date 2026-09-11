import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';
import type { CompanyAccountRow } from './hooks/useCompanyAccounts';

const { revealMutateAsync, upsertMutateAsync, deleteMutateAsync } = vi.hoisted(() => ({
  revealMutateAsync: vi.fn(),
  upsertMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
}));

function makeRow(overrides: Partial<CompanyAccountRow> = {}): CompanyAccountRow {
  return {
    id: 'acc-1',
    title: 'Google Ads',
    email: 'ads@itdev.gr',
    notes: 'κάρτα εταιρίας',
    has_password: true,
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
    ...overrides,
  };
}

let rows: CompanyAccountRow[] = [makeRow()];

vi.mock('./hooks/useCompanyAccounts', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useCompanyAccounts')>('./hooks/useCompanyAccounts');
  return {
    ...actual,
    useCompanyAccounts: () => ({ data: rows, isLoading: false, error: null }),
    useCompanyAccountPassword: () => ({ mutateAsync: revealMutateAsync, isPending: false }),
    useUpsertCompanyAccount: () => ({ mutateAsync: upsertMutateAsync, isPending: false }),
    useDeleteCompanyAccount: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
  };
});

import { AccountsPage } from './AccountsPage';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('AccountsPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [makeRow()];
    revealMutateAsync.mockResolvedValue('Sup3r-Secret!');
  });

  // --- Passwords stay hidden until asked for --------------------------------

  it('masks the password and does not fetch it on render', () => {
    render(wrap(<AccountsPage />));

    expect(screen.getByText('••••••••')).toBeInTheDocument();
    expect(screen.queryByText('Sup3r-Secret!')).not.toBeInTheDocument();
    // The list never carries plaintext — nothing is fetched until the eye is clicked.
    expect(revealMutateAsync).not.toHaveBeenCalled();
  });

  it('fetches and shows the password only after clicking the reveal button', async () => {
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Εμφάνιση κωδικού για Google Ads' }));

    await waitFor(() => expect(screen.getByText('Sup3r-Secret!')).toBeInTheDocument());
    expect(revealMutateAsync).toHaveBeenCalledWith('acc-1');
  });

  it('hides the password again on the second click, without re-fetching', async () => {
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Εμφάνιση κωδικού για Google Ads' }));
    await waitFor(() => expect(screen.getByText('Sup3r-Secret!')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Απόκρυψη κωδικού για Google Ads' }));

    await waitFor(() => expect(screen.queryByText('Sup3r-Secret!')).not.toBeInTheDocument());
    expect(screen.getByText('••••••••')).toBeInTheDocument();
    expect(revealMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows a dash instead of reveal controls when no password is stored', () => {
    rows = [makeRow({ has_password: false })];
    render(wrap(<AccountsPage />));

    expect(screen.queryByRole('button', { name: /Εμφάνιση κωδικού/ })).not.toBeInTheDocument();
  });

  // --- Search ---------------------------------------------------------------

  it('filters by title, email and notes', () => {
    rows = [makeRow(), makeRow({ id: 'acc-2', title: 'Hetzner', email: 'srv@itdev.gr', notes: 'servers' })];
    render(wrap(<AccountsPage />));

    const search = screen.getByLabelText('Αναζήτηση σε τίτλο, email ή σημειώσεις…');
    fireEvent.change(search, { target: { value: 'hetz' } });
    expect(screen.queryByText('Google Ads')).not.toBeInTheDocument();
    expect(screen.getByText('Hetzner')).toBeInTheDocument();

    // notes also match
    fireEvent.change(search, { target: { value: 'κάρτα' } });
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    expect(screen.queryByText('Hetzner')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('Κανένας λογαριασμός δεν ταιριάζει στην αναζήτηση.')).toBeInTheDocument();
  });

  // --- Deletion requires confirmation ---------------------------------------

  it('does not delete on the first click — only the confirm dialog opens', () => {
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή Google Ads' }));

    expect(deleteMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Διαγραφή του «Google Ads»;')).toBeInTheDocument();
  });

  it('deletes after confirming', async () => {
    deleteMutateAsync.mockResolvedValue(undefined);
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Διαγραφή Google Ads' }));
    // The dialog's own confirm button — exactly «Διαγραφή», not the row's
    // «Διαγραφή Google Ads».
    fireEvent.click(screen.getByRole('button', { name: /^Διαγραφή$/ }));

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('acc-1'));
  });

  // --- Editing must never silently wipe a stored password -------------------

  it('sends password: null when the edit form leaves the field blank', async () => {
    upsertMutateAsync.mockResolvedValue('acc-1');
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Επεξεργασία Google Ads' }));
    fireEvent.change(screen.getByLabelText('Τίτλος'), { target: { value: 'Google Ads (νέο)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));

    // null = «άσε τον αποθηκευμένο κωδικό ως έχει» (το '' θα τον έσβηνε).
    await waitFor(() =>
      expect(upsertMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'acc-1', title: 'Google Ads (νέο)', password: null }),
      ),
    );
  });

  it('sends the typed password when one is entered', async () => {
    upsertMutateAsync.mockResolvedValue('acc-1');
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Επεξεργασία Google Ads' }));
    fireEvent.change(screen.getByLabelText('Κωδικός'), { target: { value: 'ν3ος-κωδικός' } });
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));

    await waitFor(() =>
      expect(upsertMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ password: 'ν3ος-κωδικός' })),
    );
  });

  it('refuses to save without a title', async () => {
    render(wrap(<AccountsPage />));

    fireEvent.click(screen.getByRole('button', { name: 'Προσθήκη λογαριασμού' }));
    fireEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));

    await waitFor(() => expect(screen.getByText('Ο τίτλος είναι υποχρεωτικός.')).toBeInTheDocument());
    expect(upsertMutateAsync).not.toHaveBeenCalled();
  });
});
