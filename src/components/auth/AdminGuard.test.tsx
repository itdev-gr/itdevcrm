import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import { AdminGuard } from './AdminGuard';
import { useAuthStore } from '@/lib/stores/authStore';

describe('AdminGuard', () => {
  beforeEach(() => useAuthStore.getState().reset());

  it('redirects non-admins to /', () => {
    useAuthStore.getState().setSession({ access_token: 't' } as never, { id: 'u' } as never);
    useAuthStore.getState().setProfile({ isAdmin: false, groupCodes: [] });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <p>admin</p>
              </AdminGuard>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('renders children for admins', () => {
    useAuthStore.getState().setSession({ access_token: 't' } as never, { id: 'u' } as never);
    useAuthStore.getState().setProfile({ isAdmin: true, groupCodes: [] });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <p>admin</p>
              </AdminGuard>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('admin')).toBeInTheDocument();
  });
});
