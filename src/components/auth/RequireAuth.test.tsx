import { vi } from 'vitest';

vi.mock('@/lib/profile', () => ({
  fetchProfile: vi.fn().mockResolvedValue({
    user_id: 'u',
    must_change_password: false,
    is_admin: false,
    is_active: true,
    full_name: '',
    email: '',
  }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RequireAuth } from './RequireAuth';
import { useAuthStore } from '@/lib/stores/authStore';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('RequireAuth', () => {
  beforeEach(() => useAuthStore.getState().reset());

  it('redirects to /login when no session', () => {
    render(
      wrap(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <p>secret</p>
                </RequireAuth>
              }
            />
            <Route path="/login" element={<p>login</p>} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('renders children when session present', async () => {
    useAuthStore.getState().setSession({ access_token: 't' } as never, { id: 'u' } as never);
    render(
      wrap(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <p>secret</p>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>,
      ),
    );
    await waitFor(() => expect(screen.getByText('secret')).toBeInTheDocument());
  });
});
