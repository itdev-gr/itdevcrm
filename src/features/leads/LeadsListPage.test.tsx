import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const { distributeMutateAsync } = vi.hoisted(() => ({
  distributeMutateAsync: vi.fn().mockResolvedValue(2),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } | null }) => unknown) =>
    sel({ isAdmin: true, user: { id: 'admin-1' } }),
}));

const oneUnassignedLead = {
  id: 'lead-1',
  code: '000031',
  source: 'manual',
  title: 'Acme',
  contact_first_name: 'John',
  contact_last_name: 'Doe',
  email: 'john@acme.gr',
  phone: '6900000000',
  website: null,
  industry: null,
  company_name: 'Acme Ltd',
  owner_user_id: null,
  stage_id: null,
};

vi.mock('./hooks/useLeads', () => ({
  useLeads: () => ({ data: [oneUnassignedLead], isLoading: false, error: null }),
}));
vi.mock('./hooks/useAssignableOwners', () => ({ useAssignableOwners: () => ({ data: [] }) }));
vi.mock('@/features/stages/hooks/usePipelineStages', () => ({ usePipelineStages: () => ({ data: [] }) }));
vi.mock('./hooks/useBulkUpdateLeads', () => ({ useBulkUpdateLeads: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('./hooks/useDeleteLeads', () => ({
  useDeleteLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useLeadDistribution', () => ({
  useLeadDistribution: () => ({
    autoEnabled: false,
    isLoading: false,
    setEnabled: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('./hooks/useDistributeUnassigned', () => ({
  useDistributeUnassigned: () => ({ mutateAsync: distributeMutateAsync, isPending: false }),
}));
// Stub the row editor — this test is about the header's distribute flow.
vi.mock('./LeadRowEditor', () => ({ LeadRowEditor: () => null }));

import { LeadsListPage } from './LeadsListPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <LeadsListPage />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LeadsListPage distribute confirmation', () => {
  beforeEach(() => {
    distributeMutateAsync.mockClear();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('clicking Distribute opens a confirm dialog instead of distributing immediately', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /distribute unassigned/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(distributeMutateAsync).not.toHaveBeenCalled();
  });

  it('confirming the dialog runs the distribution', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /distribute unassigned/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^distribute$/i }));

    expect(distributeMutateAsync).toHaveBeenCalledOnce();
  });
});
