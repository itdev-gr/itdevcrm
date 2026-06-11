import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';
import { ResetPasswordPage } from './ResetPasswordPage';

const { mutateAsync, navigateMock } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  navigateMock: vi.fn(),
}));
vi.mock('./hooks/useChangePassword', () => ({
  useChangePassword: () => ({ mutateAsync, isPending: false, isError: false }),
}));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter initialEntries={['/reset-password']}>{ui}</MemoryRouter>;
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    navigateMock.mockClear();
    useAuthStore.getState().reset();
    window.history.replaceState(null, '', '/reset-password');
  });

  it('shows the expired state when the link carries an error', () => {
    window.history.replaceState(
      null,
      '',
      '/reset-password#error=access_denied&error_code=otp_expired',
    );
    render(wrap(<ResetPasswordPage />));
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('shows the expired state when there is no recovery session', () => {
    render(wrap(<ResetPasswordPage />));
    expect(screen.getByText(/link expired/i)).toBeInTheDocument();
  });

  it('with a session: renders the form, saves, and redirects home', async () => {
    useAuthStore.getState().setSession(null, { id: 'u1' } as User);
    render(wrap(<ResetPasswordPage />));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'brandnewpass1' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'brandnewpass1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('brandnewpass1'));
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  it('rejects mismatched passwords without calling the mutation', async () => {
    useAuthStore.getState().setSession(null, { id: 'u1' } as User);
    render(wrap(<ResetPasswordPage />));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'brandnewpass1' },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'different1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
