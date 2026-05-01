import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import '@/lib/i18n';

vi.mock('./hooks/useUsers', () => ({
  useUsers: () => ({
    data: [
      {
        user_id: 'u1',
        full_name: 'Maria',
        email: 'maria@x.com',
        is_admin: false,
        is_active: true,
        must_change_password: false,
        preferred_locale: 'en',
        archived: false,
        avatar_url: null,
        archived_at: null,
        archived_by: null,
        archived_reason: null,
        created_at: '2026-05-02',
        updated_at: '2026-05-02',
        user_groups: [{ groups: { id: 'g1', code: 'sales' } }],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./CreateUserDialog', () => ({
  CreateUserDialog: () => null,
}));

import { UsersListPage } from './UsersListPage';

function wrap(ui: ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('UsersListPage', () => {
  it('renders title and a row per user', async () => {
    render(wrap(<UsersListPage />));
    expect(screen.getByRole('heading', { name: /users|χρήστες/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Maria')).toBeInTheDocument());
    expect(screen.getByText('maria@x.com')).toBeInTheDocument();
    expect(screen.getByText(/sales/i)).toBeInTheDocument();
  });
});
