import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } | null; groupCodes: string[] }) => unknown) =>
    sel({ isAdmin: false, user: { id: 'u-me' }, groupCodes: ['accounting'] }),
}));

vi.mock('./hooks/useAssignedTasksRealtime', () => ({
  useAssignedTasksRealtime: () => undefined,
}));

vi.mock('./hooks/useAssignedTasksForSource', () => ({
  useAssignedTasksForSource: () => ({
    data: [
      {
        id: 't1', title: 'Renew domain', description: null,
        deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
        assignee_user_id: 'u-me', created_by_user_id: 'u1',
        status: 'open', resolved_at: null, resolved_by_user_id: null,
        created_at: new Date().toISOString(),
        client: { id: 'c1', name: 'Acme Ltd' },
        department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
      },
      {
        id: 't2', title: 'Old work', description: null,
        deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
        assignee_user_id: 'u2', created_by_user_id: 'u1',
        status: 'resolved', resolved_at: new Date().toISOString(), resolved_by_user_id: 'u2',
        created_at: new Date().toISOString(),
        client: { id: 'c1', name: 'Acme Ltd' },
        department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./hooks/useAssignedTaskDetail', () => ({
  useAssignedTaskDetail: (id: string | null) => ({
    data: id
      ? {
          id: 't1', title: 'Renew domain', description: 'desc',
          deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
          assignee_user_id: 'u-me', created_by_user_id: 'u-other',
          status: 'open' as const, resolved_at: null, resolved_by_user_id: null,
          created_at: new Date().toISOString(),
          department_group_id: 'g1',
          client: {
            id: 'c1', name: 'Acme Ltd', industry: 'Retail',
            contact_first_name: 'Jane', contact_last_name: 'Doe',
            email: 'jane@acme.gr', phone: '+30 1',
          },
          creator: { user_id: 'u-other', full_name: 'Smoke Test', email: 's@t.gr' },
          department: { id: 'g1', code: 'web_dev', display_names: { en: 'Web Dev', el: 'Web Dev' }, position: 50 },
        }
      : undefined,
    isLoading: false,
    error: null,
  }),
}));

import { AssignedTasksTab } from './AssignedTasksTab';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('AssignedTasksTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders open and resolved sections with their tasks', () => {
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(screen.getByText('Old work')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /open/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /resolved/i })).toBeInTheDocument();
  });

  it('shows the New task button when the user can create', () => {
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });

  it('shows the department chip on the row', () => {
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    const chips = screen.getAllByText('Web Dev');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('clicking the row opens the detail dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    await user.click(screen.getByRole('button', { name: /renew domain/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clicking Resolve does not open the dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<AssignedTasksTab source={{ kind: 'deal', id: 'd1' }} />));
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
