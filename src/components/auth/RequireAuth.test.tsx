import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { useAuthStore } from '@/lib/stores/authStore';

describe('RequireAuth', () => {
  beforeEach(() => useAuthStore.getState().reset());

  it('redirects to /login when no session', () => {
    render(
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
    );
    expect(screen.getByText('login')).toBeInTheDocument();
  });

  it('renders children when session present', () => {
    useAuthStore.getState().setSession({ access_token: 't' } as never, { id: 'u' } as never);
    render(
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
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});
