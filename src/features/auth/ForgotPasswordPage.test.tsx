import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { ForgotPasswordPage } from './ForgotPasswordPage';

const { resetMock } = vi.hoisted(() => ({
  resetMock: vi.fn().mockResolvedValue({ data: {}, error: null }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: resetMock } },
}));

function wrap(ui: ReactNode) {
  return <MemoryRouter initialEntries={['/forgot-password']}>{ui}</MemoryRouter>;
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    resetMock.mockClear();
    resetMock.mockResolvedValue({ data: {}, error: null });
  });

  it('renders the email field and submit button', () => {
    render(wrap(<ForgotPasswordPage />));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('submits and shows the uniform notice with the right redirect', async () => {
    render(wrap(<ForgotPasswordPage />));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@itdev.gr' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(resetMock).toHaveBeenCalledWith('user@itdev.gr', {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it('shows the same notice even when the request fails (no enumeration)', async () => {
    resetMock.mockResolvedValue({ data: null, error: { message: 'rate limit' } });
    render(wrap(<ForgotPasswordPage />));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@itdev.gr' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
