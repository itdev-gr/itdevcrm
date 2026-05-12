import { render, screen } from '@testing-library/react';
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

vi.mock('./hooks/useAssignedTasksOpen', () => ({
  useAssignedTasksOpen: ({ assigneeUserId }: { assigneeUserId: string | null }) => ({
    data:
      assigneeUserId === 'u-me'
        ? [
            {
              id: 't1', title: 'Renew domain', description: 'before May 30',
              deal_id: 'd1', job_id: null, client_id: 'c1', source_code: '000013',
              assignee_user_id: 'u-me', created_by_user_id: 'u-other',
              status: 'open', resolved_at: null, resolved_by_user_id: null,
              created_at: new Date().toISOString(),
              client: { id: 'c1', name: 'Acme Ltd' },
            },
          ]
        : [],
    isLoading: false,
  }),
}));

import { AssignedTasksColumn } from './AssignedTasksColumn';

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

describe('AssignedTasksColumn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the open tasks for the current user', () => {
    render(wrap(<AssignedTasksColumn />));
    expect(screen.getByText('Renew domain')).toBeInTheDocument();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByText(/000013/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
  });

  it('links the source code to the originating deal', () => {
    render(wrap(<AssignedTasksColumn />));
    const link = screen.getByRole('link', { name: /000013/i });
    expect(link).toHaveAttribute('href', '/deals/d1');
  });
});
