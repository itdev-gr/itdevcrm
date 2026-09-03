import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// `t` must be a STABLE reference across renders — the search effect below
// depends on [q, t], and an unstable mock t reruns it every render, forever
// (see InboxPage.test.tsx for the full explanation).
const stableT = (k: string) => k;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

const { from, rpc, leadsOrEq, clientsOr } = vi.hoisted(() => {
  const leadsLimit = vi.fn();
  const leadsEq = vi.fn(() => ({ limit: leadsLimit }));
  const leadsOr = vi.fn(() => ({ eq: leadsEq }));
  const leadsSelect = vi.fn(() => ({ or: leadsOr }));

  const clientsLimit = vi.fn();
  const clientsOr = vi.fn(() => ({ limit: clientsLimit }));
  const clientsSelect = vi.fn(() => ({ or: clientsOr }));

  const from = vi.fn((table: string) => {
    if (table === 'leads') return { select: leadsSelect };
    if (table === 'clients') return { select: clientsSelect };
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
  return {
    from, rpc,
    leadsOrEq: { leadsOr, leadsEq, leadsLimit },
    clientsOr: { clientsOr, clientsLimit },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from, rpc } }));

import { FileEmailDialog } from './FileEmailDialog';

describe('FileEmailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leadsOrEq.leadsLimit.mockResolvedValue({
      data: [{ id: 'l1', title: 'Μητσοτάκης ΑΕ', code: '000123', email: 'mits@example.com' }],
      error: null,
    });
    clientsOr.clientsLimit.mockResolvedValue({ data: [], error: null });
  });

  it('searches, picks a lead result, files the message, and reports onFiled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    const onFiled = vi.fn();
    const onClose = vi.fn();

    render(
      <FileEmailDialog messagePk="pk1" fromEmail="lead@example.com" onClose={onClose} onFiled={onFiled} />,
    );

    const search = screen.getByPlaceholderText('inbox.file_search_placeholder');
    await user.type(search, 'μητσ');

    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByText('Μητσοτάκης ΑΕ')).toBeInTheDocument());
    await user.click(screen.getByText('Μητσοτάκης ΑΕ'));

    await user.click(screen.getByRole('button', { name: 'inbox.file_confirm' }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('file_email_message', {
        p_message_pk: 'pk1',
        p_target_type: 'lead',
        p_target_id: 'l1',
      }),
    );
    expect(onFiled).toHaveBeenCalled();
  });
});
