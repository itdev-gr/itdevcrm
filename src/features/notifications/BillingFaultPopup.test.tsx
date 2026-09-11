import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { i18n } from '@/lib/i18n';
import { I18nextProvider } from 'react-i18next';

type Notif = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

const { notifs, auth, markReadMutate } = vi.hoisted(() => ({
  notifs: { current: [] as Notif[] },
  auth: { current: { isAdmin: false, groupCodes: ['accounting'] as string[] } },
  markReadMutate: vi.fn(),
}));

vi.mock('./hooks/useNotifications', () => ({ useNotifications: () => ({ data: notifs.current }) }));
vi.mock('./hooks/useMarkNotificationRead', () => ({
  useMarkNotificationRead: () => ({ mutate: markReadMutate }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ isAdmin: auth.current.isAdmin, groupCodes: auth.current.groupCodes }),
}));

import { BillingFaultPopup } from './BillingFaultPopup';

function fault(over: Partial<Notif> & { id: string }): Notif {
  return {
    type: 'billing_fault',
    read_at: null,
    created_at: '2026-09-11T10:00:00Z',
    payload: {
      kind: 'integrity_audit',
      fault: 'billing_off_without_reason',
      detail: 'Η χρέωση έκλεισε χωρίς παύση και χωρίς λήξη — η υπηρεσία δεν χρεώνεται πλέον.',
      job_code: '005230-ADS',
      client_name: 'ΔΡΑΓΩΝΑΣ ΠΑΥΛΟΣ',
      amount: 120,
      parent_type: 'job',
      parent_id: 'job-1',
    },
    ...over,
  };
}

function wrap(node: React.ReactNode) {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </MemoryRouter>
  );
}

describe('BillingFaultPopup', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('el');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.current = { isAdmin: false, groupCodes: ['accounting'] };
    notifs.current = [];
  });

  it('shows the fault, the client and the money impact', () => {
    notifs.current = [fault({ id: 'n1' })];
    render(wrap(<BillingFaultPopup />));

    expect(screen.getByText('Η χρέωση έκλεισε χωρίς λόγο')).toBeInTheDocument();
    expect(screen.getByText('ΔΡΑΓΩΝΑΣ ΠΑΥΛΟΣ')).toBeInTheDocument();
    expect(screen.getByText('005230-ADS')).toBeInTheDocument();
    expect(screen.getByText('120,00 €')).toBeInTheDocument();
  });

  // Dismissing must mark it read — an unread row is re-filtered in on the next
  // render and the dialog would pop straight back up.
  it('marks the notification read when dismissed, and stops showing it', async () => {
    notifs.current = [fault({ id: 'n1' })];
    render(wrap(<BillingFaultPopup />));

    fireEvent.click(screen.getByRole('button', { name: 'Το είδα' }));

    expect(markReadMutate).toHaveBeenCalledWith('n1');
    await waitFor(() => expect(screen.queryByText('Η χρέωση έκλεισε χωρίς λόγο')).toBeNull());
  });

  it('queues several faults and shows them one at a time', () => {
    notifs.current = [
      fault({ id: 'n1' }),
      fault({ id: 'n2', payload: { ...fault({ id: 'x' }).payload, job_code: '000122-ADS' } }),
    ];
    render(wrap(<BillingFaultPopup />));

    expect(screen.getByText('005230-ADS')).toBeInTheDocument();
    expect(screen.queryByText('000122-ADS')).toBeNull();
    expect(screen.getByText(/\+1 ακόμα/)).toBeInTheDocument();
  });

  it('ignores notifications that were already read', () => {
    notifs.current = [fault({ id: 'n1', read_at: '2026-09-11T11:00:00Z' })];
    render(wrap(<BillingFaultPopup />));
    expect(screen.queryByText('Η χρέωση έκλεισε χωρίς λόγο')).toBeNull();
  });

  // It carries money figures; a technical user has no business seeing them.
  it('never renders for a user outside accounting/admin', () => {
    auth.current = { isAdmin: false, groupCodes: ['web_dev'] };
    notifs.current = [fault({ id: 'n1' })];
    render(wrap(<BillingFaultPopup />));
    expect(screen.queryByText('Η χρέωση έκλεισε χωρίς λόγο')).toBeNull();
  });

  it('ignores unrelated notification types', () => {
    notifs.current = [fault({ id: 'n1', type: 'task_assigned' })];
    render(wrap(<BillingFaultPopup />));
    expect(screen.queryByText('Η χρέωση έκλεισε χωρίς λόγο')).toBeNull();
  });
});
